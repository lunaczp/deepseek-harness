import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as evolve from '../src/index.ts'
import { activateGeneration, recordHealthyStart, rollbackGeneration } from '../src/activation.ts'
import type { RestartRequest } from '../src/activation.ts'
import type { EvolveLayout } from '../src/generations.ts'
import { proposeGeneration, resolveLayout } from '../src/generations.ts'
import { readJournal } from '../src/journal.ts'
import { buildGeneration, verifyGeneration } from '../src/lifecycle.ts'
import { readState, writeState } from '../src/state.ts'
import { cleanup, FAILING_COMMAND, PASSING_COMMAND, pluginConfig, repository, stepOptions } from './harness.ts'

const roots: string[] = []
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  for (const root of roots.splice(0)) await cleanup(root)
})

async function repo(): Promise<string> {
  const path = await repository()
  roots.push(path)
  return path
}

/** Propose, build, and verify one generation, returning its identifier. */
async function verified(layout: EvolveLayout): Promise<string> {
  const { generation } = await proposeGeneration(layout)
  await buildGeneration(layout, stepOptions(generation.id, PASSING_COMMAND))
  await verifyGeneration(layout, stepOptions(generation.id, PASSING_COMMAND), 3)
  return generation.id
}

async function readSentinel(layout: EvolveLayout): Promise<RestartRequest> {
  return JSON.parse(await readFile(layout.sentinelFile, 'utf8')) as RestartRequest
}

describe('activate', () => {
  it('makes a verified generation current and writes a restart request', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const id = await verified(layout)

    const result = await activateGeneration(layout, { id, reason: 'tests pass' })

    expect(result.generation).toBe(id)
    expect(result.previous).toBeNull()
    const state = await readState(layout.stateFile)
    expect(state.current).toBe(id)
    expect(state.generations[0]?.status).toBe('active')
    // Activation is not a health claim: the supervisor alone advances lastKnownGood.
    expect(state.lastKnownGood).toBeNull()

    expect(await readSentinel(layout)).toMatchObject({ generation: id, reason: 'tests pass', requestedBy: 'agent' })
    expect((await readJournal(layout.journalFile)).at(-1)).toMatchObject({ phase: 'activate', outcome: 'ok' })
  })

  it('refuses a generation that has not been verified', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const { generation } = await proposeGeneration(layout)

    await expect(activateGeneration(layout, { id: generation.id, reason: 'premature' })).rejects.toThrow(/not verified/)
    expect((await readState(layout.stateFile)).current).toBeNull()
  })

  it('refuses while halted', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const id = await verified(layout)
    const state = await readState(layout.stateFile)
    await writeState(layout.stateFile, { ...state, halted: true })

    await expect(activateGeneration(layout, { id, reason: 'halted attempt' })).rejects.toThrow(/halted/)
  })

  it('supersedes the previously current generation', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const first = await verified(layout)
    await activateGeneration(layout, { id: first, reason: 'first' })
    const second = await verified(layout)

    const result = await activateGeneration(layout, { id: second, reason: 'second' })

    expect(result.previous).toBe(first)
    const state = await readState(layout.stateFile)
    expect(state.current).toBe(second)
    expect(state.generations.find(g => g.id === first)?.status).toBe('superseded')
    expect(state.generations.find(g => g.id === second)?.status).toBe('active')
  })
})

describe('rollback', () => {
  it('refuses when no generation has ever booted successfully', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    await verified(layout)

    await expect(rollbackGeneration(layout, { reason: 'nothing to restore' })).rejects.toThrow(/last-known-good/)
  })

  it('restores the last generation known to boot', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const good = await verified(layout)
    await activateGeneration(layout, { id: good, reason: 'first' })
    await recordHealthyStart(layout, good)

    const bad = await verified(layout)
    await activateGeneration(layout, { id: bad, reason: 'second' })
    const result = await rollbackGeneration(layout, { reason: 'health check failed' })

    expect(result.generation).toBe(good)
    expect(result.previous).toBe(bad)
    const state = await readState(layout.stateFile)
    expect(state.current).toBe(good)
    expect(state.lastKnownGood).toBe(good)
    expect(state.generations.find(g => g.id === bad)?.status).toBe('failed')
    expect(await readSentinel(layout)).toMatchObject({ generation: good, reason: 'health check failed' })
    expect((await readJournal(layout.journalFile)).at(-1)).toMatchObject({ phase: 'rollback', outcome: 'ok' })
  })

  it('honors an explicit target', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const first = await verified(layout)
    const second = await verified(layout)
    await activateGeneration(layout, { id: second, reason: 'second' })

    const result = await rollbackGeneration(layout, { reason: 'pick first', to: first })

    expect(result.generation).toBe(first)
    expect((await readState(layout.stateFile)).current).toBe(first)
  })

  it('refuses a target whose verification failed', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const good = await verified(layout)
    await recordHealthyStart(layout, good)

    const { generation: broken } = await proposeGeneration(layout)
    await buildGeneration(layout, stepOptions(broken.id, PASSING_COMMAND))
    await verifyGeneration(layout, stepOptions(broken.id, FAILING_COMMAND), 3)

    await expect(rollbackGeneration(layout, { reason: 'try the broken one', to: broken.id }))
      .rejects.toThrow(/failed and cannot be activated/)
    expect((await readState(layout.stateFile)).current).toBeNull()
  })
})

describe('activation tools', () => {
  it('activates and rolls back through the tool pipeline', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const context = new Context()
    ctx = context
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntime)
    await context.plugin(NativeToolExecutor)
    await context.plugin(evolve, pluginConfig(root))

    const call = (callName: string, argumentsValue: Record<string, string>) => executeToolFixture(context, {
      signal: new AbortController().signal,
      callId: ToolCallId(`${callName}-call`),
      name: callName,
      arguments: argumentsValue,
    })

    expect((await call('evolve_propose', {})).isError).toBe(false)
    expect((await call('evolve_build', { generation: 'gen-0001' })).isError).toBe(false)
    expect((await call('evolve_verify', { generation: 'gen-0001' })).isError).toBe(false)
    expect((await call('evolve_activate', { generation: 'gen-0001', reason: 'ready' })).isError).toBe(false)
    expect((await readState(layout.stateFile)).current).toBe('gen-0001')

    await recordHealthyStart(layout, 'gen-0001')
    expect((await call('evolve_rollback', { reason: 'reverted' })).isError).toBe(false)
    expect((await readState(layout.stateFile)).current).toBe('gen-0001')
  })
})
