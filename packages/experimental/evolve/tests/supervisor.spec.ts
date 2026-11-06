import { access } from 'node:fs/promises'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { rm } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { activateGeneration, recordHealthyStart, writeRestartRequest } from '../src/activation.ts'
import { proposeGeneration, resolveLayout } from '../src/generations.ts'
import type { EvolveLayout } from '../src/generations.ts'
import { readJournal } from '../src/journal.ts'
import { buildGeneration, verifyGeneration } from '../src/lifecycle.ts'
import { readState } from '../src/state.ts'
import { Supervisor } from '../src/supervisor.ts'
import type { SupervisorConfig } from '../src/supervisor.ts'
import { cleanup, PASSING_COMMAND, repository, stepOptions } from './harness.ts'

const FAKE_APP = fileURLToPath(new URL('./fixtures/fake-app.mjs', import.meta.url))

const roots: string[] = []
const supervisors: AbortController[] = []

beforeEach(() => {
  // The supervisor inherits the test process environment, so the fixture reads its behaviour here.
  delete process.env.FAKE_FAIL_GENERATION
})

afterEach(async () => {
  for (const controller of supervisors.splice(0)) controller.abort()
  delete process.env.FAKE_PORT
  delete process.env.DSH_EVOLVE_READY
  delete process.env.FAKE_FAIL_GENERATION
  for (const root of roots.splice(0)) await cleanup(root)
})

async function repo(): Promise<string> {
  const path = await repository()
  roots.push(path)
  return path
}

/** Reserve a port by binding and releasing it. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>(resolve => server.close(() => { resolve() }))
  return port
}

/** Propose, build, and verify one generation. */
async function verified(layout: EvolveLayout): Promise<string> {
  const { generation } = await proposeGeneration(layout)
  await buildGeneration(layout, stepOptions(generation.id, PASSING_COMMAND))
  await verifyGeneration(layout, stepOptions(generation.id, PASSING_COMMAND), 3)
  return generation.id
}

/** Whether a path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Discard a restart request written before the supervisor started, standing in for a supervisor
 * that already consumed it.
 */
async function consumePendingSentinel(layout: EvolveLayout): Promise<void> {
  await rm(layout.sentinelFile, { force: true })
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

async function configure(root: string, port: number): Promise<SupervisorConfig> {
  process.env.FAKE_PORT = String(port)
  process.env.DSH_EVOLVE_READY = `${resolveLayout(root).root}/ready`
  return {
    repositoryRoot: root,
    command: ['node', FAKE_APP],
    healthPort: port,
    startupTimeoutMs: 4_000,
    pollIntervalMs: 25,
    minUptimeMs: 50,
    terminateGraceMs: 500,
    maxConsecutiveFailures: 2,
  }
}

function start(supervisor: Supervisor): { done: Promise<void>; controller: AbortController } {
  const controller = new AbortController()
  supervisors.push(controller)
  return { done: supervisor.run(controller.signal), controller }
}

async function spawnCount(layout: EvolveLayout): Promise<number> {
  return (await readJournal(layout.journalFile)).filter(entry => entry.detail.event === 'spawn').length
}

describe('supervisor', () => {
  it('boots the source checkout when no generation is current', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const port = await freePort()
    const supervisor = new Supervisor(await configure(root, port))
    const { done, controller } = start(supervisor)

    await waitFor(async () => await exists(`${layout.root}/ready`))
    expect(await spawnCount(layout)).toBe(1)
    controller.abort()
    await done

    const state = await readState(layout.stateFile)
    expect(state.current).toBeNull()
    expect(state.lastKnownGood).toBeNull()
  })

  it('boots the current generation and records it as known good', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const id = await verified(layout)
    await activateGeneration(layout, { id, reason: 'ready to serve' })
    await consumePendingSentinel(layout)
    const port = await freePort()
    const supervisor = new Supervisor(await configure(root, port))
    const { done, controller } = start(supervisor)

    await waitFor(async () => (await readState(layout.stateFile)).lastKnownGood === id)
    controller.abort()
    await done

    expect((await readState(layout.stateFile)).current).toBe(id)
  })

  it('rolls back to the last generation known to boot when the current one fails to start', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const good = await verified(layout)
    await activateGeneration(layout, { id: good, reason: 'first' })
    await consumePendingSentinel(layout)
    await recordHealthyStart(layout, good)

    const bad = await verified(layout)
    await activateGeneration(layout, { id: bad, reason: 'second' })
    await consumePendingSentinel(layout)
    process.env.FAKE_FAIL_GENERATION = bad

    const port = await freePort()
    const supervisor = new Supervisor(await configure(root, port))
    const { done, controller } = start(supervisor)

    await waitFor(async () => (await readState(layout.stateFile)).current === good)
    controller.abort()
    await done

    const state = await readState(layout.stateFile)
    expect(state.current).toBe(good)
    expect(state.generations.find(generation => generation.id === bad)?.status).toBe('failed')
    const journal = await readJournal(layout.journalFile)
    expect(journal.some(entry => entry.detail.event === 'auto-rollback')).toBe(true)
    expect(journal.filter(entry => entry.phase === 'supervisor' && entry.outcome === 'failed')).toHaveLength(0)
  })

  it('restarts after the agent writes a restart request', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const id = await verified(layout)
    await activateGeneration(layout, { id, reason: 'first' })
    await consumePendingSentinel(layout)
    const port = await freePort()
    const supervisor = new Supervisor(await configure(root, port))
    const { done, controller } = start(supervisor)

    await waitFor(async () => (await readState(layout.stateFile)).lastKnownGood === id)
    expect(await spawnCount(layout)).toBe(1)

    await writeRestartRequest(layout, {
      requestedAt: new Date().toISOString(),
      generation: id,
      reason: 'second',
      requestedBy: 'agent',
    })
    await waitFor(async () => (await spawnCount(layout)) === 2)

    controller.abort()
    await done
  })

  it('refuses a launch command that names no executable', async () => {
    const root = await repo()
    const port = await freePort()
    const config = { ...await configure(root, port), command: [] }
    expect(() => new Supervisor(config)).toThrow(/launch command/)
  })
})
