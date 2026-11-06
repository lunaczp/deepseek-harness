/**
 * The build and verify transaction steps.
 *
 * Each step runs a deployment-supplied command inside the generation directory and records the
 * outcome before returning. Verify owns the failure budget: consecutive failures increment a
 * counter and halt automatic evolution at the configured threshold, while one success clears it.
 * A halting verify is a terminal state for the agent — only a human clears it.
 * @module @deepseek-ai/dsh-evolve/lifecycle
 */

import { access, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { outputTail, runCommand } from './commands.ts'
import { appendJournal } from './journal.ts'
import { readState, requireGeneration, writeState } from './state.ts'
import type { EvolveLayout } from './generations.ts'
import type { EvolveState, GenerationRecord, GenerationStatus } from './state.ts'

/** Inputs shared by the build and verify steps. */
export interface StepOptions {
  /** Generation to act on. */
  id: string
  /** Executable followed by literal arguments, run inside the generation directory. */
  argv: readonly [string, ...string[]]
  /** Deadline for the command. */
  timeoutMs: number
  /** Maximum characters of captured output returned to the caller. */
  maxOutputChars: number
  /** Whether to link the source checkout's `node_modules` when the generation lacks one. */
  linkDependencies: boolean
  /** Clock override for deterministic tests. */
  now?: () => Date
}

/** Settled result of one transaction step. */
export interface StepResult {
  /** Whether the command succeeded. */
  ok: boolean
  /** Process exit status, or null when the command could not run or was killed. */
  exitCode: number | null
  /** Whether the deadline ended the command. */
  timedOut: boolean
  /** Bounded diagnostic text. */
  output: string
  /** Generation status after the step. */
  status: GenerationStatus
  /** Whether automatic evolution is now halted. */
  halted: boolean
  /** Consecutive verify failures after the step. */
  consecutiveVerifyFailures: number
}

/**
 * Whether a path exists.
 * @param path - absolute path to test.
 * @returns true when the path can be reached.
 */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // Absence is the answer this predicate asks for, not a failure to report.
    return false
  }
}

/**
 * Make the source checkout's installed dependencies visible to a generation.
 *
 * A generation is a fresh checkout with no `node_modules`; sharing the source checkout's tree keeps
 * the minimal loop fast. A change that adds or upgrades a dependency needs its own installation and
 * is out of scope for this step.
 * @param layout - owned paths for this repository.
 * @param generation - generation about to build.
 */
async function linkDependencies(layout: EvolveLayout, generation: GenerationRecord): Promise<void> {
  const target = join(generation.path, 'node_modules')
  if (await exists(target)) return
  await symlink(join(layout.repositoryRoot, 'node_modules'), target, 'dir')
}

/**
 * Replace one generation record and persist the state.
 * @param layout - owned paths for this repository.
 * @param state - state to derive from.
 * @param updated - the record to write in place of its predecessor.
 * @returns the persisted state.
 */
async function persistGeneration(
  layout: EvolveLayout,
  state: EvolveState,
  updated: GenerationRecord,
): Promise<EvolveState> {
  const next: EvolveState = {
    ...state,
    generations: state.generations.map(record => record.id === updated.id ? updated : record),
  }
  await writeState(layout.stateFile, next)
  return next
}

/**
 * Build one proposed generation by running the deployment's build command in its directory.
 * @param layout - owned paths for this repository.
 * @param options - generation, command, deadline, and dependency linking.
 * @returns the settled step result.
 * @throws Error when evolution is halted or the generation is not in the `proposed` status.
 */
export async function buildGeneration(layout: EvolveLayout, options: StepOptions): Promise<StepResult> {
  const now = options.now ?? (() => new Date())
  const state = await readState(layout.stateFile)
  if (state.halted) throw new Error('evolution is halted; clear the halt before building')
  const generation = requireGeneration(state, options.id)
  if (generation.status !== 'proposed') {
    throw new Error(`generation ${generation.id} is ${generation.status}, not proposed`)
  }

  if (options.linkDependencies) await linkDependencies(layout, generation)
  const outcome = await runCommand(generation.path, options.argv, options.timeoutMs)
  const ok = outcome.exitCode === 0
  const at = now().toISOString()

  const persisted = await persistGeneration(layout, state, { ...generation, status: ok ? 'built' : 'failed' })
  await appendJournal(layout.journalFile, {
    at,
    phase: 'build',
    generation: generation.id,
    outcome: ok ? 'ok' : 'failed',
    detail: { exitCode: outcome.exitCode, timedOut: outcome.timedOut, command: options.argv.join(' ') },
  })
  return {
    ok,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    output: outputTail(outcome, options.maxOutputChars),
    status: ok ? 'built' : 'failed',
    halted: persisted.halted,
    consecutiveVerifyFailures: persisted.consecutiveVerifyFailures,
  }
}

/**
 * Verify one built generation, advancing the failure budget.
 * @param layout - owned paths for this repository.
 * @param options - generation, command, deadline, and dependency linking.
 * @param maxConsecutiveFailures - failure count that halts automatic evolution.
 * @returns the settled step result.
 * @throws Error when evolution is halted or the generation is not in the `built` status.
 */
export async function verifyGeneration(
  layout: EvolveLayout,
  options: StepOptions,
  maxConsecutiveFailures: number,
): Promise<StepResult> {
  const now = options.now ?? (() => new Date())
  const state = await readState(layout.stateFile)
  if (state.halted) throw new Error('evolution is halted; clear the halt before verifying')
  const generation = requireGeneration(state, options.id)
  if (generation.status !== 'built') {
    throw new Error(`generation ${generation.id} is ${generation.status}, not built`)
  }

  if (options.linkDependencies) await linkDependencies(layout, generation)
  const outcome = await runCommand(generation.path, options.argv, options.timeoutMs)
  const ok = outcome.exitCode === 0
  const failures = ok ? 0 : state.consecutiveVerifyFailures + 1
  const halted = !ok && failures >= maxConsecutiveFailures
  const at = now().toISOString()

  const persisted = await persistGeneration(layout, state, { ...generation, status: ok ? 'verified' : 'failed' })
  const next: EvolveState = {
    ...persisted,
    consecutiveVerifyFailures: failures,
    halted: persisted.halted || halted,
  }
  await writeState(layout.stateFile, next)
  await appendJournal(layout.journalFile, {
    at,
    phase: 'verify',
    generation: generation.id,
    outcome: ok ? 'ok' : 'failed',
    detail: {
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      failures,
      halted: next.halted,
      command: options.argv.join(' '),
    },
  })
  return {
    ok,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    output: outputTail(outcome, options.maxOutputChars),
    status: ok ? 'verified' : 'failed',
    halted: next.halted,
    consecutiveVerifyFailures: failures,
  }
}
