/**
 * Activation, rollback, and the restart sentinel.
 *
 * The agent never stops its own process. Activation moves the `current` pointer and writes a
 * restart request; the supervisor decides whether, when, and what to spawn. Writing the intent to a
 * file rather than signalling makes every restart request auditable and lets the supervisor apply
 * its own guards, such as refusing a restart inside a minimum uptime.
 *
 * `lastKnownGood` is owned by the supervisor: it advances only after a process started from that
 * generation passes its health check. The agent can therefore roll back to a generation proven to
 * boot, never to one it merely believes is fine.
 * @module @deepseek-ai/dsh-evolve/activation
 */

import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { appendJournal } from './journal.ts'
import { readState, requireGeneration, writeState } from './state.ts'
import type { EvolveLayout } from './generations.ts'
import type { EvolveState, GenerationRecord } from './state.ts'

/** Who asked for the restart recorded in the sentinel. */
export type RestartRequester = 'agent' | 'supervisor'

/** Durable restart request the supervisor consumes. */
export interface RestartRequest {
  /** ISO-8601 time the request was written. */
  requestedAt: string
  /** Generation the next process should boot. */
  generation: string
  /** Why the restart was requested. */
  reason: string
  /** Which side asked for it. */
  requestedBy: RestartRequester
}

/** Inputs shared by activation and rollback. */
export interface ActivationOptions {
  /** Generation to make current. */
  id: string
  /** Why this transition happened. */
  reason: string
  /** Clock override for deterministic tests. */
  now?: () => Date
}

/** Result of a pointer transition. */
export interface ActivationResult {
  /** Generation now marked current. */
  generation: string
  /** Generation that was current before the transition, if any. */
  previous: string | null
  /** Restart request written for the supervisor. */
  request: RestartRequest
}

/**
 * Write the restart sentinel atomically.
 * @param layout - owned paths for this repository.
 * @param request - complete request to publish.
 */
export async function writeRestartRequest(layout: EvolveLayout, request: RestartRequest): Promise<void> {
  await mkdir(dirname(layout.sentinelFile), { recursive: true })
  const staged = `${layout.sentinelFile}.tmp`
  await writeFile(staged, `${JSON.stringify(request, null, 2)}\n`, 'utf8')
  await rename(staged, layout.sentinelFile)
}

/**
 * Mark one generation active, supersede the previous one, and request a restart.
 * @param layout - owned paths for this repository.
 * @param options - generation, reason, and clock override.
 * @returns the completed transition.
 * @throws Error when evolution is halted or the generation has not been verified.
 */
export async function activateGeneration(
  layout: EvolveLayout,
  options: ActivationOptions,
): Promise<ActivationResult> {
  const now = options.now ?? (() => new Date())
  const state = await readState(layout.stateFile)
  if (state.halted) throw new Error('evolution is halted; clear the halt before activating')
  const generation = requireGeneration(state, options.id)
  if (generation.status !== 'verified') {
    throw new Error(`generation ${generation.id} is ${generation.status}, not verified`)
  }

  const at = now().toISOString()
  const previous = state.current
  const next: EvolveState = {
    ...state,
    current: generation.id,
    generations: state.generations.map(record => supersede(record, generation.id, previous, 'superseded')),
  }
  await writeState(layout.stateFile, next)
  const request: RestartRequest = {
    requestedAt: at,
    generation: generation.id,
    reason: options.reason,
    requestedBy: 'agent',
  }
  await writeRestartRequest(layout, request)
  await appendJournal(layout.journalFile, {
    at,
    phase: 'activate',
    generation: generation.id,
    outcome: 'ok',
    detail: { previous, reason: options.reason, baseCommit: generation.baseCommit },
  })
  return { generation: generation.id, previous, request }
}

/**
 * Point `current` back at the last generation known to boot.
 *
 * The agent calls this to ask the supervisor for a restart; the supervisor calls it with
 * `requestRestart: false` because it is already the process that will act.
 * @param layout - owned paths for this repository.
 * @param options - reason, optional explicit target, sentinel control, and clock override.
 * @returns the completed transition.
 * @throws Error when no last-known-good generation exists, or the requested target is unknown.
 */
export async function rollbackGeneration(
  layout: EvolveLayout,
  options: {
    reason: string
    to?: string
    now?: () => Date
    requestRestart?: boolean
    requestedBy?: RestartRequester
  },
): Promise<ActivationResult> {
  const now = options.now ?? (() => new Date())
  const state = await readState(layout.stateFile)
  const targetId = options.to ?? state.lastKnownGood
  if (targetId === null) {
    throw new Error('no last-known-good generation recorded; cannot roll back automatically')
  }
  const target = requireGeneration(state, targetId)
  if (target.status === 'failed') throw new Error(`generation ${target.id} failed and cannot be activated`)

  const at = now().toISOString()
  const previous = state.current
  const next: EvolveState = {
    ...state,
    current: target.id,
    generations: state.generations.map(record => supersede(record, target.id, previous, 'failed')),
  }
  await writeState(layout.stateFile, next)
  const requestedBy = options.requestedBy ?? 'agent'
  const request: RestartRequest = {
    requestedAt: at,
    generation: target.id,
    reason: options.reason,
    requestedBy,
  }
  if (options.requestRestart !== false) await writeRestartRequest(layout, request)
  await appendJournal(layout.journalFile, {
    at,
    phase: 'rollback',
    generation: target.id,
    outcome: 'ok',
    detail: { previous, reason: options.reason, baseCommit: target.baseCommit, requestedBy },
  })
  return { generation: target.id, previous, request }
}

/**
 * Record that a process booted from one generation passed its health check.
 *
 * Only the supervisor calls this; it is the sole path that advances `lastKnownGood`.
 * @param layout - owned paths for this repository.
 * @param id - generation the healthy process was started from.
 * @param now - clock override for deterministic tests.
 * @returns the persisted state.
 */
export async function recordHealthyStart(
  layout: EvolveLayout,
  id: string,
  now: () => Date = () => new Date(),
): Promise<EvolveState> {
  const state = await readState(layout.stateFile)
  requireGeneration(state, id)
  const next: EvolveState = { ...state, lastKnownGood: id, consecutiveVerifyFailures: 0 }
  await writeState(layout.stateFile, next)
  await appendJournal(layout.journalFile, {
    at: now().toISOString(),
    phase: 'supervisor',
    generation: id,
    outcome: 'ok',
    detail: { event: 'healthy-start' },
  })
  return next
}

/**
 * Apply one generation's new status within a pointer transition.
 * @param record - record being considered.
 * @param target - generation becoming current.
 * @param previous - generation that was current, if any.
 * @param replacementStatus - status the replaced generation receives when it is not the target.
 * @returns the record unchanged or with its new status.
 */
function supersede(
  record: GenerationRecord,
  target: string,
  previous: string | null,
  replacementStatus: GenerationRecord['status'],
): GenerationRecord {
  if (record.id === target) return { ...record, status: 'active' }
  if (record.id === previous) return { ...record, status: replacementStatus }
  return record
}
