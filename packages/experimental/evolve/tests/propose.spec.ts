import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as evolve from '../src/index.ts'
import { proposeGeneration, resolveLayout } from '../src/generations.ts'
import { nextGenerationId } from '../src/id.ts'
import { readJournal } from '../src/journal.ts'
import { readState, writeState } from '../src/state.ts'
import type { GenerationRecord } from '../src/state.ts'
import { cleanup, git, pluginConfig, repository } from './harness.ts'

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

function record(id: string): GenerationRecord {
  return { id, branch: `evolve/${id}`, path: `/fixture/${id}`, baseCommit: '0'.repeat(40), createdAt: '2026-01-01T00:00:00.000Z', status: 'proposed' }
}

describe('generation identifiers', () => {
  it('continues the sequence after the highest recorded identifier', () => {
    expect(nextGenerationId([])).toBe('gen-0001')
    expect(nextGenerationId([record('gen-0001')])).toBe('gen-0002')
    expect(nextGenerationId([record('gen-0001'), record('gen-0009'), record('gen-0003')])).toBe('gen-0010')
  })
})

describe('propose', () => {
  it('creates an isolated worktree and records it without touching the source checkout', async () => {
    const root = await repo()
    const layout = resolveLayout(root)

    const proposed = await proposeGeneration(layout)

    expect(proposed.generation.id).toBe('gen-0001')
    expect(proposed.generation.branch).toBe('evolve/gen-0001')
    expect(proposed.generation.status).toBe('proposed')
    expect(await readFile(join(proposed.generation.path, 'tracked.txt'), 'utf8')).toBe('initial\n')
    expect(await git(proposed.generation.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('evolve/gen-0001')

    const state = await readState(layout.stateFile)
    expect(state.current).toBeNull()
    expect(state.generations).toHaveLength(1)
    expect(state.generations[0]?.baseCommit).toBe(proposed.generation.baseCommit)

    const journal = await readJournal(layout.journalFile)
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({ phase: 'propose', generation: 'gen-0001', outcome: 'ok' })

    expect(await git(root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main')
    expect(await git(root, 'status', '--porcelain')).toBe('')
  })

  it('allocates a new worktree for each proposal and keeps earlier ones intact', async () => {
    const root = await repo()
    const layout = resolveLayout(root)

    const first = await proposeGeneration(layout)
    const second = await proposeGeneration(layout)

    expect(first.generation.id).toBe('gen-0001')
    expect(second.generation.id).toBe('gen-0002')
    expect(first.generation.path).not.toBe(second.generation.path)
    expect(await readFile(join(first.generation.path, 'tracked.txt'), 'utf8')).toBe('initial\n')
    expect(await readFile(join(second.generation.path, 'tracked.txt'), 'utf8')).toBe('initial\n')
    expect((await readState(layout.stateFile)).generations.map(g => g.id)).toEqual(['gen-0001', 'gen-0002'])
  })

  it('records the note and the requested base revision', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const head = await git(root, 'rev-parse', 'HEAD')

    const proposed = await proposeGeneration(layout, { note: 'tighten the tool description', from: 'HEAD' })

    expect(proposed.generation.note).toBe('tighten the tool description')
    expect(proposed.generation.baseCommit).toBe(head)
  })

  it('refuses to propose while halted and leaves the state unchanged', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    const proposed = await proposeGeneration(layout)
    await writeState(layout.stateFile, { ...proposed.state, halted: true })

    await expect(proposeGeneration(layout)).rejects.toThrow(/halted/)
    const state = await readState(layout.stateFile)
    expect(state.generations).toHaveLength(1)
    expect(state.halted).toBe(true)
  })

  it('journals a proposal whose base revision cannot be resolved', async () => {
    const root = await repo()
    const layout = resolveLayout(root)

    await expect(proposeGeneration(layout, { from: 'not-a-revision' })).rejects.toThrow(/not-a-revision/)

    const state = await readState(layout.stateFile)
    expect(state.generations).toHaveLength(0)
    const journal = await readJournal(layout.journalFile)
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({ phase: 'propose', generation: 'gen-0001', outcome: 'failed' })
  })
})

describe('evolve_propose tool', () => {
  it('creates a generation through the tool pipeline', async () => {
    const root = await repo()
    const layout = resolveLayout(root)
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(evolve, pluginConfig(root))

    const result = await executeToolFixture(ctx, {
      signal: new AbortController().signal,
      callId: ToolCallId('evolve-call'),
      name: 'evolve_propose',
      arguments: { note: 'via tool' },
    })

    expect(result.isError).toBe(false)
    const state = await readState(layout.stateFile)
    expect(state.generations).toHaveLength(1)
    expect(state.generations[0]?.note).toBe('via tool')
    expect(await readFile(join(state.generations[0]?.path ?? '', 'tracked.txt'), 'utf8')).toBe('initial\n')
  })
})
