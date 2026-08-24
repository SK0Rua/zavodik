/**
 * Subscription-window detection shared by every adapter.
 *
 * SPEC §2.3(б): an exhausted subscription window is a PAUSE, not a failure —
 * the job goes to `retry_wait` and never burns an attempt. Structured signals
 * (Claude's `rate_limit_event`, typed assistant errors) are detected inside the
 * Claude adapter's own stream collector; everything unstructured — CLI stdout/
 * stderr, tmux scrollback, thrown transport errors — funnels through the
 * free-text signatures here.
 *
 * One list on purpose. The adapters used to carry two copies that had already
 * drifted (one knew "try again later", the other didn't). A false positive
 * costs one deferred retry; a miss turns a pause into a `failed` job, which is
 * the one outcome the spec forbids. When in doubt, a pattern belongs here.
 */
import { config } from '../config.js';
import { RateLimitedError, type AgentRuntimeId } from './types.js';

const RATE_LIMIT_PATTERNS = [
  /rate limit/i,
  /usage limit/i,
  /you'?ve hit your limit/i,
  /limit reached/i,
  /quota exceeded/i,
  /\b429\b/,
  /too many requests/i,
  /try again (later|in)/i,
];

/** Free-text signatures of a subscription cap. Exported for unit tests. */
export function looksRateLimited(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

/** No reset time known: wait the default window and let the queue re-check. */
export function rateLimitedFromText(runtime: AgentRuntimeId, text: string): RateLimitedError {
  return new RateLimitedError(`subscription limit reached: ${text.slice(0, 300)}`, {
    retryAfterMs: config.agents.rateLimitDefaultWaitMs,
    resetsAt: new Date(Date.now() + config.agents.rateLimitDefaultWaitMs),
    runtime,
  });
}

/**
 * Build a RateLimitedError from structured rate-limit info (Claude SDK's
 * `rate_limit_info.resetsAt`, a unix timestamp in seconds), capped by
 * AGENT_RATE_LIMIT_MAX_WAIT_MINUTES so a weekly cap cannot park a job for days.
 */
export function rateLimitedFromInfo(
  runtime: AgentRuntimeId,
  info: { resetsAt?: number; rateLimitType?: string } | undefined,
  message: string,
): RateLimitedError {
  const nowMs = Date.now();
  const resetMs = info?.resetsAt ? info.resetsAt * 1000 : undefined;
  const retryAfterMs = resetMs && resetMs > nowMs
    ? Math.min(resetMs - nowMs + 30_000, config.agents.rateLimitMaxWaitMs)
    : config.agents.rateLimitDefaultWaitMs;
  return new RateLimitedError(message, {
    retryAfterMs,
    rateLimitType: info?.rateLimitType,
    resetsAt: resetMs ? new Date(resetMs) : new Date(nowMs + retryAfterMs),
    runtime,
  });
}

/** Throw RateLimitedError if the thrown SDK/transport error is a 429-shaped one. */
export function rethrowIfRateLimitedText(runtime: AgentRuntimeId, err: unknown): void {
  const status = (err as { status?: number })?.status;
  const text = String((err as { message?: string })?.message ?? err);
  if (status === 429 || looksRateLimited(text)) throw rateLimitedFromText(runtime, text);
}
