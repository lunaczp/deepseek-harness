import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type * as evolve from '../src/index.ts'
import type { StepOptions } from '../src/lifecycle.ts'

const execute = promisify(execFile)

/** A command that exits zero on every supported platform. */
export const PASSING_COMMAND = ['node', '--version'] as const

/** A command that exits with status 3 on every supported platform. */
export const FAILING_COMMAND = ['node', '-e', 'process.exit(3)'] as const

/**
 * Build step inputs for one generation.
 * @param id - generation to act on.
 * @param argv - command to run inside the generation directory.
 * @param overrides - step fields the test needs to differ from the defaults.
 * @returns inputs accepted by the build and verify steps.
 */
export function stepOptions(
  id: string,
  argv: readonly [string, ...string[]],
  overrides: Partial<StepOptions> = {},
): StepOptions {
  return {
    id,
    argv: [...argv] as [string, ...string[]],
    timeoutMs: 60_000,
    maxOutputChars: 400,
    linkDependencies: false,
    ...overrides,
  }
}

/**
 * Build a complete plugin configuration for a fixture repository.
 * @param root - fixture repository directory.
 * @param overrides - fields the test needs to differ from the defaults.
 * @returns a configuration the plugin accepts unchanged.
 */
export function pluginConfig(root: string, overrides: Partial<evolve.Config> = {}): evolve.Config {
  return {
    repositoryRoot: root,
    buildCommand: ['node', '--version'],
    verifyCommand: ['node', '--version'],
    commandTimeoutMs: 60_000,
    maxConsecutiveVerifyFailures: 3,
    linkDependencies: false,
    maxOutputChars: 2000,
    ...overrides,
  }
}

/**
 * Run one Git command in a fixture repository with host configuration neutralized.
 * @param cwd - fixture directory.
 * @param args - arguments after the executable.
 * @returns trimmed standard output.
 */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execute('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '',
      GIT_CONFIG_PARAMETERS: '',
      GIT_CONFIG_COUNT: '0',
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_INDEX_FILE: undefined,
    },
  })
  return result.stdout.trim()
}

/**
 * Create a throwaway repository with one commit.
 * @returns the real path of the new repository, so worktree paths compare equal.
 */
export async function repository(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'dsh-evolve-')))
  await git(path, 'init', '-b', 'main')
  await git(path, 'config', 'core.autocrlf', 'false')
  await git(path, 'config', 'user.name', 'Evolve fixture')
  await git(path, 'config', 'user.email', 'evolve@example.invalid')
  await git(path, 'config', 'commit.gpgSign', 'false')
  // Mirror the real checkout: runtime state lives under `evolve/` and is ignored, so a proposal
  // must leave `git status` clean.
  await writeFile(join(path, '.gitignore'), '/evolve/\n')
  await writeFile(join(path, 'tracked.txt'), 'initial\n')
  await git(path, 'add', '.gitignore', 'tracked.txt')
  await git(path, 'commit', '-m', 'initial')
  return path
}

/**
 * Remove a fixture repository and everything under it.
 * @param path - repository to remove.
 */
export async function cleanup(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}
