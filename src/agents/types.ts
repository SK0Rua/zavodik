/**
 * Shared contracts for the agent runtime layer.
 *
 * SPEC §2.3 / decision #10: every agent call is billed to a SUBSCRIPTION
 * (Claude Code OAuth, or Codex CLI / ChatGPT). No pay-per-token API path exists
 * anywhere in this layer — there is deliberately no way to pass an API key.
 */
import type { ZodType } from 'zod';

/**
 * What a single agent session actually consumed. Spec §9 wants "QA-ітерації"
 * and "cost per demo" as metrics, so callers can record this per invocation.
 * `costUsd` is the runtime's own estimate of subscription usage, NOT a bill —
 * nothing here is pay-per-token (§2.3).
 */
export interface AgentUsage {
  runtime: 'claude-code' | 'codex';
  model?: string;
  numTurns?: number;
  costUsd?: number;
  durationMs: number;
}

/** Which agent kind is running; used for per-kind runtime overrides + model tier. */
export type AgentKind =
  | 'enrichment'
  | 'qa'
  | 'content'
  | 'design'
  | 'outreach'
  | 'builder'
  | 'visual-critique';

export interface StructuredOptions {
  /** Use the heavy model tier (builder / design / QA critique). */
  heavy?: boolean;
  /** Retries on invalid JSON / schema mismatch. Default 2 (=> 3 attempts). */
  retries?: number;
  /** Agent kind, for runtime selection. Defaults to a generic structured call. */
  kind?: AgentKind;
  /** Hard wall-clock cap for a single attempt (ms). Default 10 min. */
  timeoutMs?: number;
  /**
   * Absolute paths of image files the model should look at (visual critique).
   * Delivered by instructing the agent to Read them, so no base64 API payloads.
   */
  imagePaths?: string[];
  /** Working directory for the headless call. Defaults to a scratch dir. */
  cwd?: string;
  /**
   * Turn budget for the headless call. Default 2 with no tools: the answer is
   * normally finished on turn 1, but a large structured output (e.g. 3 full art
   * directions) can need a second turn to finish writing, and `error_max_turns`
   * would otherwise kill a run that was going fine. With `allowedTools: []` the
   * extra turn cannot take any action — it can only complete the answer.
   * Raise it for very large schemas.
   */
  maxTurns?: number;
  /**
   * Called once per completed session with turn/cost telemetry. Optional and
   * never load-bearing: a throwing callback must not fail the agent call.
   */
  onUsage?: (usage: AgentUsage) => void;
  /**
   * Absolute path of the project's `build-log.ndjson`. When set, every SDK
   * message worth showing is summarised into it as it streams, so the console
   * can display a live trace of a run that takes an hour. Optional everywhere:
   * an agent that supplies no path produces no trace, and a log that cannot be
   * written never disturbs the run.
   */
  buildLogPath?: string;
  /**
   * @deprecated No effect. Kept so existing call sites compile: the subscription
   * runtimes manage their own output budget, there is no per-request max_tokens.
   */
  maxTokens?: number;
}

export interface CodeAgentOptions {
  name: string;
  cwd: string;
  prompt: string;
  appendSystemPrompt?: string;
  maxTurns?: number;
  heavy?: boolean;
  kind?: AgentKind;
  /** Hard wall-clock cap for the whole workspace session (ms). Default 60 min. */
  timeoutMs?: number;
  /**
   * Called once per completed session with turn/cost telemetry. Optional and
   * never load-bearing: a throwing callback must not fail the agent call.
   */
  onUsage?: (usage: AgentUsage) => void;
  /**
   * Replaces the default workspace tool set
   * (`Bash`,`Read`,`Write`,`Edit`,`Glob`,`Grep`) for calls that need a different
   * one. The social finder passes `['ToolSearch','WebSearch','Read','Write']`:
   * it must reach the network through Anthropic's own search (our server IP is
   * blocked by the engines) but must never run Bash.
   *
   * `ToolSearch` belongs in the list whenever a deferred tool like `WebSearch`
   * is used — the SDK does not hand the agent that schema until it looks it up.
   *
   * The workspace-boundary hook still runs over whatever is listed here.
   */
  allowedTools?: string[];
  /**
   * Skills the workspace session may use, by directory/SKILL.md name, or 'all'.
   * The site builder copies the official GSAP skills into
   * `<workspace>/.claude/skills/` and passes 'all' so the agent can consult them.
   * Omitted = the CLI's own defaults (which is NOT "skills off").
   * Claude Code only; the Codex adapter ignores it.
   */
  skills?: string[] | 'all';
  /**
   * Absolute path of the project's `build-log.ndjson`. When set, the runtime
   * appends a one-line summary of every SDK message as it streams — which is
   * what makes an hour-long build visible in the console instead of a single
   * «Виконується». The builder and the QA critic supply it; agents with no
   * project (brand, social finder) leave it unset and produce no trace.
   *
   * Claude Code only. The Codex adapter drives a CLI over stdout rather than a
   * typed message stream, so it ignores this — the worker's own stage markers
   * are still written and the timeline stays honest, just without agent chatter.
   */
  buildLogPath?: string;
}

/**
 * A runtime adapter is the ONLY thing that knows how to reach a model.
 * Both operations are subscription-authenticated and return validated data.
 */
export interface AgentRuntime {
  readonly id: 'claude-code' | 'codex';
  /** Headless single-shot, no tools, output validated against `schema`. */
  structured<T>(
    name: string,
    systemPrompt: string,
    userContent: string,
    schema: ZodType<T>,
    opts?: StructuredOptions,
  ): Promise<T>;
  /** Workspace agent with tools; result read from `result.json` and validated. */
  codeAgent<T>(opts: CodeAgentOptions, resultSchema: ZodType<T>): Promise<T>;
}

/**
 * Subscription window exhausted (5-hour or weekly cap), or an upstream 429.
 * SPEC §2.3(б): this is NOT a failure — the job goes to `retry_wait` and the
 * queue re-enqueues it once the window resets. It never counts as an attempt.
 */
export class RateLimitedError extends Error {
  readonly code = 'RATE_LIMITED';
  readonly retryAfterMs: number;
  readonly rateLimitType?: string;
  readonly resetsAt?: Date;

  constructor(message: string, opts: { retryAfterMs: number; rateLimitType?: string; resetsAt?: Date }) {
    super(message);
    this.name = 'RateLimitedError';
    this.retryAfterMs = opts.retryAfterMs;
    this.rateLimitType = opts.rateLimitType;
    this.resetsAt = opts.resetsAt;
  }
}

export function isRateLimitedError(err: unknown): err is RateLimitedError {
  return err instanceof RateLimitedError || (err as { code?: string } | null)?.code === 'RATE_LIMITED';
}

/** The agent produced output that never validated against the schema. */
export class AgentSchemaError extends Error {
  readonly code = 'NEEDS_HUMAN'; // SPEC §7: schema failure -> needs_human, no retry loop
  constructor(message: string) {
    super(message);
    this.name = 'AgentSchemaError';
  }
}
