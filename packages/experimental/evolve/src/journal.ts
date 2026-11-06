/**
 * Append-only audit journal for generations.
 *
 * One JSON object per line, written and flushed before the operation that produced it returns, so a
 * crashed process leaves a readable prefix. The journal is the machine-readable record: the
 * supervisor writes to it as well as the agent, which the Session log cannot express.
 * @module @deepseek-ai/dsh-evolve/journal
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Phases a generation moves through, plus the supervisor's own observations. */
export type JournalPhase = 'propose' | 'build' | 'verify' | 'activate' | 'rollback' | 'supervisor'

/** Outcome of one journaled operation. */
export type JournalOutcome = 'ok' | 'failed'

/** Values a journal detail field may carry. */
export type JournalDetail = Record<string, string | number | boolean | null>

/** One journaled operation. */
export interface JournalEntry {
  /** ISO-8601 timestamp recorded when the operation settled. */
  at: string
  /** Phase the operation belongs to. */
  phase: JournalPhase
  /** Generation the operation acted on, or `-` for supervisor-wide events. */
  generation: string
  /** Whether the operation succeeded. */
  outcome: JournalOutcome
  /** Phase-specific fields; must stay JSON-serializable and flat. */
  detail: JournalDetail
}

/**
 * Append one entry to the journal, creating its directory when absent.
 * @param file - absolute journal path.
 * @param entry - the settled operation to record.
 * @returns when the entry has been written.
 */
export async function appendJournal(file: string, entry: JournalEntry): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8')
}

/**
 * Read every complete journal entry.
 * @param file - absolute journal path.
 * @returns parsed entries in write order; empty when the journal does not exist yet.
 */
export async function readJournal(file: string): Promise<JournalEntry[]> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    // A missing journal is the empty history, not a failure to report.
    if ((error as { code?: unknown }).code === 'ENOENT') return []
    throw error
  }
  const entries: JournalEntry[] = []
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    entries.push(JSON.parse(line) as JournalEntry)
  }
  return entries
}
