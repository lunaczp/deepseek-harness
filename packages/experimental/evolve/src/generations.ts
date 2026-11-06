/**
 * Generation layout and the `propose` transaction step.
 *
 * A proposal creates one Git worktree from a resolved commit and records it; it never touches the
 * source checkout, so a discarded proposal leaves the main line exactly as it was. Nothing here
 * builds, verifies, or activates — later steps own those, which keeps a failed proposal cheap.
 * @module @deepseek-ai/dsh-evolve/generations
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveCommit, runGit } from './git.ts'
import { appendJournal } from './journal.ts'
import { nextGenerationId } from './id.ts'
import { readState, writeState } from './state.ts'
import type { EvolveState, GenerationRecord } from './state.ts'

/** Absolute paths of every file and directory the evolve system owns for one repository. */
export interface EvolveLayout {
  /** Checkout the generations are worktrees of. */
  repositoryRoot: string
  /** Runtime state directory, ignored by Git. */
  root: string
  /** Directory holding one worktree per generation. */
  generationsDirectory: string
  /** Durable pointer and generation state. */
  stateFile: string
  /** Append-only audit journal. */
  journalFile: string
  /** Restart request watched by the supervisor. */
  sentinelFile: string
}

/**
 * Derive every owned path for a repository.
 * @param repositoryRoot - absolute checkout directory.
 * @returns the complete layout rooted at `<repositoryRoot>/evolve`.
 */
export function resolveLayout(repositoryRoot: string): EvolveLayout {
  const root = join(repositoryRoot, 'evolve')
  return {
    repositoryRoot,
    root,
    generationsDirectory: join(root, 'generations'),
    stateFile: join(root, 'state.json'),
    journalFile: join(root, 'journal.jsonl'),
    sentinelFile: join(root, 'restart-request.json'),
  }
}

/** Caller-supplied proposal inputs. */
export interface ProposeOptions {
  /** Revision to base the generation on; defaults to `HEAD`. */
  from?: string
  /** Free-form note recorded with the generation. */
  note?: string
  /** Clock override for deterministic tests. */
  now?: () => Date
}

/** A committed proposal plus the state it produced. */
export interface ProposedGeneration {
  /** The recorded generation. */
  generation: GenerationRecord
  /** Complete state after the proposal. */
  state: EvolveState
}

/**
 * Create one generation worktree from a resolved commit and record it.
 *
 * The worktree is created before the state document is replaced, so any Git failure leaves the
 * previous state untouched and the journal carries the failed attempt against its prospective
 * identifier.
 * @param layout - owned paths for this repository.
 * @param options - revision, note, and clock override.
 * @returns the new generation and the state that now includes it.
 * @throws Error when evolution is halted, or when Git cannot resolve the revision or create the worktree.
 */
export async function proposeGeneration(
  layout: EvolveLayout,
  options: ProposeOptions = {},
): Promise<ProposedGeneration> {
  const now = options.now ?? (() => new Date())
  const state = await readState(layout.stateFile)
  if (state.halted) {
    throw new Error('evolution is halted; clear the halt before proposing another generation')
  }

  const id = nextGenerationId(state.generations)
  const branch = `evolve/${id}`
  const path = join(layout.generationsDirectory, id)
  const createdAt = now().toISOString()

  try {
    const baseCommit = await resolveCommit(layout.repositoryRoot, options.from ?? 'HEAD')
    await mkdir(layout.generationsDirectory, { recursive: true })
    await runGit(layout.repositoryRoot, ['worktree', 'add', '-b', branch, path, baseCommit])

    const generation: GenerationRecord = {
      id,
      branch,
      path,
      baseCommit,
      createdAt,
      status: 'proposed',
      ...options.note === undefined ? {} : { note: options.note },
    }
    const next: EvolveState = { ...state, generations: [...state.generations, generation] }
    await writeState(layout.stateFile, next)
    await appendJournal(layout.journalFile, {
      at: createdAt,
      phase: 'propose',
      generation: id,
      outcome: 'ok',
      detail: { branch, baseCommit, path },
    })
    return { generation, state: next }
  } catch (error) {
    await appendJournal(layout.journalFile, {
      at: createdAt,
      phase: 'propose',
      generation: id,
      outcome: 'failed',
      detail: { reason: error instanceof Error ? error.message : String(error), path },
    })
    throw error
  }
}
