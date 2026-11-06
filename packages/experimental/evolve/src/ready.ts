/**
 * Readiness handshake for the supervisor.
 *
 * The plugin writes this file once it has registered its tools, so the supervisor's health probe
 * observes that the application started *and* loaded the plugin tree, not merely that a process
 * exists on a port. The supervisor removes the file before each spawn, which bounds the handshake
 * to the current process.
 * @module @deepseek-ai/dsh-evolve/ready
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EvolveLayout } from './generations.ts'

/**
 * Publish the readiness handshake for the current process.
 * @param layout - owned paths for this repository.
 * @param now - clock override for deterministic tests.
 */
export async function markReady(layout: EvolveLayout, now: () => Date = () => new Date()): Promise<void> {
  await mkdir(layout.root, { recursive: true })
  await writeFile(join(layout.root, 'ready'), `${now().toISOString()}\n`, 'utf8')
}
