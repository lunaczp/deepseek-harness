import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as evolve from '../src/index.ts'
import { proposeGeneration, resolveLayout } from '../src/generations.ts'
import { readJournal } from '../src/journal.ts'
import { buildGeneration, verifyGeneration } from '../src/lifecycle.ts'
import { readState } from '../src/state.ts'
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

describe('build', () => {
  it('marks a proposed generation built and journals the command', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const { generation } = await proposeGeneration(layout)

    const result = await buildGeneration(layout, stepOptions(generation.id, PASSING_COMMAND))

    expect(result.ok).toBe(true)
    expect(result.status).toBe('built')
    expect(result.output).toContain('v')
    expect((await readState(layout.stateFile)).generations[0]?.status).toBe('built')
    const journal = await readJournal(layout.journalFile)
    expect(journal.at(-1)).toMatchObject({ phase: 'build', generation: generation.id, outcome: 'ok' })
  })

  it('marks a generation failed when the build command exits non-zero', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const { generation } = await proposeGeneration(layout)

    const result = await buildGeneration(layout, stepOptions(generation.id, FAILING_COMMAND))

    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(3)
    expect(result.status).toBe('failed')
    expect((await readState(layout.stateFile)).generations[0]?.status).toBe('failed')
    expect((await readJournal(layout.journalFile)).at(-1)).toMatchObject({ phase: 'build', outcome: 'failed' })
  })

  it('refuses to build a generation that is no longer proposed', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const { generation } = await proposeGeneration(layout)
    await buildGeneration(layout, stepOptions(generation.id, PASSING_COMMAND))

    await expect(buildGeneration(layout, stepOptions(generation.id, PASSING_COMMAND))).rejects.toThrow(/not proposed/)
  })

  it('bounds the returned output', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const { generation } = await proposeGeneration(layout)

    const result = await buildGeneration(layout, stepOptions(
      generation.id,
      ['node', '-e', 'process.stdout.write("x".repeat(5000)); process.exit(1)'],
      { maxOutputChars: 50 },
    ))

    expect(result.output.length).toBeLessThan(120)
    expect(result.output).toContain('[truncated]')
  })
})

describe('verify', () => {
  it('marks a built generation verified and clears the failure budget', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const { generation } = await proposeGeneration(layout)
    await buildGeneration(layout, stepOptions(generation.id, PASSING_COMMAND))

    const result = await verifyGeneration(layout, stepOptions(generation.id, PASSING_COMMAND), 3)

    expect(result.ok).toBe(true)
    expect(result.status).toBe('verified')
    expect(result.consecutiveVerifyFailures).toBe(0)
    const state = await readState(layout.stateFile)
    expect(state.halted).toBe(false)
    expect(state.generations[0]?.status).toBe('verified')
  })

  it('refuses to verify a generation that has not been built', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const { generation } = await proposeGeneration(layout)

    await expect(verifyGeneration(layout, stepOptions(generation.id, PASSING_COMMAND), 3)).rejects.toThrow(/not built/)
  })

  it('halts automatic evolution after the configured number of consecutive failures', async () => {
    const root = await repo()
    const layout = resolveLayout(root)

    for (let round = 1; round <= 3; round++) {
      const { generation } = await proposeGeneration(layout)
      await buildGeneration(layout, stepOptions(generation.id, PASSING_COMMAND))
      const result = await verifyGeneration(layout, stepOptions(generation.id, FAILING_COMMAND), 3)
      expect(result.consecutiveVerifyFailures).toBe(round)
      expect(result.halted).toBe(round === 3)
    }

    const state = await readState(layout.stateFile)
    expect(state.halted).toBe(true)
    expect(state.consecutiveVerifyFailures).toBe(3)
    const journal = await readJournal(layout.journalFile)
    expect(journal.filter(entry => entry.phase === 'verify' && entry.outcome === 'failed')).toHaveLength(3)
  })

  it('refuses any further work once halted', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    for (let round = 1; round <= 3; round++) {
      const { generation } = await proposeGeneration(layout)
      await buildGeneration(layout, stepOptions(generation.id, PASSING_COMMAND))
      await verifyGeneration(layout, stepOptions(generation.id, FAILING_COMMAND), 3)
    }

    await expect(proposeGeneration(layout)).rejects.toThrow(/halted/)
  })
})

describe('build and verify tools', () => {
  it('drives one generation to verified through the tool pipeline', async () => {
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
    const id = (await readState(layout.stateFile)).generations[0]?.id ?? ''
    expect(id).toBe('gen-0001')

    expect((await call('evolve_build', { generation: id })).isError).toBe(false)
    expect((await call('evolve_verify', { generation: id })).isError).toBe(false)

    const state = await readState(layout.stateFile)
    expect(state.generations[0]?.status).toBe('verified')
    expect(state.halted).toBe(false)
  })
})
