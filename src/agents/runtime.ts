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
 */
export async function runCodeAgent<T>(
  opts: CodeAgentOptions,
  resultSchema: ZodType<T>,
): Promise<T> {
  return getRuntime(opts.kind ?? 'builder').codeAgent(opts, resultSchema);
}

export { z };
export type { AgentKind, AgentRuntime, CodeAgentOptions, StructuredOptions } from './types.js';
export { RateLimitedError, isRateLimitedError, AgentSchemaError } from './types.js';
export { agentSlotStats, withAgentSlot } from './semaphore.js';
