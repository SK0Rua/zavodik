/**
 * Ukrainian translation of the free text agents write about a business.
 *
 * Roman reads this console in Ukrainian. Two kinds of prose in the pipeline are
 * NOT in Ukrainian and cannot be, honestly, at the point they are produced:
 *
 *   - enrichment's soft gaps. The agent is instructed (enrich.ts SYSTEM_PROMPT
 *     rule 5) to stay in the language of the evidence, so a Patras salon whose
 *     site and reviews are Greek produces Greek gaps: «Δεν εντοπίστηκε επίσημος
 *     ιστότοπος της επιχείρησης». That rule is load-bearing — it is what stops
 *     the model from "translating" a business's own words into marketing copy —
 *     so the fix is a translation PASS, not a changed prompt.
 *   - the independent QA critic's findings, which are English by design: the
 *     critic is a different persona reasoning about provenance, not about the
 *     business.
 *
 * So translation happens here, once, at WRITE time, and is stored in a parallel
 * column (`production_gaps.gap_uk`, `qualifications.qa_notes_uk`). Write-time
 * rather than display-time because a page render must not depend on an agent
 * call: the UI would be slow, non-deterministic, and would re-spend the
 * subscription on every refresh.
 *
 * Three properties this module guarantees:
 *
 *   1. **The original is never overwritten.** It is the evidence of what the
 *      agent actually said; a translation sits next to it and the UI keeps it
 *      one fold away. Same reasoning as SPEC §5 for business facts.
 *   2. **Never fatal.** A translation failure returns nulls and logs a warning.
 *      An untranslated gap is a cosmetic problem; a failed enrichment is not.
 *   3. **No LLM when one is not needed.** Text that is already Ukrainian is
 *      passed through by a Cyrillic-ratio check, and the code-side gap KEYS
 *      (`logo_missing`, `socials_unresolved`, `brand_unresolved`) have a
 *      dictionary here — those strings are ours, so translating them with a
 *      model would be spending a subscription call to guess at our own words.
 */
import { runAgent, z } from '../agents/agent.js';
import { log } from './logger.js';

/**
 * Gap keys the pipeline itself writes as SOFT gaps, in Ukrainian.
 *
 * These never reach an agent. They are enumerated in the workers that write
 * them: `socials_unresolved` (enrich/enrichSocials), `brand_unresolved`
 * (brandIdentity), `logo_missing` (assets).
 */
export const SOFT_GAP_KEYS_UK: Record<string, string> = {
  socials_unresolved: 'соцмережі не знайдено — шукали, але підтвердити профіль не вдалося',
  brand_unresolved: 'фірмового стилю немає — ні логотипа, ні кольорів сайту, ні опису від бізнесу',
  logo_missing: 'логотипа немає серед зібраних матеріалів',
};

/**
 * Is this string already Ukrainian (or at least Cyrillic)?
 *
 * A ratio over the LETTERS only: punctuation, digits, URLs and a Latin brand
 * name inside an otherwise Ukrainian sentence must not push it below the bar.
 * Cyrillic is the right test rather than "Ukrainian" specifically — no other
 * Cyrillic language appears anywhere in this pipeline, and the alternative
 * (a language-ID model) would cost an agent call to answer a question that a
 * character-class check answers exactly.
 */
export function isCyrillic(text: string, minRatio = 0.5): boolean {
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return false;
  const cyrillic = letters.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length;
  return cyrillic / letters.length >= minRatio;
}

/** A short machine token (`logo_missing`), not a sentence anyone wrote. */
function isKeyLike(text: string): boolean {
  return /^[a-z0-9_.-]+$/.test(text.trim());
}

const TRANSLATION_SYSTEM = `You translate short internal notes into Ukrainian for a single reader.

RULES:
1. Translate meaning, not words. The result must read as natural Ukrainian.
2. Add NOTHING. No explanations, no softening, no extra context, no commentary. If a note says a thing is missing, the translation says exactly that thing is missing — nothing more.
3. Remove NOTHING. Every fact, number, name, quoted phrase, URL and date in the source appears in the translation.
4. Keep proper nouns, brand names, URLs, e-mail addresses and technical identifiers EXACTLY as written (Google, Treatwell, Instagram, WordPress, "λέιζερ" inside quotes stays quoted as-is when it is being quoted as a term).
5. Keep each note short — one sentence if the source is one sentence.
6. Return exactly as many strings as you were given, in the same order. An empty input string maps to an empty output string.
7. If a note is already in Ukrainian, return it unchanged.`;

const TranslationSchema = z.object({
  translations: z.array(z.string()),
});

