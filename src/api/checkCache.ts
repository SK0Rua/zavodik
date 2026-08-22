/**
 * Cached connectivity checks, so /settings can show REAL state on page load.
 *
 * The page used to open with a guess: a row said «налаштовано» because a token
 * row existed, and «підключено» only after Roman clicked a button. Both CLIs
 * were in fact connected, so the page was lying to him in two different ways at
 * once (Roman, 2026-08-21: "Claude 'налаштовано', Codex 'частково', хоча обидва
 * підключені").
 *
 * The reason it was a guess is cost, not honesty: `checkClaude` is a real
 * subscription call and takes tens of seconds. Cost is a caching problem, so it
 * is cached — a `check:<kind>` row per check, TTL 10 minutes. Page load reads
 * the rows and runs only what is missing or expired; a card's «Оновити» forces
 * exactly one kind.
 *
 * The rows live in the same `settings` table as `setting:` and `heartbeat:`,
 * under their own prefix, and are written with plain drizzle rather than
 * `writeSetting` — they are not registry keys and must never be resolvable as
 * configuration.
 *
 * Nothing here is a credential: a cached result is `{ok, message, detail}`, the
 * same words the button already showed. It is also NOT the send path — a stale
 * green here never authorises anything, it only colours a chip.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { log } from '../lib/logger.js';
import { type CheckKind, type CheckResult, runCheck } from './checks.js';

const PREFIX = 'check:';

/** Long enough that a page reload is free, short enough to catch a dead token. */
export const CHECK_TTL_MS = 10 * 60_000;

/**
 * Per-check ceiling for an auto-run.
 *
 * A manual click can afford to wait (the UI allows 120s), an automatic page
 * render cannot: seven checks on a cold cache must not hold the settings page
 * for two minutes. A check that overruns is reported as a timeout — which is
 * itself a true answer about a dependency — and cached like any other failure,
 * so the next render is fast rather than slow again.
 */
export const CHECK_TIMEOUT_MS = 10_000;

export const CHECK_KINDS: CheckKind[] = [
  'claude', 'codex', 'telegram', 'smtp', 'imap', 'waha',
];

export interface CachedCheck extends CheckResult {
  kind: CheckKind;
  /** When this result was produced, ISO. The UI turns it into «перевірено N хв тому». */
  at: string;
  /** True when the value came from the table rather than from a run just now. */
  cached: boolean;
}

/** Shape stored in the row. Kept minimal — this is a cache, not a log. */
interface StoredCheck {
  at: string;
  ok: boolean;
  message: string;
  detail?: Record<string, string | number | boolean | null>;
  needsQr?: boolean;
}

export function isFresh(at: string | null | undefined, now = Date.now(), ttlMs = CHECK_TTL_MS): boolean {
  if (!at) return false;
  const t = Date.parse(at);
  // A row from the future is a clock skew, not freshness: treat it as stale.
  return Number.isFinite(t) && t <= now && now - t < ttlMs;
}

function parseRow(value: string): StoredCheck | null {
  try {
    const p = JSON.parse(value) as Partial<StoredCheck>;
    if (typeof p?.at !== 'string' || typeof p?.ok !== 'boolean' || typeof p?.message !== 'string') return null;
    return { at: p.at, ok: p.ok, message: p.message, detail: p.detail, needsQr: p.needsQr };
  } catch {
    return null;
  }
}

async function readCache(): Promise<Map<CheckKind, StoredCheck>> {
  const rows = await db.select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings).where(sql`${schema.settings.key} like ${`${PREFIX}%`}`);
  const out = new Map<CheckKind, StoredCheck>();
  for (const r of rows) {
    const kind = r.key.slice(PREFIX.length) as CheckKind;
    if (!CHECK_KINDS.includes(kind)) continue;
    const parsed = parseRow(r.value);
    if (parsed) out.set(kind, parsed);
  }
  return out;
}

async function writeCache(kind: CheckKind, stored: StoredCheck): Promise<void> {
  const key = `${PREFIX}${kind}`;
  const value = JSON.stringify(stored);
  await db.insert(schema.settings)
    .values({ key, value, encrypted: false, updatedAt: new Date(), updatedBy: 'check-cache' })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date(), updatedBy: 'check-cache' } })
    .catch((err) => {
      // A cache that cannot write still returns the right answer this time.
      log.warn('check cache write failed', { kind, err: String(err).slice(0, 160) });
    });
}

/** `runCheck` with a wall clock on it. Never throws — a timeout is a result. */
async function runBounded(kind: CheckKind, timeoutMs: number): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(() => resolve({
      ok: false,
      message: `Перевірка не вклалася у ${Math.round(timeoutMs / 1000)}с — сервіс не відповідає або дуже повільний.`,
      detail: { timeoutMs },
    }), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([runCheck(kind), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Every check, from cache where fresh and from the real dependency where not.
 *
 * Runs in parallel: seven sequential checks on a cold cache would be the sum of
 * seven timeouts, and they share nothing but the config snapshot.
 *
 * `refresh` forces one kind to re-run even if its row is fresh — that is the
 * per-card «Оновити» button. Passing `refreshAll` re-runs everything, which
 * nothing in the UI does today; it exists so a future "перевірити все" button
 * does not need a second endpoint.
 */
export async function collectChecks(options?: {
  refresh?: CheckKind | null;
  refreshAll?: boolean;
  ttlMs?: number;
  timeoutMs?: number;
}): Promise<CachedCheck[]> {
  const ttlMs = options?.ttlMs ?? CHECK_TTL_MS;
  const timeoutMs = options?.timeoutMs ?? CHECK_TIMEOUT_MS;
  const now = Date.now();

  // A cache read that fails must not take the page down with it: an empty map
  // means "nothing is fresh", which degrades to running the checks.
  const cache = await readCache().catch((err) => {
    log.warn('check cache read failed', { err: String(err).slice(0, 160) });
    return new Map<CheckKind, StoredCheck>();
  });

  return Promise.all(CHECK_KINDS.map(async (kind): Promise<CachedCheck> => {
    const hit = cache.get(kind);
    const forced = options?.refreshAll === true || options?.refresh === kind;
    if (!forced && hit && isFresh(hit.at, now, ttlMs)) {
      return { kind, cached: true, at: hit.at, ok: hit.ok, message: hit.message, detail: hit.detail, needsQr: hit.needsQr };
    }

    const started = Date.now();
    const result = await runBounded(kind, timeoutMs);
    const at = new Date().toISOString();
    await writeCache(kind, {
      at, ok: result.ok, message: result.message, detail: result.detail, needsQr: result.needsQr,
    });
    log.info('check cached', { kind, ok: result.ok, ms: Date.now() - started, forced });
    return { kind, cached: false, at, ...result };
  }));
}

/**
 * Store a result that was produced elsewhere — the manual «Перевірити» button.
 *
 * Without this, the page has two sources of truth for the same fact: the chip
 * in the card header (cache) and the line under the button (this click), which
 * is the exact contradiction this whole change exists to remove.
 */
export async function cacheCheckResult(kind: CheckKind, result: CheckResult): Promise<void> {
  await writeCache(kind, {
    at: new Date().toISOString(),
    ok: result.ok,
    message: result.message,
    detail: result.detail,
    needsQr: result.needsQr,
  });
}

/** Drop a cached result so the next read re-runs it (used after a disconnect). */
export async function invalidateCheck(kind: CheckKind): Promise<void> {
  await db.delete(schema.settings).where(sql`${schema.settings.key} = ${`${PREFIX}${kind}`}`)
    .catch(() => { /* a stale row is a cosmetic problem, not a failure */ });
}
