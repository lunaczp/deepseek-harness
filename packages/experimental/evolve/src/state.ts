/**
 * Durable generation state shared by the agent and the supervisor.
 *
 * The state file is the single authority for which generation is current and which is known to boot.
 * Both processes write it through a temporary file and a rename, so a reader never observes a
 * half-written document, and the supervisor never depends on the agent process staying alive.
 * @module @deepseek-ai/dsh-evolve/state
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Lifecycle position of one generation. */
export type GenerationStatus =
  | 'proposed'
  | 'built'
  | 'verified'
  | 'failed'
  | 'active'
  | 'superseded'

/** One generation directory, its branch, and its lifecycle position. */
export interface GenerationRecord {
  /** Stable identifier, `gen-NNNN`. */
  id: string
  /** Git branch checked out in the generation directory. */
  branch: string
  /** Absolute generation directory. */
  path: string
  /** Commit the generation was created from. */
  baseCommit: string
  /** ISO-8601 creation timestamp. */
  createdAt: string
  /** Lifecycle position. */
  status: GenerationStatus
  /** Free-form note supplied by the proposer, when any. */
  note?: string
}

/** Durable evolve state; the only record the supervisor trusts for pointers. */
export interface EvolveState {
  /** State document version, so a future reader can refuse an unknown layout. */
  version: 1
  /** Generation the supervisor should boot, or null before the first activation. */
  current: string | null
  /** Generation known to boot successfully, or null before the first healthy start. */
  lastKnownGood: string | null
  /** Consecutive verify failures; the halt threshold counts these. */
  consecutiveVerifyFailures: number
  /** Whether automatic evolution has been halted pending human intervention. */
  halted: boolean
  /** Every generation ever proposed, in creation order. */
  generations: GenerationRecord[]
}

/**
 * Build the state of a repository that has never proposed a generation.
 * @returns a state document with no pointers, no generations, and no failures.
 */
export function emptyState(): EvolveState {
  return {
    version: 1,
    current: null,
    lastKnownGood: null,
    consecutiveVerifyFailures: 0,
    halted: false,
    generations: [],
  }
}

/**
 * Read the durable state document.
 * @param file - absolute state path.
 * @returns the recorded state, or {@link emptyState} when no document exists yet.
 */
export async function readState(file: string): Promise<EvolveState> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    // An absent state document is a repository that has not started evolving.
    if ((error as { code?: unknown }).code === 'ENOENT') return emptyState()
    throw error
  }
  return JSON.parse(raw) as EvolveState
}

/**
 * Replace the durable state document atomically.
 * @param file - absolute state path.
 * @param state - complete state to persist.
 * @returns when the rename has published the new document.
 */
export async function writeState(file: string, state: EvolveState): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const staged = `${file}.tmp`
  await writeFile(staged, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(staged, file)
}

/**
 * Find one generation by identifier.
 * @param state - state to search.
 * @param id - generation identifier.
 * @returns the matching record.
 * @throws Error when no generation carries the identifier.
 */
export function requireGeneration(state: EvolveState, id: string): GenerationRecord {
  const record = state.generations.find(candidate => candidate.id === id)
  if (record === undefined) throw new Error(`unknown generation: ${id}`)
  return record
}
