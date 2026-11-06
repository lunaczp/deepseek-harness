/**
 * External supervisor: the only component that can replace the agent process.
 *
 * The agent cannot be its own parent, so process replacement lives here, outside the plugin tree.
 * The supervisor spawns the application, decides when it is healthy, consumes restart requests the
 * agent writes to the sentinel, and restores the last generation proven to boot when a new one
 * fails. It contains no prompts, no model calls, and no business logic.
 *
 * A restart is acted on only at a process boundary and only after the configured minimum uptime,
 * which bounds a failing generation to one attempt per uptime window instead of a restart storm.
 * @module @deepseek-ai/dsh-evolve/supervisor
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { rm, stat } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { recordHealthyStart, rollbackGeneration } from './activation.ts'
import { resolveLayout } from './generations.ts'
import type { EvolveLayout } from './generations.ts'
import { appendJournal } from './journal.ts'
import { readState } from './state.ts'

/** Deployment choices for the supervisor. */
export interface SupervisorConfig {
  /** Absolute directory of the checkout owning `evolve/`. */
  repositoryRoot: string
  /** Executable followed by arguments that launch the application. */
  command: readonly string[]
  /** TCP port the application must accept connections on. */
  healthPort: number
  /** Time allowed to reach health before the start counts as failed. */
  startupTimeoutMs: number
  /** Interval between health probes and sentinel checks. */
  pollIntervalMs: number
  /** Minimum time a child must stay up before a restart request is honored. */
  minUptimeMs: number
  /** Grace period between SIGTERM and SIGKILL. */
  terminateGraceMs: number
  /** Consecutive failed starts tolerated before the supervisor gives up. */
  maxConsecutiveFailures: number
}

/** Why the supervisor stopped waiting on a healthy child. */
type SupervisionOutcome = 'sentinel' | 'exit' | 'aborted'

/**
 * Resolve a generation's directory from the durable state.
 * @param layout - owned paths for this repository.
 * @returns the current generation identifier and directory, or null to boot the source checkout.
 */
async function resolveTarget(layout: EvolveLayout): Promise<{ id: string; path: string } | null> {
  const state = await readState(layout.stateFile)
  if (state.current === null) return null
  const record = state.generations.find(generation => generation.id === state.current)
  if (record === undefined) throw new Error(`state names unknown current generation: ${state.current}`)
  return { id: record.id, path: record.path }
}

/**
 * Test whether a TCP port accepts a connection.
 * @param port - port to connect to on the loopback interface.
 * @param timeoutMs - connection timeout.
 * @returns true when the connection was established.
 */
function portOpen(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    const settle = (open: boolean): void => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs, () => { settle(false) })
    socket.once('connect', () => { settle(true) })
    socket.once('error', () => { settle(false) })
  })
}

/**
 * Test whether the readiness handshake file was written after the child started.
 * @param path - readiness file path.
 * @param since - epoch milliseconds the child was spawned at.
 * @returns true when the file exists and is not stale.
 */
async function readyAfter(path: string, since: number): Promise<boolean> {
  try {
    const details = await stat(path)
    return details.mtimeMs >= since
  } catch {
    // No handshake file yet is the normal state during startup.
    return false
  }
}

/** Replaces the application process across generations, one process at a time. */
export class Supervisor {
  /** Owned paths for this repository. */
  readonly layout: EvolveLayout
  /** Resolved deployment choices. */
  readonly config: SupervisorConfig
  /** Child process currently supervised, when one is running. */
  private child: ChildProcess | undefined
  /** Launch command, narrowed to a non-empty argv by the constructor. */
  private readonly launch: readonly [string, ...string[]]

  /**
   * Prepare a supervisor for one repository.
   * @param config - deployment choices, including the launch command and health probe.
   */
  constructor(config: SupervisorConfig) {
    const [program, ...args] = config.command
    if (program === undefined) throw new Error('supervisor requires a launch command')
    if (config.healthPort <= 0) throw new Error('supervisor requires a positive healthPort')
    this.launch = [program, ...args]
    this.config = config
    this.layout = resolveLayout(config.repositoryRoot)
  }

