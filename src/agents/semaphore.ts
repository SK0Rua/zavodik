/**
 * In-process semaphore around agent calls.
 *
 * SPEC §2.3(а): subscription windows are a shared, finite resource, so the
 * number of concurrent agentic calls is capped (default 1). pg-boss is also
 * configured with teamSize/batchSize 1 for agent job types; this semaphore is
 * the second belt — it holds even if several agent calls happen inside one job.
 */
import { config } from '../config.js';
import { log } from '../lib/logger.js';

let active = 0;
const waiting: Array<() => void> = [];

/**
 * Set by the worker process at startup (`src/workers/main.ts`). A process hosting
 * only the `build` or `enrich` group uses that group's own cap; null = the global
 * `AGENT_CONCURRENCY`. The split exists because this semaphore is per-process:
 * once groups run in separate processes they no longer share a slot.
 */
let override: number | null = null;

/** Called once at worker startup; safe to call again (last value wins). */
export function setAgentConcurrency(value: number): void {
  override = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  log.info('agent concurrency set', { limit: limit(), override });
}

function limit(): number {
  return Math.max(1, override ?? config.agents.concurrency);
}

async function acquire(label: string): Promise<void> {
  if (active < limit()) {
    active++;
    return;
  }
  log.info('agent call queued (concurrency limit)', { label, active, limit: limit(), waiting: waiting.length });
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function release(): void {
  active--;
  const next = waiting.shift();
  if (next) next();
}

/** Run `fn` holding one agent-concurrency slot. */
export async function withAgentSlot<T>(label: string, fn: () => Promise<T>): Promise<T> {
  await acquire(label);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Introspection for the dashboard / tests. */
export function agentSlotStats(): { active: number; waiting: number; limit: number } {
  return { active, waiting: waiting.length, limit: limit() };
}
