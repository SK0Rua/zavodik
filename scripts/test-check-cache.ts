/**
 * Offline checks for the /settings status logic.
 *
 * Two pure functions decide what Roman reads at the top of every account card,
 * and both are exactly the kind of thing that is wrong in a way nobody notices
 * until the page is lying again:
 *
 *  1. `isFresh` — the TTL that keeps a real Claude ping off every page load.
 *     A wrong boundary here means either a stale «підключено» about a dead
 *     token, or a subscription call on every render.
 *  2. `verdictOf` — the precedence between "Roman just clicked Оновити", "the
 *     page loaded with a cached result", and "credentials exist at all". The
 *     bug this whole change fixes was precedence: a cheap guess was outranking
 *     a real answer.
 *
 * No database and no factory needed: both functions are pure.
 */
import { isFresh, CHECK_TTL_MS } from '../src/api/checkCache.js';
import { gmailVerdict, verdictOf } from '../ui/lib/accountVerdict.js';

let failures = 0;
function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`✅ ${label}${extra !== undefined ? ` — ${String(extra)}` : ''}`);
  else { console.error(`❌ ${label}${extra !== undefined ? ` — ${String(extra)}` : ''}`); failures++; }
}

// ── isFresh ──────────────────────────────────────────────────────────────────

const now = Date.parse('2026-08-21T12:00:00.000Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

check('just-written row is fresh', isFresh(ago(0), now));
check('9 minutes old is fresh', isFresh(ago(9 * 60_000), now));
check('11 minutes old is stale', !isFresh(ago(11 * 60_000), now));
check('exactly at the TTL is stale', !isFresh(ago(CHECK_TTL_MS), now));
check('missing timestamp is stale', !isFresh(null, now));
check('garbage timestamp is stale', !isFresh('not-a-date', now));
// A row stamped in the future means the clocks disagree; trusting it would pin
// a wrong answer on screen for as long as the skew lasts.
check('future timestamp is stale', !isFresh(new Date(now + 60_000).toISOString(), now));

// ── verdictOf ────────────────────────────────────────────────────────────────

const saved = { id: 'claude' as const, readiness: 'configured' as const, detail: 'токен ••••1234' };
const empty = { id: 'claude' as const, readiness: 'missing' as const, detail: 'токен не заданий' };
const cached = (ok: boolean, message = 'msg') => ({ ok, message });

check(
  'cached ok → підключено',
  verdictOf(saved, cached(true), undefined).label === 'підключено',
);
check(
  'cached ok sets connected',
  verdictOf(saved, cached(true), undefined).connected,
);
check(
  'cached failure WITH saved credentials → помилка + reason',
  verdictOf(saved, cached(false, 'Claude Code не відповів: 401'), undefined).label === 'помилка'
    && verdictOf(saved, cached(false, 'Claude Code не відповів: 401'), undefined).reason === 'Claude Code не відповів: 401',
);
check(
  'cached failure with NOTHING saved → не підключено, no scary reason',
  verdictOf(empty, cached(false), undefined).label === 'не підключено'
    && verdictOf(empty, cached(false), undefined).reason === null,
);
check(
  'no result at all → не перевірено',
  verdictOf(saved, undefined, undefined).label === 'не перевірено',
);
check(
  'pending outranks everything',
  verdictOf(saved, cached(true), { ok: false, message: '', pending: true }).label === 'перевіряю…',
);
// The precedence that was the actual bug: a fresh click must beat the cache.
check(
  'live result beats a cached one',
  verdictOf(saved, cached(false, 'старе'), { ok: true, message: 'ok' }).label === 'підключено',
);
check(
  'live failure beats a cached success',
  verdictOf(saved, cached(true), { ok: false, message: 'щойно впало' }).reason === 'щойно впало',
);

// ── gmailVerdict ─────────────────────────────────────────────────────────────
// The Gmail card answers one question with two checks, and rounding a
// half-answer up to «підключено» would tell Roman replies are being read when
// IMAP was never asked.

const ok = () => verdictOf(saved, { ok: true, message: 'ok' }, undefined);
const bad = (m: string) => verdictOf(saved, { ok: false, message: m }, undefined);
const unknown = () => verdictOf(saved, undefined, undefined);

check('both halves ok → підключено', gmailVerdict(ok(), ok()).label === 'підключено');
check(
  'SMTP fails → reason names SMTP',
  gmailVerdict(bad('535 auth'), ok()).reason === 'SMTP: 535 auth',
);
check(
  'IMAP fails → reason names IMAP',
  gmailVerdict(ok(), bad('IMAP не увімкнено')).reason === 'IMAP: IMAP не увімкнено',
);
check(
  'SMTP ok but IMAP unchecked is NOT підключено',
  !gmailVerdict(ok(), unknown()).connected
    && gmailVerdict(ok(), unknown()).reason === 'IMAP ще не перевірено',
);
check(
  'IMAP ok but SMTP unchecked is NOT підключено',
  !gmailVerdict(unknown(), ok()).connected
    && gmailVerdict(unknown(), ok()).reason === 'SMTP ще не перевірено',
);
check(
  'a failure outranks an unchecked half',
  gmailVerdict(bad('535 auth'), unknown()).reason === 'SMTP: 535 auth',
);

console.log(failures === 0 ? '\nAll check-cache tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
