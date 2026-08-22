/**
 * The settings page's status chips, fetched at render time.
 *
 * Roman's complaint (2026-08-21): the page opened claiming Claude was
 * «налаштовано» and Codex «частково» while both were in fact connected, and one
 * click on «Перевірити» proved it. A page that has to be asked before it tells
 * the truth is not a status page.
 *
 * So the truth is fetched on render instead of guessed. The factory caches the
 * results for ten minutes (`src/api/checkCache.ts`), which is what makes a real
 * Claude subscription ping affordable on a page load.
 *
 * Two facts stay strictly separate, because collapsing them is what produced
 * the confusing copy in the first place:
 *   whether credentials EXIST  → `lib/accounts.ts` (cheap, from the DB);
 *   whether they WORK          → this file (real, from the factory).
 * The card shows the second and falls back to the first only to distinguish
 * «не підключено» (nothing saved) from «помилка» (saved, but refused).
 */
import { unstable_noStore as noStore } from 'next/cache';

export type CheckKind = 'claude' | 'codex' | 'telegram' | 'telegram-send' | 'smtp' | 'imap' | 'waha';

export interface CachedCheck {
  kind: CheckKind;
  ok: boolean;
  message: string;
  detail?: Record<string, unknown>;
  needsQr?: boolean;
  /** ISO timestamp of the run this result came from. */
  at: string;
  cached: boolean;
}

export type ChecksByKind = Partial<Record<CheckKind, CachedCheck>>;

function factoryApiBase(): string {
  return (process.env.FACTORY_API_URL ?? 'http://factory:8787').replace(/\/+$/, '');
}

function internalKey(): string {
  return process.env.INTERNAL_API_KEY ?? process.env.UI_SESSION_SECRET ?? process.env.UI_PASSWORD ?? '';
}

export interface ChecksSnapshot {
  checks: ChecksByKind;
  /** Set when the factory could not be reached at all — the page says so once. */
  error: string | null;
}

/**
 * Ask the factory for every check.
 *
 * The timeout is deliberately short for a render path: on a warm cache this
 * answers in milliseconds, and a factory that is down must not hold the
 * settings page — the page still has to render, because /settings is where
 * Roman goes to FIX a factory that is down.
 */
export async function loadChecks(refresh?: string): Promise<ChecksSnapshot> {
  noStore();
  const key = internalKey();
  if (!key) {
    return {
      checks: {},
      error: 'INTERNAL_API_KEY / UI_SESSION_SECRET не заданий — фабрика не приймає внутрішні запити, '
        + 'тому статуси перевірити нічим.',
    };
  }
  // A forced refresh runs a real check, so it gets the manual button's budget;
  // a plain render must not block on a cold cache for longer than a page load.
  const timeoutMs = refresh ? 120_000 : 45_000;
  const qs = refresh ? `?refresh=${encodeURIComponent(refresh)}` : '';
  try {
    const res = await fetch(`${factoryApiBase()}/internal/checks-cached${qs}`, {
      headers: { 'x-internal-key': key },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null) as { ok?: boolean; checks?: CachedCheck[] } | null;
    if (!data?.ok || !Array.isArray(data.checks)) {
      return { checks: {}, error: `Фабрика відповіла ${res.status} — статуси недоступні.` };
    }
    const checks: ChecksByKind = {};
    for (const c of data.checks) checks[c.kind] = c;
    return { checks, error: null };
  } catch (err) {
    return {
      checks: {},
      error: `Фабрика недоступна (${factoryApiBase()}): ${String(err).slice(0, 140)}. Контейнер factory піднятий?`,
    };
  }
}
