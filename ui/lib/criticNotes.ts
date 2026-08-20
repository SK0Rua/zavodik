/**
 * The fact-checking agent's notes, split into something a page can render.
 *
 * `qualifications.qa_notes` is one field holding ~1,800 characters of English
 * written by the QA agent in a fixed shape:
 *
 *   risk=low | provenanceOk=true | <prose summary> | CONTRADICTION: … |
 *   SUSPICIOUS: … | SUSPICIOUS: …
 *
 * The Факти tab printed the whole string as one unbroken paragraph (sweep
 * P0-6). The record is worth keeping — it is the evidence that the package was
 * checked — but a wall of English is not an interface. This splits it into the
 * two halves that mean different things: the machine-readable verdict, which
 * becomes a Ukrainian sentence, and the individual findings.
 *
 * Since Roman's 2026-08-20 decision the findings are Ukrainian too, but they
 * are NOT translated here: `score.ts` translates them once at write time into
 * `qualifications.qa_notes_uk` and this parser is simply pointed at that column
 * (`parseCriticNotes(row.qaNotesUk ?? row.qaNotes)`). Translating at render
 * time would mean an agent call per page view; translating IN PLACE would
 * destroy the record of what the critic actually said. The English original
 * stays one fold away, which is what keeps the evidence claim honest on the one
 * tab whose whole job is faithfulness to the source.
 */

export interface CriticFinding {
  kind: 'CONTRADICTION' | 'SUSPICIOUS';
  text: string;
}

export interface CriticNotes {
  /** The verdict, as one Ukrainian sentence. */
  summary: string;
  findings: CriticFinding[];
}

const RISK_UK: Record<string, string> = {
  none: 'ризику не виявлено',
  low: 'низький ризик',
  medium: 'середній ризик',
  high: 'високий ризик',
};

/**
 * Parses the notes. Returns null when there is nothing to show.
 *
 * Deliberately tolerant: older rows predate parts of this shape, and a note
 * that does not parse must still reach the reader rather than vanish — an
 * unparsed note becomes the summary as-is.
 */
export function parseCriticNotes(raw: string | null | undefined): CriticNotes | null {
  if (!raw || !raw.trim()) return null;
  const parts = raw.split('|').map((p) => p.trim()).filter(Boolean);

  let risk: string | null = null;
  let provenanceOk: boolean | null = null;
  const prose: string[] = [];
  const findings: CriticFinding[] = [];

  for (const part of parts) {
    const riskMatch = /^risk=(\w+)$/i.exec(part);
    if (riskMatch) { risk = riskMatch[1]!.toLowerCase(); continue; }

    const provMatch = /^provenanceOk=(true|false)$/i.exec(part);
    if (provMatch) { provenanceOk = provMatch[1]!.toLowerCase() === 'true'; continue; }

    const findingMatch = /^(CONTRADICTION|SUSPICIOUS):\s*(.+)$/is.exec(part);
    if (findingMatch) {
      findings.push({
        kind: findingMatch[1]!.toUpperCase() as CriticFinding['kind'],
        // A finding can itself contain a `|`-free sentence that got split; the
        // pieces are rejoined by the caller order, so keep whitespace tidy.
        text: findingMatch[2]!.replace(/\s+/g, ' ').trim(),
      });
      continue;
    }

    // A continuation of the previous finding (the agent's prose contains
    // pipes), or the summary prose itself.
    if (findings.length > 0) {
      findings[findings.length - 1]!.text += ` | ${part.replace(/\s+/g, ' ').trim()}`;
    } else {
      prose.push(part);
    }
  }

  const summary = buildSummary(risk, provenanceOk, findings.length, prose);
  if (!summary && findings.length === 0) return null;
  return { summary: summary || raw.trim(), findings };
}

function buildSummary(
  risk: string | null,
  provenanceOk: boolean | null,
  findingCount: number,
  prose: string[],
): string {
  const bits: string[] = [];

  if (provenanceOk === true) {
    bits.push('у кожного факту є джерело');
  } else if (provenanceOk === false) {
    bits.push('є факти без джерела');
  }

  if (risk) bits.push(RISK_UK[risk] ?? `ризик: ${risk}`);

  if (findingCount > 0) {
    bits.push(`${findingCount} ${pluralFinding(findingCount)} від критика`);
  } else if (bits.length > 0) {
    bits.push('зауважень немає');
  }

  if (bits.length === 0) return prose.join(' ');
  // The agent's own English prose is NOT inlined here — it is the thing that
  // made this panel unreadable. It stays available in the folded findings.
  return `${capitalise(bits.join(' · '))}.`;
}