/** Notes per agent call. Keeps one prompt small and one failure cheap. */
const BATCH_SIZE = 20;

/**
 * Translates a list of notes to Ukrainian.
 *
 * Returns an array of the SAME length, aligned by index, where each entry is
 * the Ukrainian text or `null` for "no translation needed or possible":
 * already-Cyrillic input, a key-like token, an empty string, or a failed call.
 * The caller stores nulls as nulls — the UI reads that as "show the original".
 *
 * @param context one short line naming what these notes are about, so the model
 *   translates «λέιζερ» in a beauty-salon sense rather than blindly.
 */
export async function translateToUkrainian(
  notes: string[],
  context: string,
): Promise<Array<string | null>> {
  const out: Array<string | null> = new Array(notes.length).fill(null);

  // Which entries actually need a model. Everything else is answered locally.
  const needed: number[] = [];
  notes.forEach((raw, i) => {
    const text = (raw ?? '').trim();
    if (!text) return;
    if (isKeyLike(text)) {
      // A key we own: our dictionary, or nothing (an unknown key is not prose,
      // and inventing a Ukrainian phrase for it would be a guess).
      const known = SOFT_GAP_KEYS_UK[text];
      if (known) out[i] = known;
      return;
    }
    if (isCyrillic(text)) return; // already readable
    needed.push(i);
  });

  if (needed.length === 0) return out;

  for (let start = 0; start < needed.length; start += BATCH_SIZE) {
    const idxs = needed.slice(start, start + BATCH_SIZE);
    const batch = idxs.map((i) => notes[i]!.trim());
    try {
      const result = await runAgent(
        'translate-notes',
        TRANSLATION_SYSTEM,
        [
          `Context: ${context}`,
          '',
          `Translate these ${batch.length} notes into Ukrainian. Return exactly ${batch.length} strings, in order.`,
          '',
          ...batch.map((t, n) => `${n + 1}. ${t}`),
        ].join('\n'),
        TranslationSchema,
        { kind: 'enrichment' },
      );
      // A model that returns the wrong count has mis-aligned the notes, and a
      // mis-aligned translation attributes one business's gap to another's —
      // worse than no translation. Drop the whole batch rather than guess.
      if (result.translations.length !== batch.length) {
        log.warn('note translation returned a mismatched count; batch dropped', {
          context, expected: batch.length, got: result.translations.length,
        });
        continue;
      }
      idxs.forEach((i, n) => {
        const uk = (result.translations[n] ?? '').trim();
        out[i] = uk || null;
      });
    } catch (err) {
      // Non-fatal by contract: the caller's real work has already succeeded.
      log.warn('note translation failed; originals kept', {
        context, batch: batch.length, err: String(err).slice(0, 200),
      });
    }
  }

  return out;
}

/**
 * Translates one block of text (the critic's whole `qa_notes` line).
 *
 * The critic's notes are a single `|`-joined string whose STRUCTURE the UI
 * parses (`risk=…`, `provenanceOk=…`, `CONTRADICTION: …`). Translating it as
 * one blob would destroy that structure, so the segments are split here, only
 * the prose ones are sent, and the machine-readable prefixes are rebuilt
 * verbatim around them.
 */
export async function translateQaNotes(raw: string | null | undefined, context: string): Promise<string | null> {
  if (!raw || !raw.trim()) return null;
  const parts = raw.split('|').map((p) => p.trim()).filter(Boolean);

  // Segments that are structure, not prose: they must survive byte-identical or
  // `parseCriticNotes` stops recognising them.
  const isStructural = (p: string) => /^(risk=|provenanceOk=)/i.test(p);
  /** `CONTRADICTION: <prose>` — the label is structure, the rest is prose. */
  const labelled = (p: string) => /^(CONTRADICTION|SUSPICIOUS):\s*/i.exec(p);

  const proseIdx: number[] = [];
  const proseText: string[] = [];
  parts.forEach((p, i) => {
    if (isStructural(p)) return;
    const m = labelled(p);
    const body = m ? p.slice(m[0].length) : p;
    if (!body.trim() || isCyrillic(body)) return;
    proseIdx.push(i);
    proseText.push(body.trim());
  });

  if (proseIdx.length === 0) return null;

  const translated = await translateToUkrainian(proseText, context);
  if (translated.every((t) => t === null)) return null;

  const rebuilt = [...parts];
  proseIdx.forEach((partIndex, n) => {
    const uk = translated[n];
    if (!uk) return;
    const m = labelled(parts[partIndex]!);
    rebuilt[partIndex] = m ? `${m[0]}${uk}` : uk;
  });
  return rebuilt.join(' | ').slice(0, 4000);
}