  /**
   * Run until the caller aborts, replacing the child across generations.
   * @param signal - cancellation; the current child is terminated before this resolves.
   * @returns when the supervisor has stopped.
   */
  async run(signal: AbortSignal): Promise<void> {
    // Reading cancellation through a call keeps the loop's own narrowing from hiding a later abort.
    const aborted = (): boolean => signal.aborted
    let failures = 0
    try {
      while (!aborted()) {
        const target = await resolveTarget(this.layout)
        // Measure before the spawn: a fast child can publish its handshake before this returns.
        const startedAt = Date.now()
        await this.startChild(target)
        const healthy = await this.waitForHealthy(startedAt, signal)
        if (!healthy) {
          // Cancellation is not a failed start: the caller asked for this process to stop.
          if (aborted()) return
          const exitCode = this.child?.exitCode ?? null
          await this.stopChild()
          failures += 1
          const recovered = await this.recover(target, 'startup-health-timeout')
          if (recovered && failures <= this.config.maxConsecutiveFailures) continue
          throw new Error(
            `supervisor: ${target?.id ?? 'source checkout'} never became healthy`
            + ` (exit ${exitCode ?? 'none'}, port ${this.config.healthPort})`,
          )
        }

        failures = 0
        if (target !== null) await recordHealthyStart(this.layout, target.id)
        const outcome = await this.supervise(startedAt, aborted)
        if (outcome === 'aborted') return
        await this.stopChild()
        if (outcome === 'sentinel') {
          await rm(this.layout.sentinelFile, { force: true })
          continue
        }
        failures += 1
        const recovered = await this.recover(target, 'unexpected-exit')
        if (!recovered || failures > this.config.maxConsecutiveFailures) {
          throw new Error(`supervisor: ${target?.id ?? 'source checkout'} exited unexpectedly`)
        }
      }
    } finally {
      await this.stopChild()
    }
  }

  /**
   * Spawn the application for one generation.
   * @param target - generation to boot, or null for the source checkout.
   */
  private async startChild(target: { id: string; path: string } | null): Promise<void> {
    await rm(this.readyFile, { force: true })
    const [program, ...args] = this.launch
    const child = spawn(program, args, {
      cwd: target?.path ?? this.layout.repositoryRoot,
      stdio: 'inherit',
      env: { ...process.env, DSH_EVOLVE_GENERATION: target?.id ?? '' },
    })
    this.child = child
    await appendJournal(this.layout.journalFile, {
      at: new Date().toISOString(),
      phase: 'supervisor',
      generation: target?.id ?? '-',
      outcome: 'ok',
      detail: { event: 'spawn', cwd: target?.path ?? this.layout.repositoryRoot, pid: child.pid ?? -1 },
    })
  }

  /** Readiness handshake file consumed by the health probe. */
  private get readyFile(): string {
    return join(this.layout.root, 'ready')
  }

  /**
   * Wait until the child is both accepting connections and has written its readiness handshake.
   * @param startedAt - epoch milliseconds the child was spawned at.
   * @param signal - cancellation.
   * @returns whether the child became healthy before the deadline.
   */
  private async waitForHealthy(startedAt: number, signal: AbortSignal): Promise<boolean> {
    const deadline = startedAt + this.config.startupTimeoutMs
    while (Date.now() < deadline) {
      if (signal.aborted) return false
      if (this.child === undefined || this.child.exitCode !== null || this.child.signalCode !== null) return false
      if (await readyAfter(this.readyFile, startedAt) && await portOpen(this.config.healthPort, this.config.pollIntervalMs)) {
        return true
      }
      await delay(this.config.pollIntervalMs)
    }
    return false
  }

  /**
   * Wait for the child to exit or for a restart request to appear.
   * @param startedAt - epoch milliseconds the child was spawned at.
   * @param signal - cancellation.
   * @returns why waiting ended.
   */
  private async supervise(startedAt: number, aborted: () => boolean): Promise<SupervisionOutcome> {
    while (true) {
      if (aborted()) return 'aborted'
      if (this.child === undefined || this.child.exitCode !== null || this.child.signalCode !== null) return 'exit'
      try {
        await stat(this.layout.sentinelFile)
        await this.honorMinimumUptime(startedAt)
        return 'sentinel'
      } catch {
        // No restart request is the steady state.
      }
      await delay(this.config.pollIntervalMs)
    }
  }

  /**
   * Delay a restart until the child has stayed up for the configured minimum.
   * @param startedAt - epoch milliseconds the child was spawned at.
   */
  private async honorMinimumUptime(startedAt: number): Promise<void> {
    const remaining = startedAt + this.config.minUptimeMs - Date.now()
    if (remaining > 0) await delay(remaining)
  }

  /**
   * Restore the last generation known to boot after a failed start or crash.
   * @param target - generation that failed, or null for the source checkout.
   * @param reason - recorded cause of the recovery.
   * @returns whether a rollback target existed and was applied.
   */
  private async recover(target: { id: string } | null, reason: string): Promise<boolean> {
    const state = await readState(this.layout.stateFile)
    if (state.lastKnownGood === null || state.lastKnownGood === target?.id) return false
    await rollbackGeneration(this.layout, {
      reason,
      requestRestart: false,
      requestedBy: 'supervisor',
    })
    await appendJournal(this.layout.journalFile, {
      at: new Date().toISOString(),
      phase: 'supervisor',
      generation: state.lastKnownGood,
      outcome: 'ok',
      detail: { event: 'auto-rollback', reason },
    })
    return true
  }

  /** Terminate the current child, escalating after the grace period. */
  private async stopChild(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (child === undefined || child.exitCode !== null) return
    const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
    child.kill('SIGTERM')
    const killed = await Promise.race([exited.then(() => true), delay(this.config.terminateGraceMs).then(() => false)])
    if (!killed) child.kill('SIGKILL')
  }
}
