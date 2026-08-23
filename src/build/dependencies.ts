import { existsSync } from 'node:fs';
import path from 'node:path';

export interface WorkspaceCommandResult {
  code: number;
  output: string;
}

export type WorkspaceCommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<WorkspaceCommandResult>;

/** The builder needs the workspace-local Next binary, not merely a directory. */
export function workspaceDependenciesReady(dir: string): boolean {
  return existsSync(path.join(dir, 'node_modules', '.bin', 'next'));
}

/**
 * Restore dependencies that fresh workspace preparation and terminal-state GC
 * deliberately omit. This is pipeline plumbing, not work delegated to the
 * design agent: both a fresh build and a human-requested QA iteration must enter
 * the agent with the same deterministic runtime available.
 */
export async function ensureWorkspaceDependencies(
  dir: string,
  run: WorkspaceCommandRunner,
): Promise<{ installed: boolean }> {
  if (workspaceDependenciesReady(dir)) return { installed: false };

  const result = await run('pnpm', ['install', '--frozen-lockfile'], dir);
  if (result.code !== 0) {
    throw new Error(
      `workspace dependency install failed (exit ${result.code}): ${result.output.slice(-1500)}`,
    );
  }
  if (!workspaceDependenciesReady(dir)) {
    throw new Error(
      'workspace dependency install reported success but node_modules/.bin/next is missing',
    );
  }
  return { installed: true };
}
