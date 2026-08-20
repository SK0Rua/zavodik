/**
 * `website_audits.notes` → what Roman actually reads.
 *
 * Unlike the enrichment gaps and the critic's findings, this field contains NO
 * agent prose at all. Every string in it is assembled by `src/workers/audit.ts`
 * from a fixed set of code-side templates:
 *
 *   dated: no viewport meta, mobile horizontal overflow | slow render (6.4s to
 *   settle) | console_errors=4 (hard=1) | generator=WordPress 6.9.4
 *
 * That is our own format, not evidence, so it is translated HERE, by code,
 * rather than by an agent at write time. Three consequences, all wanted:
 *
 *   - no `notes_uk` column and no backfill: every row ever written, including
 *     the 17 that predate this file, renders in Ukrainian immediately;
 *   - no subscription call is spent guessing at wording we already know;
 *   - `notes` stays English in the database, which is what the build snapshot
 *     (`src/build/snapshot.ts`) hands to the builder agent — an English-reading
 *     persona whose input must not be degraded to serve the console's language.
 *
 * Numbers, URLs and generator strings are carried through verbatim: they are
 * the measured facts inside the note, and the translation is only of the words
 * around them. A segment this file does not recognise is returned unchanged
 * rather than dropped — an unrecognised measurement must still reach the
 * reader, and it looking untranslated is the honest signal that it is.
 */

export interface AuditNoteSegment {
  /** The Ukrainian rendering, or the original when no rule matched. */
  text: string;
  /** True when this segment is a real problem rather than an observation. */
  severe: boolean;
  /** The original English segment, for the fold. */
  original: string;
}

/** The `dated:` signal vocabulary, exactly as `audit.ts` composes it. */
const DATED_SIGNALS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^no viewport meta$/i, () => 'немає мета-тега viewport (сайт не готовий до телефона)'],
  [/^no media queries$/i, () => 'немає адаптивних стилів'],
  [/^mobile horizontal overflow$/i, () => 'на телефоні контент вилазить за екран'],
  [/^flash object$/i, () => 'на сторінці Flash'],
  [/^dated generator \((.+)\)$/i, (m) => `застарілий движок (${m[1]})`],
  [/^(\d+) layout tables$/i, (m) => `верстка таблицями (${m[1]})`],
  [/^thin content \((\d+) chars\)$/i, (m) => `мало тексту (${m[1]} символів)`],
];

function datedSignal(raw: string): string {
  const trimmed = raw.trim();
  for (const [re, render] of DATED_SIGNALS) {
    const m = trimmed.match(re);
    if (m) return render(m);
  }
  return trimmed;
}

/**
 * One whole segment (between the `|` separators).
 *
 * Ordered most specific first: `dated: …` must be matched before anything that
 * could see its comma-separated tail.
 */
const SEGMENT_RULES: Array<[RegExp, (m: RegExpMatchArray) => { text: string; severe: boolean }]> = [
  [/^dated:\s*(.+)$/i, (m) => ({
    text: `ознаки застарілого сайту: ${m[1]!.split(',').map(datedSignal).join(', ')}`,
    severe: false,
  })],
  [/^slow render \(([\d.]+)s to settle\)$/i, (m) => ({
    text: `сторінка довго завантажується — ${m[1]} с до появи контенту`,
    severe: true,
  })],
  [/^console_errors=(\d+)(?:\s*\(hard=(\d+)\))?$/i, (m) => ({
    text: m[2]
      ? `помилок у консолі: ${m[1]} (з них ${m[2]} ламають сторінку)`
      : `помилок у консолі: ${m[1]}`,
    severe: !!m[2],
  })],
  [/^generator=(.+)$/i, (m) => ({ text: `зроблено на: ${m[1]}`, severe: false })],
  [/^social profile only:\s*(\S+)$/i, (m) => ({
    text: `власного сайту немає — тільки профіль у соцмережі: ${m[1]}`,
    severe: false,
  })],
  [/^directory\/booking profile only:\s*(\S+)$/i, (m) => ({
    text: `власного сайту немає — тільки сторінка в каталозі записів: ${m[1]}`,
    severe: false,
  })],
  [/^no endpoint rendered$/i, () => ({ text: 'жодна адреса сайту не відкрилась', severe: true })],
  [/^no working https endpoint$/i, () => ({ text: 'немає робочого https — сайт без захищеного зʼєднання', severe: true })],
  [/^page rendered empty after settle \((\d+) chars, 0 images, (\d+) js errors\)$/i, (m) => ({
    text: `сторінка відкрилась порожньою: ${m[1]} символів тексту, жодного зображення, ${m[2]} помилок JS`,
    severe: true,
  })],
  [/^all endpoints failed ->\s*(.+)$/i, (m) => ({
    text: `жодна адреса не відповіла — ${m[1]}`,
    severe: true,
  })],
  [/^render failed:\s*(.+)$/i, (m) => ({
    text: `не вдалося відкрити сторінку: ${m[1]}`,
    severe: true,
  })],
  [/^CONTRADICTION:\s*(.+)$/i, (m) => ({
    text: `суперечність у даних: ${contradiction(m[1]!)}`,
    severe: true,
  })],
];

/** The three contradictions `audit.ts` can raise, joined by `; ` when several. */
const CONTRADICTIONS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^enrichment captured an owned website but audit verdict=(\S+)$/i,
    (m) => `збір даних зняв власний сайт, а аудит каже «${m[1]}»`],
  [/^audit rendered (\S+) without an owned domain on the business$/i,
    (m) => `аудит відкрив сайт зі станом «${m[1]}», хоча власного домену в бізнесу не записано`],
  [/^owned website renders well but enrichment extracted zero services from it$/i,
    () => 'власний сайт відкривається добре, але з нього не витягнуто жодної послуги'],
];

function contradiction(raw: string): string {
  return raw.split(';').map((one) => {
    const trimmed = one.trim();
    for (const [re, render] of CONTRADICTIONS) {
      const m = trimmed.match(re);
      if (m) return render(m);
    }
    return trimmed;
  }).join('; ');
}

/**
 * Splits the notes field into rendered segments.
 *
 * Returns an empty array for an empty field, so a caller can test `.length`
 * rather than juggling null.
 */
export function parseAuditNotes(raw: string | null | undefined): AuditNoteSegment[] {
  if (!raw || !raw.trim()) return [];
  return raw.split('|').map((p) => p.trim()).filter(Boolean).map((original) => {
    for (const [re, render] of SEGMENT_RULES) {
      const m = original.match(re);
      if (m) {
        const { text, severe } = render(m);
        return { text, severe, original };
      }
    }
    return { text: original, severe: false, original };
  });
}

/** True when any segment failed to match a rule — the fold is worth offering. */
export function hasUntranslatedAuditNotes(segments: AuditNoteSegment[]): boolean {
  return segments.some((s) => s.text === s.original && /[a-z]{4,}/i.test(s.original));
}
