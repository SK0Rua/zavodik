/**
 * Runtime selection + the public agent API used by every worker.
 *
 * SPEC §2.3 / decision #10: only subscription-authenticated runtimes exist —
 * `claude-code` (Claude Pro/Max via OAuth) and `codex` (ChatGPT subscription).
 * There is no API-key runtime, by construction.
 *
 * Selection: `AGENT_RUNTIME` globally, optionally overridden per agent kind
 * (`AGENT_RUNTIME_BUILDER`, `AGENT_RUNTIME_ENRICHMENT`, ...) — see
 * `config.agents.runtimeFor(kind)`.
 */
import { z, type ZodType } from 'zod';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { claudeCodeRuntime } from './claudeCodeRuntime.js';
import { codexRuntime } from './codexRuntime.js';
import type { AgentKind, AgentRuntime, CodeAgentOptions, StructuredOptions } from './types.js';

export function getRuntime(kind?: AgentKind): AgentRuntime {
  return config.agents.runtimeFor(kind) === 'codex' ? codexRuntime : claudeCodeRuntime;
}

/**
 * Headless structured call: no tools, output validated against `outputSchema`.
 * Invalid JSON / schema mismatch is retried (`opts.retries`, default 2), then
 * raised as a NEEDS_HUMAN-coded error — never a silent fallback value.
 */
export async function runAgent<T>(
  name: string,
  systemPrompt: string,
  userContent: string,
  outputSchema: ZodType<T>,
  opts: StructuredOptions = {},
): Promise<T> {
  return getRuntime(opts.kind).structured(name, systemPrompt, userContent, outputSchema, opts);
}

/**
 * Workspace agent with tools (Bash/Read/Write/Edit/Glob/Grep). The agent's only
 * channel back into the pipeline is `result.json`, validated against `resultSchema`.
 *
 * Two ways to run one, chosen by `config.build.mode` (SPEC §2.3, Roman's
 * requirement 2026-08-22 — "можливість підключення до термінальної сесії"):
 *
 *   `tmux` (default) — the interactive CLI in a detached tmux session, which
 *     `ttyd` serves so the console can attach to the REAL terminal, scrollback
 *     and all. See `tmuxRuntime.ts`.
 *   `sdk` — the headless SDK session. Unchanged, and still the fallback.
 *
 * The choice applies to Claude Code only: the Codex adapter drives its own CLI
 * and has no tmux path. It is also **per call**, not global — a caller may pin
 * `terminal: false` for an agent nobody would ever watch (the social finder),
 * and the fallback below keeps a host without tmux building normally rather
 * than failing every job.
 */
export async function runCodeAgent<T>(
  opts: CodeAgentOptions,
  resultSchema: ZodType<T>,
): Promise<T> {
  const runtime = getRuntime(opts.kind ?? 'builder');

  const wantsTerminal = (opts.terminal ?? config.build.mode === 'tmux')
    && runtime.id === 'claude-code';
  if (wantsTerminal) {
    const { runCodeAgentTmux, tmuxAvailable } = await import('./tmuxRuntime.js');
    if (await tmuxAvailable()) {
      return runCodeAgentTmux(opts, resultSchema);
    }
    // Not an error: a dev box without tmux should still build. Warned rather
    // than silent, because "why can't I attach to the terminal" has exactly one
    // answer and this is it.
    log.warn('tmux is not installed; falling back to the headless SDK runtime', {
      agent: opts.name,
    });
  }

  return runtime.codeAgent(opts, resultSchema);
}

export { z };
export type { AgentKind, AgentRuntime, CodeAgentOptions, StructuredOptions } from './types.js';
export { RateLimitedError, isRateLimitedError, AgentSchemaError } from './types.js';
export { agentSlotStats, withAgentSlot } from './semaphore.js';
