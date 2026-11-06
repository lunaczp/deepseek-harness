/**
 * Generation identifier allocation.
 *
 * Identifiers are a dense, gap-free sequence rather than a clock or random value, so the journal,
 * the state document, and the directory listing order identically and a reviewer can see how many
 * proposals were ever made.
 * @module @deepseek-ai/dsh-evolve/id
 */

import type { GenerationRecord } from './state.ts'

/** Prefix every generation identifier carries. */
const PREFIX = 'gen-'

/** Digits in the sequence field, matching the directory listing order. */
const DIGITS = 4

/**
 * Allocate the next identifier after every recorded generation.
 * @param generations - generations already recorded, in any order.
 * @returns the next identifier, formatted `gen-NNNN`.
 */
export function nextGenerationId(generations: readonly GenerationRecord[]): string {
  let highest = 0
  for (const generation of generations) {
    if (!generation.id.startsWith(PREFIX)) continue
    const sequence = Number(generation.id.slice(PREFIX.length))
    if (Number.isInteger(sequence) && sequence > highest) highest = sequence
  }
  return `${PREFIX}${String(highest + 1).padStart(DIGITS, '0')}`
}
