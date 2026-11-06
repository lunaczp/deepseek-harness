/**
 * Transactional self-modification for this checkout.
 *
 * A generation is a Git worktree plus a durable record; the plugin exposes the transaction steps as
 * tools and never edits the source checkout. The five tools cover the whole transaction —
 * `propose`, `build`, `verify`, `activate`, `rollback` — while the process replacement those
 * transitions ask for belongs to `supervisor.ts`, which runs outside this process because an agent
 * cannot replace its own parent.
 * @module @deepseek-ai/dsh-evolve
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { activateGeneration, rollbackGeneration } from './activation.ts'
import { proposeGeneration, resolveLayout } from './generations.ts'
import { markReady } from './ready.ts'
import { buildGeneration, verifyGeneration } from './lifecycle.ts'
import type { EvolveLayout } from './generations.ts'
import type { StepOptions } from './lifecycle.ts'

export const name = 'evolve'
export const inject = ['tools']

/** Deployment choices for the evolve plugin. */
export interface Config {
  /**
   * Absolute directory of the checkout whose `evolve/` runtime state this plugin owns. Required
   * rather than inferred from the process working directory, because a serving process can be
   * launched from anywhere and a proposal must never land in the wrong repository.
   */
  repositoryRoot: string
  /** Executable followed by arguments that build one generation, run inside its directory. */
  buildCommand: string[]
  /** Executable followed by arguments that verify one generation, run inside its directory. */
  verifyCommand: string[]
  /** Deadline in milliseconds for one build or check command. */
  commandTimeoutMs: number
  /** Consecutive verify failures that halt automatic evolution. */
  maxConsecutiveVerifyFailures: number
  /** Whether a generation without `node_modules` reuses the source checkout's installed tree. */
  linkDependencies: boolean
  /** Maximum characters of captured command output returned to the model. */
  maxOutputChars: number
}

/** Schemastery configuration for the evolve plugin. */
export const Config: z<Config> = z.object({
  repositoryRoot: z.string().required(),
  buildCommand: z.array(z.string()).required(),
  verifyCommand: z.array(z.string()).required(),
  commandTimeoutMs: z.number().required(),
  maxConsecutiveVerifyFailures: z.number().required(),
  linkDependencies: z.boolean().required(),
  maxOutputChars: z.number().required(),
})

/** Output fields shared by the build and verify tools. */
const STEP_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
    timedOut: { type: 'boolean', required: true },
    status: { type: 'string', required: true },
    halted: { type: 'boolean', required: true },
    consecutiveVerifyFailures: { type: 'integer', required: true },
    output: { type: 'string', required: true },
  },
} as const

/** Output fields shared by the activation tools. */
const ACTIVATION_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    generation: { type: 'string', required: true },
    previous: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    requestedAt: { type: 'string', required: true },
  },
} as const

/**
 * Build the shared step inputs from the deployment configuration.
 * @param config - resolved deployment configuration.
 * @param id - generation to act on.
 * @param argv - command to run inside the generation.
 * @returns inputs accepted by the build and verify steps.
 */
function stepOptions(config: Config, id: string, argv: readonly [string, ...string[]]): StepOptions {
  return {
    id,
    argv,
    timeoutMs: config.commandTimeoutMs,
    maxOutputChars: config.maxOutputChars,
    linkDependencies: config.linkDependencies,
  }
}

/**
 * Restate a step result as the tool's canonical output value.
 * @param layout - owned paths for this repository.
 * @param result - settled step result.
 * @returns the bounded model-facing value.
 */
function stepValue(result: Awaited<ReturnType<typeof buildGeneration>>) {
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    status: result.status,
    halted: result.halted,
    consecutiveVerifyFailures: result.consecutiveVerifyFailures,
    output: result.output,
  }
}

