'use server';

/**
 * Server actions for the settings page.
 *
 * Kept out of `ui/lib/actions.ts` on purpose: that file is the pipeline's
 * mutation surface (approvals, sends, statuses) and this one only touches
 * configuration. Nothing here reads or writes business data.
 *
 * The checks are PROXIED to the factory's `/internal/check/:kind` rather than
 * run here, because the factory is the process that will do the real sending
 * and the only one with the agent CLIs — a green check must mean the real path
 * works, not that the UI container happens to reach something.
 */
import { revalidatePath } from 'next/cache';
import { masterKeyConfigured, saveSetting } from './settings';
import { settingDef } from '@factory/settings';

export interface SettingsSaveResult {
  ok: boolean;
  message: string;
  /** Per-key validation errors, so the form can point at the offending field. */
  errors?: Record<string, string>;
}

/**
 * Save ONE field.
 *
 * Per-key rather than per-group (Roman, 2026-08-22: «всюди насрано в купу,
 * особливо у розширених»). A group form made every save a decision about eleven
 * fields at once — it needed a sentinel to mean "don't touch this secret", and
 * one bad port number refused to save the four fields next to it. A key and a
 * value have neither problem: the field Roman edited is the field that is
 * written, and everything else on the page is untouched by construction.
 *
 * Validation still runs against the SHARED registry, so the UI can never store
 * a value the factory would reject at read time.
 */
export async function saveSettingValue(key: string, raw: string): Promise<SettingsSaveResult> {
  const def = settingDef(key);
  if (!def) return { ok: false, message: `Невідомий параметр: ${key}` };

  if (def.secret && raw !== '' && !masterKeyConfigured()) {
    return {
      ok: false,
      message: 'SETTINGS_MASTER_KEY не заданий — секрети зберігати нікуди. '
        + 'Згенеруй ключ (`openssl rand -hex 32`), додай у .env і перестартуй ui.',
    };
  }

  const value = def.kind === 'textarea' ? raw : raw.trim();
  const err = def.validate?.(value);
  if (err) return { ok: false, message: err, errors: { [key]: err } };

  try {
    await saveSetting(key, value);
  } catch (e) {
    return { ok: false, message: `Не збереглося: ${String(e).slice(0, 200)}` };
  }

  revalidatePath('/settings', 'layout');
  return {
    ok: true,
    // The TTL is the honest promise: the workers re-read within 15s, no restart.
    message: value === ''
      ? 'Скинуто. Діє значення з .env або типове.'
      : 'Збережено — фабрика підхопить протягом ~15 секунд.',
  };
}

/**
 * «Скинути»: delete the DB row so the value falls back to env → default.
 *
 * Deliberately the same write path as saving an empty string (`saveSetting`
 * deletes on ''), exposed under its own name because "clear this override" and
 * "store an empty value" are the same operation but not the same intent, and the
 * button that does it must not be spelled "save nothing".
 */
export async function resetSettingValue(key: string): Promise<SettingsSaveResult> {
  return saveSettingValue(key, '');
}

/**
 * Switching to live is the one setting that changes what happens to real
 * businesses, so it gets its own action with an explicit confirmation token
 * rather than riding along in a group save.
 */
export async function setFactoryMode(mode: 'dry_run' | 'live'): Promise<SettingsSaveResult> {
  if (mode !== 'dry_run' && mode !== 'live') return { ok: false, message: 'Невідомий режим' };
  await saveSetting('FACTORY_MODE', mode);
  revalidatePath('/settings', 'layout');
  revalidatePath('/inbox');
  return {
    ok: true,
    message: mode === 'live'
      ? 'Режим LIVE. Наступні approve-и надсилають реальні повідомлення бізнесам.'
      : 'Режим dry_run. Відправки симулюються.',
  };
}

// ─── Checks ──────────────────────────────────────────────────────────────────

export interface CheckOutcome {
  ok: boolean;
  message: string;
  detail?: Record<string, unknown>;
  needsQr?: boolean;
  ms?: number;
  /**
   * A check that is still running.
   *
   * The in-flight state used to be encoded as `{ok: false, message: 'перевіряю…'}`
   * and recognised by string-matching that message, which meant a check that
   * legitimately failed with those words would have rendered as a spinner
   * forever. It is a state, so it gets a field.
   */
  pending?: boolean;
}

/** Base URL of the factory's internal API, as seen from the UI container. */
function factoryApiBase(): string {
  return (process.env.FACTORY_API_URL ?? 'http://factory:8787').replace(/\/+$/, '');
}

function internalKey(): string {
  return process.env.INTERNAL_API_KEY ?? process.env.UI_SESSION_SECRET ?? process.env.UI_PASSWORD ?? '';
}

/**
 * Ask the factory to run a check. Timeout is generous because a Claude ping is
 * a real subscription call and an SMTP handshake can be slow — but bounded, so
 * a hung dependency shows as a timeout rather than a spinning button.
 */
export async function runCheck(kind: string): Promise<CheckOutcome> {
  const key = internalKey();
  if (!key) {
    return { ok: false, message: 'INTERNAL_API_KEY / UI_SESSION_SECRET не заданий — фабрика не приймає внутрішні запити.' };
  }
  try {
    const res = await fetch(`${factoryApiBase()}/internal/check/${encodeURIComponent(kind)}`, {
      method: 'POST',
      headers: { 'x-internal-key': key },
      cache: 'no-store',
      signal: AbortSignal.timeout(120_000),
    });
    const data = await res.json().catch(() => null) as CheckOutcome | null;
    if (!data) return { ok: false, message: `Фабрика відповіла ${res.status} без тіла.` };
    return data;
  } catch (err) {
    return {
      ok: false,
      message: `Не достукались до фабрики (${factoryApiBase()}): ${String(err).slice(0, 200)}. `
        + 'Контейнер factory піднятий?',
    };
  }
}

/**
 * Re-run ONE check and return its fresh result, updating the factory's cache
 * along the way — this is a card's «Оновити» button.
 *
 * It goes through `/internal/check/:kind` rather than
 * `/internal/checks-cached?refresh=`, because that endpoint already caches what
 * it runs and returns the single result the card needs, instead of six others
 * the card would throw away.
 */
export async function refreshCheck(kind: string): Promise<CheckOutcome> {
  const out = await runCheck(kind);
  revalidatePath('/settings', 'layout');
  return out;
}

/** Effective config as the RUNNING factory process sees it right now. */
export async function fetchEffectiveConfig(): Promise<{ ok: boolean; config?: Record<string, unknown>; message?: string }> {
  const key = internalKey();
  if (!key) return { ok: false, message: 'INTERNAL_API_KEY не заданий.' };
  try {
    const res = await fetch(`${factoryApiBase()}/internal/effective-config`, {
      headers: { 'x-internal-key': key },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => null) as { ok?: boolean; config?: Record<string, unknown> } | null;
    if (!data?.ok) return { ok: false, message: `Фабрика відповіла ${res.status}.` };
    return { ok: true, config: data.config };
  } catch (err) {
    return { ok: false, message: `Фабрика недоступна: ${String(err).slice(0, 160)}` };
  }
}

/** Registry lookup exposed to the client component (server action = one round trip). */
export async function describeSetting(key: string): Promise<{ label: string; hint?: string } | null> {
  const def = settingDef(key);
  return def ? { label: def.label, hint: def.hint } : null;
}
