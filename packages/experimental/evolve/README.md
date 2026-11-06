--- description: "Transactional self-modification for this checkout: isolated generations, a durable journal, and the process supervisor that replaces one generation with the next." kind: "package-reference" ---

# @deepseek-ai/dsh-evolve

English | [中文](README.zh.md)

## Summary

Give an agent a way to change its own scaffold without the ability to brick it. A change is proposed as an isolated Git worktree, built and checked there, activated by moving a pointer, and undone either by the agent or by the supervisor when a new generation fails to boot. The source checkout is never edited, and the agent never stops its own process.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin where the tool registry is available and name the checkout it owns. Every deployment-varying choice is required configuration; there are no defaults.

```yaml
- name: '@deepseek-ai/dsh-evolve'
  config:
    repositoryRoot: /absolute/path/to/deepseek-harness
    buildCommand: ['pnpm', 'run', 'build:artifacts']
    verifyCommand: ['pnpm', 'run', 'typecheck']
    commandTimeoutMs: 900000
    maxConsecutiveVerifyFailures: 3
    linkDependencies: true
    maxOutputChars: 4000
```

The plugin registers five tools:

| Tool | Effect |
|---|---|
| `evolve_propose` | Creates `evolve/generations/gen-NNNN` as a worktree of a resolved commit and records it. The source checkout is untouched. |
| `evolve_build` | Runs `buildCommand` inside the generation. A non-zero exit marks the generation failed. |
| `evolve_verify` | Runs `verifyCommand` inside the generation and advances the failure budget. |
| `evolve_activate` | Makes a verified generation current and writes a restart request. |
| `evolve_rollback` | Makes the last generation known to boot current again and writes a restart request. |

The supervisor runs outside the plugin tree, because an agent cannot replace its own parent:

```ts
import { Supervisor } from '@deepseek-ai/dsh-evolve/src/supervisor.ts'

const supervisor = new Supervisor({
  repositoryRoot: '/absolute/path/to/deepseek-harness',
  command: ['pnpm', 'dsh', '--profile', 'web'],
  healthPort: 3080,
  startupTimeoutMs: 120_000,
  pollIntervalMs: 500,
  minUptimeMs: 30_000,
  terminateGraceMs: 10_000,
  maxConsecutiveFailures: 2,
})
await supervisor.run(signal)
```

One process serves one generation. `evolve/` holds everything the system owns:

```text
evolve/
  state.json            current, lastKnownGood, failure budget, generation records
  journal.jsonl         append-only audit trail, written by the agent and the supervisor
  ready                 readiness handshake, written by this plugin when it mounts
  restart-request.json  the agent's request to be replaced, consumed by the supervisor
  generations/          one Git worktree per generation
```

`state.json` and `restart-request.json` are replaced through a temporary file and a rename, so a reader never observes a half-written document.

<a id="understand-the-implementation"></a>
## Understand the implementation

A generation moves through `proposed`, `built`, `verified`, `active`, and `failed`. Each step refuses a record in the wrong status, so the tools cannot be run out of order by a caller that skips one. `activate` and `rollback` are pointer moves plus a restart request; neither stops the calling process.

Health is a conjunction, not a port check. The supervisor requires a live child, a connection on `healthPort`, and a `ready` file whose modification time is at or after the spawn timestamp. It removes `ready` before every spawn, so the handshake proves that the new process loaded this plugin rather than that some older process still occupies the port.

`lastKnownGood` is written only by `recordHealthyStart`, which only the supervisor calls. Activation therefore cannot claim health, and a rollback target is always a generation a process actually booted from. When a child fails to start or exits, the supervisor restores `lastKnownGood` itself and journals the decision; when no such generation exists it stops rather than looping.

The failure budget is consecutive. One successful verify resets it; reaching `maxConsecutiveVerifyFailures` sets `halted` and every later step refuses to run. A halt is cleared by editing `state.json`, which is deliberately outside the agent's tools.

<a id="further-exploration"></a>
## Further Exploration

- [The self-evolving design draft](../../../zhp/04-self-evolving-agent.md) describes the wider
  roadmap this package is the first step of.
- [@deepseek-ai/dsh-experimental-worktree](../worktree/README.md) owns ordinary worktree creation for
  Sessions; this package manages its own pool because a proposal must not move the caller's working
  directory.

<a id="model-experience"></a>
## Model Experience

### Tool surface

#### What the model sees

Five schemas, one per transaction step. Each exposes a generation identifier and, where a decision exists, a reason string. No schema exposes a path, an environment variable, or a branch name: the model chooses *which step* and *why*, never *where*.

#### Token effect

Small fixed schema cost on each request where the tools are visible.

#### KV Cache effect

Prefix-stable while the tool definitions and configuration are unchanged. Activating or disposing the plugin may invalidate reuse from this prompt section.

### Tool results

#### What the model sees

Identifiers, statuses, and at most `maxOutputChars` of command output, truncated from the end so the final error line survives. A failed build or check reports its exit status and that tail instead of the whole compiler log.

#### Token effect

Bounded per call by `maxOutputChars`. A successful propose or activate returns a few short strings.

#### KV Cache effect

Results append after the cached prefix and do not rewrite it.

## Known Limitations and Deferred Work

- **The supervisor is a source module, not a supported entrypoint.** Repository policy rejects
  package bins and ad-hoc application launchers, so `run` is imported from `src/supervisor.ts`.
- **The supervisor is not yet protected from the agent.** It lives in this package, which the agent
  can edit through a generation. Until it moves to a path the agent cannot write, the isolation the
  draft requires does not hold.
- **Dependencies are shared, not installed.** With `linkDependencies`, a generation reuses the source
  checkout's `node_modules`, so a change that adds or upgrades a dependency cannot be verified.
- **No scoring yet.** Acceptance is a command exit status; the objective benchmark score from the
  roadmap's second step is not wired in.
- **A halt needs a human edit.** Clearing `halted` requires writing `state.json` directly.
- **Nothing cleans up old generations.** Worktrees accumulate under `evolve/generations/`.