/**
 * Register the evolve tools on `ctx.tools`.
 * @param ctx - context carrying the tool registry.
 * @param config - deployment configuration naming the owned checkout and its commands.
 * @returns when the tools are registered and the readiness handshake is published.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const layout: EvolveLayout = resolveLayout(config.repositoryRoot)

  ctx.tools.register(defineTool({
    name: 'evolve_propose',
    description:
      'Propose one change to this harness as a new isolated generation: a Git worktree of the '
      + 'current commit. The source checkout is never modified, so a proposal that is not built and '
      + 'verified leaves the running process untouched. Nothing is activated by this call.',
    parameters: {
      from: { type: 'string', description: 'Revision to base the generation on. Defaults to HEAD.' },
      note: { type: 'string', description: 'Short note recorded with the generation.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          generation: { type: 'string', required: true },
          branch: { type: 'string', required: true },
          path: { type: 'string', required: true },
          baseCommit: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Proposed ${value.generation} on ${value.branch} from ${value.baseCommit.slice(0, 12)}.`,
      }],
    },
    async execute(args, _exec) {
      const proposed = await proposeGeneration(layout, {
        ...args.from === undefined ? {} : { from: args.from },
        ...args.note === undefined ? {} : { note: args.note },
      })
      const { generation } = proposed
      return {
        generation: generation.id,
        branch: generation.branch,
        path: generation.path,
        baseCommit: generation.baseCommit,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Propose generation', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_build',
    description:
      'Build one proposed generation by running the configured build command inside its worktree. '
      + 'A failed build marks the generation failed and leaves the source checkout and the running '
      + 'process untouched.',
    parameters: {
      generation: { type: 'string', required: true, description: 'Generation identifier, such as gen-0001.' },
    },
    output: {
      schema: STEP_OUTPUT,
      render: (args, value) => [{
        type: 'text',
        text: `${args.generation} build ${value.ok ? 'succeeded' : 'failed'}: ${value.status}.`,
      }],
    },
    async execute(args, _exec) {
      return stepValue(await buildGeneration(layout, stepOptions(config, args.generation, commandArgv(config.buildCommand))))
    },
    presentCall: args => ({ card: 'generic', title: 'Build generation', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_verify',
    description:
      'Verify one built generation by running the configured check command inside its worktree. '
      + 'Consecutive failures count toward a halt threshold; when it is reached automatic evolution '
      + 'stops and requires a human to clear the halt.',
    parameters: {
      generation: { type: 'string', required: true, description: 'Generation identifier, such as gen-0001.' },
    },
    output: {
      schema: STEP_OUTPUT,
      render: (args, value) => [{
        type: 'text',
        text: `${args.generation} verify ${value.ok ? 'passed' : 'failed'}: ${value.status}`
          + `${value.halted ? '; evolution halted' : ''}.`,
      }],
    },
    async execute(args, _exec) {
      return stepValue(await verifyGeneration(
        layout,
        stepOptions(config, args.generation, commandArgv(config.verifyCommand)),
        config.maxConsecutiveVerifyFailures,
      ))
    },
    presentCall: args => ({ card: 'generic', title: 'Verify generation', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_activate',
    description:
      'Make one verified generation current and ask the supervisor to restart into it. The current '
      + 'process keeps running until the supervisor acts; a generation that has not been verified '
      + 'cannot be activated.',
    parameters: {
      generation: { type: 'string', required: true, description: 'Verified generation identifier.' },
      reason: { type: 'string', required: true, description: 'Why this generation should become current.' },
    },
    output: {
      schema: ACTIVATION_OUTPUT,
      render: (_args, value) => [{
        type: 'text',
        text: `Activated ${value.generation}; restart requested.`
          + (value.previous === null ? '' : ` Replaced ${value.previous}.`),
      }],
    },
    async execute(args, _exec) {
      const result = await activateGeneration(layout, { id: args.generation, reason: args.reason })
      return {
        generation: result.generation,
        previous: result.previous,
        requestedAt: result.request.requestedAt,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Activate generation', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'evolve_rollback',
    description:
      'Make the last generation known to boot current again and ask the supervisor to restart into '
      + 'it. Use this after a bad activation; the running process is not stopped by this call.',
    parameters: {
      reason: { type: 'string', required: true, description: 'What went wrong.' },
      to: { type: 'string', description: 'Explicit generation to restore instead of the last known good one.' },
    },
    output: {
      schema: ACTIVATION_OUTPUT,
      render: (_args, value) => [{
        type: 'text',
        text: `Rolled back to ${value.generation}; restart requested.`,
      }],
    },
    async execute(args, _exec) {
      const result = await rollbackGeneration(layout, {
        reason: args.reason,
        ...args.to === undefined ? {} : { to: args.to },
      })
      return {
        generation: result.generation,
        previous: result.previous,
        requestedAt: result.request.requestedAt,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Roll back generation', kind: 'other', rawInput: args }),
  }))

  // The supervisor treats a fresh handshake, not a live port alone, as proof that this plugin tree
  // loaded. Writing it last keeps "ready" from outrunning the tool registrations above.
  await markReady(layout)
}

/**
 * Narrow a configured command to the non-empty argv a step accepts.
 * @param command - configured executable followed by arguments.
 * @returns the same command, asserted non-empty.
 * @throws Error when the deployment configured an empty command.
 */
function commandArgv(command: readonly string[]): readonly [string, ...string[]] {
  const [head, ...rest] = command
  if (head === undefined) throw new Error('evolve command configuration must not be empty')
  return [head, ...rest]
}
