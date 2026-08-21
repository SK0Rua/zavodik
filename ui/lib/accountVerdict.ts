/**
 * What an account card's status chip says — the one decision Roman's 2026-08-21
 * complaint was about ("Claude 'налаштовано', Codex 'частково', хоча обидва
 * підключені; тисну Перевірити — все ок").
 *
 * That page had two sources of truth and displayed the weaker one. This
 * function makes the precedence explicit and testable, in this order:
 *
 *   1. a check Roman just ran in this session (the freshest possible answer);
 *   2. the cached real check the page rendered with (up to 10 minutes old);
 *   3. whether credentials exist at all — used ONLY to tell «не підключено»
 *      (nothing saved, so «Підключити» is the action) from «помилка» (something
 *      is saved and the dependency refused it, so the reason is worth reading).
 *
 * A file of its own rather than a helper inside the component: it is pure, it
 * carries the rule that broke, and `scripts/test-check-cache.ts` runs it with
 * no browser, no database and no factory.
 *
 * It imports NOTHING — the two inputs are described structurally rather than
 * imported from `lib/checks.ts` and `lib/accounts.ts`, which would drag
 * `next/cache` and the drizzle client into a test that needs neither.
 */

/** Minimal shape needed from `lib/accounts.ts`. */
export interface ReadinessLike {
  readiness: 'configured' | 'missing' | 'partial';
}

/** Minimal shape of a check result, live or cached. */
export interface OutcomeLike {
  ok: boolean;
  message: string;
  pending?: boolean;
}

export interface Verdict {
  tone: 'go' | 'wait' | 'stop' | 'idle';
  label: string;
  /** The human reason, shown under the header when something is wrong. */
  reason: string | null;
  connected: boolean;
}

export function verdictOf(
  status: ReadinessLike | null,
  cached: OutcomeLike | undefined,
  live: OutcomeLike | undefined,
): Verdict {
  if (live?.pending) return { tone: 'wait', label: 'перевіряю…', reason: null, connected: false };

  const result = live ?? cached;
  if (result) {
    if (result.ok) return { tone: 'go', label: 'підключено', reason: null, connected: true };
    // A refusal only means "помилка" when there was something to refuse. With
    // nothing saved, "не підключено" is the honest word and «Підключити» is the
    // action — calling an empty slot an error would send Roman debugging.
    const hasData = status ? status.readiness !== 'missing' : true;
    return hasData
      ? { tone: 'stop', label: 'помилка', reason: result.message, connected: false }
      : { tone: 'idle', label: 'не підключено', reason: null, connected: false };
  }

  // No verdict at all: the factory was unreachable when the page rendered.
  return { tone: 'idle', label: 'не перевірено', reason: null, connected: false };
}

/**
 * One card, two protocols: Gmail is a single account whose SMTP and IMAP halves
 * are checked separately but share one app password.
 *
 * «підключено» requires BOTH to answer. Anything less is reported as the half
 * that is not working, named — «SMTP: …» or «IMAP: …» — because the two
 * failures have completely different remedies (a refused login versus IMAP
 * simply not being enabled in Gmail's settings), and an unnamed error would
 * send Roman to the wrong one. A half that has not been checked at all is not
 * allowed to pass as success either: this card's whole job is to say whether
 * outreach can send AND replies can be read.
 */
export function gmailVerdict(smtp: Verdict, imap: Verdict): Verdict {
  if (smtp.connected && imap.connected) return smtp;

  const named = (half: Verdict, name: string): Verdict => ({
    ...half,
    reason: half.reason ? `${name}: ${half.reason}` : `${name}: не перевірено`,
  });

  // A live failure is more actionable than an unverified half, so it wins.
  if (smtp.tone === 'stop') return named(smtp, 'SMTP');
  if (imap.tone === 'stop') return named(imap, 'IMAP');
  if (smtp.tone === 'wait' || imap.tone === 'wait') return smtp.tone === 'wait' ? smtp : imap;
  // Exactly one half verified: say which one is still unknown rather than
  // rounding a half-answer up to «підключено».
  if (smtp.connected) return { ...imap, reason: 'IMAP ще не перевірено' };
  if (imap.connected) return { ...smtp, reason: 'SMTP ще не перевірено' };
  return smtp;
}
