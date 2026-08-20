/**
 * Opt-out and bounce detection (SPEC §4 stage 15, §8).
 *
 * Pure functions over text — no DB, no side effects — so they are trivially
 * testable and so the same rules apply to email bodies and WhatsApp messages
 * alike. An opt-out is permanent (`do_not_contact` forever, §8), so the
 * matching is deliberately conservative: short, unambiguous phrases, and
 * word-boundary anchored where the language allows it. A false positive costs
 * one lead; a false negative costs a spam complaint, so we lean towards
 * catching it.
 */

/**
 * Opt-out keywords in the four languages that can plausibly reach us:
 * Greek (the market), English (the lingua franca), Ukrainian and Russian
 * (Roman's own languages, and what a test message will be written in).
 */
const OPT_OUT_PATTERNS: RegExp[] = [
  // ── English / universal
  /\bunsubscribe\b/i,
  /\bstop\b/i,
  /\bremove me\b/i,
  /\bopt[\s-]?out\b/i,
  /\bdo not (contact|email|write|message)\b/i,
  /\bdon'?t (contact|email|write|message) me\b/i,
  /\bnot interested\b/i,
  /\bno thanks?\b/i,
  // ── Greek. Patterns are written WITHOUT accents on purpose: the text is
  // accent-folded before matching (see `fold`), because Greek written in caps
  // loses its accents entirely — "ΔΙΑΓΡΑΦΗ" lowercases to "διαγραφη", which
  // would never match an accented pattern.
  /διαγραφη/i,
  /διαγραψτε/i,
  /σταματηστε/i,
  /μη μου (στελνετε|γραφετε)/i,
  /δεν (με )?ενδιαφερει|δεν ενδιαφερομαι/i,
  // ── Ukrainian
  // NOTE: no `\b` after a Cyrillic group — JS word boundaries are ASCII-only,
  // so `\b` after "пишіть" never matches. Use an explicit non-letter lookahead.
  /відпиш(іть|ить)/i,
  /не пиш(іть|ить|и)(?![а-яїієґё])/i,
  /не турбуйте/i,
  /не цікавить|не цікаво/i,
  /відписатися/i,
  // ── Russian
  /отпишите|отписаться/i,
  /не пишите/i,
  /не беспокойте/i,
  /не интересует/i,
];

/**
 * Accent-fold text before matching.
 *
 * Load-bearing for Greek: uppercase Greek is written without accents, so
 * "ΔΙΑΓΡΑΦΗ" (a perfectly normal way to shout "delete me") lowercases to
 * "διαγραφη" and would never match the accented "διαγραφή". Folding both the
 * haystack and the patterns to unaccented form makes the match accent-blind.
 * Harmless for Latin and Cyrillic (Ukrainian ї/і/є are distinct base letters,
 * not accented forms, and survive NFD untouched).
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks
    .replace(/ς/g, 'σ');   // final sigma -> sigma
}

/**
 * Does this message body ask us to stop?
 * Returns the matched phrase (for the audit trail) or null.
 */
export function detectOptOut(text: string | null | undefined): string | null {
  if (!text) return null;
  // Only the first part matters: a quoted copy of OUR message underneath would
  // otherwise trigger on our own List-Unsubscribe line.
  const head = fold(stripQuotedReply(text)).slice(0, 2000);
  for (const re of OPT_OUT_PATTERNS) {
    const m = head.match(re);
    if (m) return m[0];
  }
  return null;
}

/**
 * Cut the quoted original off a reply. Without this, every reply to a message
 * containing "unsubscribe" would read as an opt-out.
 */
export function stripQuotedReply(text: string): string {
  const markers = [
    /^\s*>.*$/gm,                       // classic quote prefix
    /^-{2,}\s*(Original Message|Forwarded message)/im,
    /^On .+ wrote:$/im,
    /^Στις .+ έγραψε:$/im,
    /^\d{1,2}\s+\w+\.?\s+\d{4}.*(написав|написал|wrote):/im,
  ];
  let out = text;
  for (const m of markers) {
    if (m.flags.includes('g')) { out = out.replace(m, ''); continue; }
    const hit = out.search(m);
    if (hit > 0) out = out.slice(0, hit);
  }
  return out.trim();
}

// ─── Bounces ─────────────────────────────────────────────────────────────────

const BOUNCE_FROM = [
  /mailer-daemon@/i,
  /postmaster@/i,
  /no-?reply@.*(bounce|mail)/i,
];

const BOUNCE_SUBJECT = [
  /undelivered mail returned to sender/i,
  /delivery status notification \(failure\)/i,
  /(mail|message) delivery failed/i,
  /returned mail/i,
  /delivery incomplete/i,
  /failure notice/i,
  /undeliverable/i,
];

const BOUNCE_CONTENT_TYPES = [
  'multipart/report',
  'message/delivery-status',
];

export interface BounceCheckInput {
  from?: string | null;
  subject?: string | null;
  /** Raw Content-Type of the message, if available. */
  contentType?: string | null;
  text?: string | null;
}

/**
 * Is this inbound mail a bounce/DSN rather than a human reply?
 * Returns the reason it was classified as one, or null.
 */
export function detectBounce(input: BounceCheckInput): string | null {
  const from = (input.from ?? '').toLowerCase();
  for (const re of BOUNCE_FROM) if (re.test(from)) return `from:${from}`;

  const subject = input.subject ?? '';
  for (const re of BOUNCE_SUBJECT) {
    const m = subject.match(re);
    if (m) return `subject:${m[0]}`;
  }

  const ct = (input.contentType ?? '').toLowerCase();
  for (const t of BOUNCE_CONTENT_TYPES) if (ct.includes(t)) return `content-type:${t}`;

  // Hard-bounce SMTP status codes inside a DSN body.
  const body = input.text ?? '';
  const status = body.match(/\bStatus:\s*(5\.\d\.\d)\b/i);
  if (status) return `dsn-status:${status[1]}`;

  return null;
}

/**
 * A bounce that names the failing recipient tells us WHICH address died.
 * Falls back to null when the DSN is unparseable.
 */
export function bouncedRecipient(text: string | null | undefined): string | null {
  if (!text) return null;
  const explicit = text.match(/Final-Recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/i)
    ?? text.match(/Original-Recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/i)
    ?? text.match(/<([^\s<>]+@[^\s<>]+)>:?\s*(?:host|Recipient address rejected)/i);
  return explicit ? explicit[1].toLowerCase() : null;
}
