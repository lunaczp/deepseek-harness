/**
 * Unconfined Git orchestration for generation worktrees.
 *
 * The evolve plugin manages its own repository rather than running caller-supplied commands, so it
 * invokes Git directly instead of routing through the subprocess and sandbox seams. Every selector
 * variable that would redirect Git at another repository is cleared, and prompts and lazy fetching
 * are disabled so a proposal never blocks on credentials or network.
 * @module @deepseek-ai/dsh-evolve/git
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)

/** Selector variables that would redirect Git at a different repository, work tree, or object store. */
const GIT_SELECTORS: NodeJS.ProcessEnv = Object.fromEntries([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_CEILING_DIRECTORIES', 'GIT_PREFIX', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE', 'GIT_ATTR_SOURCE',
].map(key => [key, undefined]))

/** Captured stdout limit for one Git command. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

/** Exit status, signal, and captured stderr of a Git command that did not succeed. */
export class GitCommandError extends Error {
  /** Process exit status, or null when the command was terminated by a signal. */
  readonly exitCode: number | null
  /** Captured stderr, trimmed. */
  readonly stderr: string

  /**
   * Record one failed Git invocation.
   * @param args - the arguments that were passed after the executable.
   * @param exitCode - process exit status, or null when terminated by a signal.
   * @param stderr - captured stderr, already trimmed.
   */
  constructor(args: readonly string[], exitCode: number | null, stderr: string) {
    super(`git ${args.join(' ')} failed (${exitCode ?? 'signal'}): ${stderr}`)
    this.name = 'GitCommandError'
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

/**
 * Run one Git command without a shell and return its trimmed stdout.
 * @param cwd - directory the command runs in.
 * @param args - arguments after the executable, passed literally.
 * @returns trimmed standard output.
 * @throws {@link GitCommandError} when Git exits non-zero or is terminated by a signal.
 */
export async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd,
      env: {
        ...process.env,
        ...GIT_SELECTORS,
        GIT_TERMINAL_PROMPT: '0',
        GIT_LFS_SKIP_SMUDGE: '1',
        GIT_NO_LAZY_FETCH: '1',
      },
      maxBuffer: MAX_OUTPUT_BYTES,
    })
    return stdout.trim()
  } catch (error) {
    // execFile rejects with a populated status and stderr for an ordinary non-zero exit.
    const failure = error as { code?: unknown; status?: unknown; stderr?: unknown }
    const exitCode = typeof failure.status === 'number' ? failure.status : null
    const stderr = typeof failure.stderr === 'string' ? failure.stderr.trim() : String(error)
    throw new GitCommandError(args, exitCode, stderr)
  }
}

/**
 * Resolve the top-level directory of the checkout containing a path.
 * @param cwd - any directory inside the checkout.
 * @returns absolute top-level directory reported by Git.
 */
export async function repositoryTopLevel(cwd: string): Promise<string> {
  return runGit(cwd, ['rev-parse', '--show-toplevel'])
}

/**
 * Resolve a revision to a full commit object name.
 * @param cwd - directory the command runs in.
 * @param revision - revision expression, such as `HEAD` or a branch name.
 * @returns full commit object name.
 */
export async function resolveCommit(cwd: string, revision: string): Promise<string> {
  return runGit(cwd, ['rev-parse', '--verify', `${revision}^{commit}`])
}
