/**
 * Bounded command execution for generation builds and checks.
 *
 * A build or check is an ordinary subprocess with a deadline and captured output; a non-zero exit is
 * an outcome the caller records, not an exception. Output is captured whole here and bounded by the
 * caller before it reaches a model, so a noisy compiler never floods the transcript.
 * @module @deepseek-ai/dsh-evolve/commands
 */

import { execFile } from 'node:child_process'

/** Maximum captured bytes per stream before the child is failed. */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024

/** Settled result of one command, successful or not. */
export interface CommandOutcome {
  /** Process exit status, or null when the command could not run or was killed. */
  exitCode: number | null
  /** Whether the deadline ended the command. */
  timedOut: boolean
  /** Complete captured standard output. */
  stdout: string
  /** Complete captured standard error. */
  stderr: string
}

/**
 * Run one executable without a shell.
 * @param cwd - directory the command runs in.
 * @param argv - executable followed by literal arguments.
 * @param timeoutMs - deadline after which the child is terminated.
 * @returns the settled outcome; a non-zero exit is returned rather than thrown.
 */
export function runCommand(
  cwd: string,
  argv: readonly [string, ...string[]],
  timeoutMs: number,
): Promise<CommandOutcome> {
  const [program, ...args] = argv
  return new Promise((resolve) => {
    execFile(program, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
      // Builds and checks must not wait on an interactive prompt.
      env: { ...process.env, CI: 'true' },
    }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ exitCode: 0, timedOut: false, stdout, stderr })
        return
      }
      const status: unknown = error.code
      resolve({
        exitCode: typeof status === 'number' ? status : null,
        timedOut: error.killed === true,
        stdout,
        stderr,
      })
    })
  })
}

/**
 * Reduce a command outcome to a bounded, model-readable tail.
 * @param outcome - settled command result.
 * @param maxChars - maximum characters to keep.
 * @returns the trailing diagnostic text, prefixed when truncated.
 */
export function outputTail(outcome: CommandOutcome, maxChars: number): string {
  const combined = [outcome.stdout, outcome.stderr].filter(part => part.length > 0).join('\n').trim()
  if (combined.length <= maxChars) return combined
  return `…[truncated]\n${combined.slice(combined.length - maxChars)}`
}
