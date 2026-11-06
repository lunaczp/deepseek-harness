import { createServer } from 'node:net'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activateGeneration, recordHealthyStart } from '../src/activation.ts'
import { proposeGeneration, resolveLayout } from '../src/generations.ts'
import type { EvolveLayout } from '../src/generations.ts'
import { readJournal } from '../src/journal.ts'
import { buildGeneration, verifyGeneration } from '../src/lifecycle.ts'
import { readState } from '../src/state.ts'
import type { GenerationRecord } from '../src/state.ts'
import { Supervisor } from '../src/supervisor.ts'
import { cleanup, git, repository, stepOptions } from './harness.ts'

const FAKE_APP = fileURLToPath(new URL('./fixtures/fake-app.mjs', import.meta.url))

/** A build and check pair that accepts syntactically valid JavaScript and rejects a syntax error. */
const CHECK_PLUGIN = ['node', '--check', 'plugin.mjs'] as const

const roots: string[] = []
const controllers: AbortController[] = []

beforeEach(() => {
  delete process.env.FAKE_FAIL_GENERATION
})

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.abort()
  delete process.env.FAKE_PORT
  delete process.env.DSH_EVOLVE_READY
  delete process.env.FAKE_FAIL_GENERATION
  for (const root of roots.splice(0)) await cleanup(root)
})

/** Create a fixture checkout containing one plugin file. */
async function pluginRepository(): Promise<string> {
  const root = await repository()
  roots.push(root)
  await writeFile(join(root, 'plugin.mjs'), 'export const value = 1\n')
  await git(root, 'add', 'plugin.mjs')
  await git(root, 'commit', '-m', 'plugin')
  return root
}

/** Propose, build, and verify one generation. */
async function verified(layout: EvolveLayout): Promise<GenerationRecord> {
  const { generation } = await proposeGeneration(layout)
  const built = await buildGeneration(layout, stepOptions(generation.id, CHECK_PLUGIN))
  expect(built.ok).toBe(true)
  const checked = await verifyGeneration(layout, stepOptions(generation.id, CHECK_PLUGIN), 3)
  expect(checked.ok).toBe(true)
  return generation
}

/** Reserve a port by binding and releasing it. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => { resolve() }))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>(resolve => server.close(() => { resolve() }))
  return port
}

/** Poll a predicate until it holds or the deadline passes. */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('condition was not reached before the deadline')
}

describe('the closed loop', () => {
  it('rejects a deliberately broken plugin change before it can be activated', async () => {
    const root = await pluginRepository()
    const layout = resolveLayout(root)

    const first = await verified(layout)
    // A second generation carries a syntax error the build must catch.
    const { generation: broken } = await proposeGeneration(layout, { note: 'deliberately broken' })
    await writeFile(join(broken.path, 'plugin.mjs'), 'export const value = (\n')

    const built = await buildGeneration(layout, stepOptions(broken.id, CHECK_PLUGIN))

    expect(built.ok).toBe(false)
    expect(built.status).toBe('failed')
    await expect(activateGeneration(layout, { id: broken.id, reason: 'should not happen' }))
      .rejects.toThrow(/not verified/)

    const state = await readState(layout.stateFile)
    expect(state.current).toBeNull()
    expect(state.generations.find(g => g.id === broken.id)?.status).toBe('failed')
    // The healthy generation from the same repository is untouched by the broken one.
    expect(state.generations.find(g => g.id === first.id)?.status).toBe('verified')
  })

  it('rolls back a generation that built and verified but fails to boot', async () => {
    const root = await pluginRepository()
    const layout = resolveLayout(root)

    const good = await verified(layout)
    await activateGeneration(layout, { id: good.id, reason: 'known good' })
    await recordHealthyStart(layout, good.id)

    const bad = await verified(layout)
    await activateGeneration(layout, { id: bad.id, reason: 'new generation' })
    await writeFile(join(bad.path, 'plugin.mjs'), 'export const value = 2\n')
    process.env.FAKE_FAIL_GENERATION = bad.id

    const port = await freePort()
    process.env.FAKE_PORT = String(port)
    process.env.DSH_EVOLVE_READY = join(layout.root, 'ready')
    const supervisor = new Supervisor({
      repositoryRoot: root,
      command: ['node', FAKE_APP],
      healthPort: port,
      startupTimeoutMs: 4_000,
      pollIntervalMs: 25,
      minUptimeMs: 50,
      terminateGraceMs: 500,
      maxConsecutiveFailures: 2,
    })
    const controller = new AbortController()
    controllers.push(controller)
    const done = supervisor.run(controller.signal)

    await waitFor(async () => (await readState(layout.stateFile)).current === good.id)
    controller.abort()
    await done

    const state = await readState(layout.stateFile)
    expect(state.current).toBe(good.id)
    expect(state.lastKnownGood).toBe(good.id)
    expect(state.generations.find(g => g.id === bad.id)?.status).toBe('failed')

    const journal = await readJournal(layout.journalFile)
    expect(journal.some(entry => entry.detail.event === 'auto-rollback')).toBe(true)
    // The rollback is committed to the audit trail, so a reviewer can see what happened.
    expect(journal.filter(entry => entry.phase === 'rollback')).toHaveLength(1)
  })
})