function pluralFinding(n: number): string {
  const mod10 = n % 10; const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'зауваження';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'зауваження';
  return 'зауважень';
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * A SOFT gap, shortened for display.
 *
 * Soft gaps are whole sentences the enrichment agent writes in the language of
 * the EVIDENCE — English for an English site, Greek for a Patras salon («Δεν
 * εντοπίστηκε επίσημος ιστότοπος…»). Since 2026-08-20 `enrich.ts` translates
 * each one at write time into `production_gaps.gap_uk`, so the normal path is
 * simply to render that column.
 *
 * The pattern table below is the FALLBACK for rows written before that (156 of
 * them on the Patras campaign at the time) and for any row whose translation
 * call failed. It only ever matches English, which is why the Greek rows need
 * the backfill (`pnpm tsx scripts/translate-notes.ts`) rather than more
 * patterns: hand-writing a regex per Greek sentence would be guessing at text
 * an agent wrote about evidence this file has never seen.
 *
 * A gap that matches nothing is shown as the agent wrote it — an untranslated
 * sentence should look untranslated, not like missing evidence.
 */
const SOFT_GAP_PATTERNS: Array<[RegExp, string]> = [
  // "found in either source" / "present in the evidence" / "listed anywhere" —
  // the agent varies the verb freely, so match on the subject, not the phrasing.
  [/^no (business[- ])?e-?mail( address)? (was )?(found|present|listed|given|identified|available)/i,
    'не знайшли email'],
  [/^no prices? (are |is )?(given|found|listed)/i, 'ніде не вказані ціни'],
  [/^no (business-owned |owned |official |dedicated |independently owned )?(business )?website (was )?(found|identified)/i,
    'власного сайту немає — тільки соцмережі та Google'],
  [/^no languages? (spoken )?(by staff )?(are )?(stated|explicit)/i,
    'не вказано, якими мовами обслуговують'],
  [/^no certifications?, awards?/i, 'немає сертифікатів, нагород чи років на ринку'],
  [/^no (officially confirmed |dedicated )?owner('s)? (name|personal name)/i,
    'імʼя власника не підтверджене'],
  [/^no formal business description/i, 'немає повного опису бізнесу'],
  [/^no explicit statement of languages/i, 'не вказано, якими мовами обслуговують'],
];

/** The code-side soft-gap KEYS, which are ours rather than the agent's. */
const SOFT_GAP_KEYS: Record<string, string> = {
  socials_unresolved: 'соцмережі не знайдено — шукали, але підтвердити профіль не вдалося',
  brand_unresolved: 'фірмового стилю немає — ні логотипа, ні кольорів сайту, ні опису від бізнесу',
  logo_missing: 'логотипа немає серед зібраних матеріалів',
};

/**
 * @param gap the original, as the agent wrote it (`production_gaps.gap`)
 * @param gapUk the stored translation (`production_gaps.gap_uk`), when there is
 *   one. Passing it is what makes this Ukrainian for Greek evidence; omitting
 *   it degrades to the English-only patterns above.
 */
export function softGapText(gap: string, gapUk?: string | null): string {
  const stored = gapUk?.trim();
  if (stored) return shorten(stored);

  const trimmed = gap.trim();
  const key = SOFT_GAP_KEYS[trimmed];
  if (key) return key;
  for (const [re, uk] of SOFT_GAP_PATTERNS) {
    if (re.test(trimmed)) return uk;
  }
  return shorten(trimmed);
}

/**
 * True when the reader is looking at the agent's own untranslated words, so the
 * page can label the fold honestly instead of claiming an original it is
 * already showing.
 */
export function isSoftGapTranslated(gap: string, gapUk?: string | null): boolean {
  if (gapUk?.trim()) return true;
  const trimmed = gap.trim();
  if (SOFT_GAP_KEYS[trimmed]) return true;
  return SOFT_GAP_PATTERNS.some(([re]) => re.test(trimmed));
}

/**
 * Long agent prose truncated to one readable line; the full text is the `title`
 * tooltip and the folded list below the panel.
 */
function shorten(text: string): string {
  return text.length > 110 ? `${text.slice(0, 110)}…` : text;
}
