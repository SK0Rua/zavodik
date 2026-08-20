/**
 * Deterministic grounding check (spec §5: "Вигадувати контакти/послуги/послуги/
 * відгуки/ціни неможливо by construction").
 *
 * A prompt that says "do not invent" is a request, not a guarantee — observed
 * in the real run: for a hair salon whose site listed 8 services, the model
 * returned 10, adding "beard care" and "moustache care". Both are plausible for
 * a barbershop and neither appears anywhere in the evidence.
 *
 * So the model's output is treated as a CLAIM that must be re-verified against
 * the captured text before it becomes a fact. This module is that verifier:
 * pure string work over the exact source block the claim cites.
 *
 * The test is lexical, not semantic: a claim is grounded when its meaningful
 * words actually occur in the cited source. Paraphrase and inflection survive
 * (Greek is heavily inflected, so matching is done on word STEMS); invention
 * does not, because invented terms bring words the source never contained.
 */
import { config } from '../config.js';


/** Strips diacritics and case so "Βαφείο" and "βαφειο" compare equal. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // Greek final sigma is the same letter as sigma for matching purposes
    .replace(/ς/g, 'σ')
    .normalize('NFC');
}

/**
 * Greek (and Latin) inflection means "κούρεμα" / "κουρέματα" / "κουρέματος" are
 * the same word for our purposes. Comparing on a truncated stem is crude but
 * exactly right here: it must be permissive enough for real paraphrase and
 * strict enough that an unrelated invented word cannot match.
 */
export function stem(word: string): string {
  const w = fold(word);
  return w.length <= 5 ? w : w.slice(0, Math.max(5, Math.floor(w.length * 0.7)));
}

/** Words carrying no evidential weight: matching them proves nothing. */
const STOPWORDS = new Set([
  // Greek
  'και', 'με', 'για', 'στο', 'στη', 'στην', 'στον', 'του', 'της', 'των', 'τον', 'την', 'το', 'ο', 'η', 'οι', 'τα',
  'ενα', 'μια', 'ειναι', 'απο', 'σε', 'που', 'δεν', 'υπηρεσια', 'υπηρεσιες', 'παροχη', 'παροχες',
  // Latin
  'and', 'the', 'for', 'with', 'our', 'your', 'service', 'services', 'of', 'in', 'at', 'to', 'a', 'an', 'is', 'are',
]);

export function contentWords(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export interface GroundingVerdict {
  grounded: boolean;
  /** 0..1 — share of the claim's content words found in the source. */
  coverage: number;
  missingWords: string[];
}

/**
 * Strips a trailing parenthetical gloss: `PMU (Permanent Make-Up)` -> `PMU`.
 *
 * Observed on the real run: the evidence (an Instagram bio) says "Nails • Lashes
 * • PMU • SMP", and the model helpfully expanded the acronyms. The SERVICE is
 * real and cited; only the expansion is unverifiable — and for "SMP" the model
 * guessed "Scalp Micropigmentation", a word appearing nowhere in the evidence.
 *
 * So the head term is what gets grounded. The gloss is dropped from the stored
 * value by the caller, rather than the whole fact being discarded.
 */
export function stripGloss(claim: string): { head: string; gloss: string | null } {
  const m = claim.match(/^\s*(.+?)\s*\(([^)]{2,60})\)\s*$/);
  if (!m) return { head: claim.trim(), gloss: null };
  const head = m[1].trim();
  // Only treat it as a gloss when the head can stand alone as a name.
  if (head.length < 2) return { head: claim.trim(), gloss: null };
  return { head, gloss: m[2].trim() };
}

/**
 * Removes the model's own framing prefix so the check sees the CLAIM, not the
 * commentary wrapped around it.
 *
 * Observed on the real run: statements arrive as "Google listing attributes:
 * accepts credit cards, debit cards and NFC mobile pay". The payload after the
 * colon is faithfully grounded; the prefix is the model narrating where it
 * looked, and its words ("google", "listing", "attributes") are absent from the
 * evidence, dragging coverage below the threshold.
 */
const FRAMING_PREFIX = /^\s*(?:google\s+(?:listing\s+)?(?:attributes?|profile|maps)|listing\s+attributes?|from\s+the\s+(?:listing|website|reviews?)|per\s+the\s+\w+|according\s+to\s+[\w\s]{0,20}|the\s+(?:listing|site|page)\s+(?:says|states|shows)|reviews?\s+mention|website\s+states)\s*[:—-]\s*/i;

export function stripFraming(claim: string): string {
  const stripped = claim.replace(FRAMING_PREFIX, '').trim();
  // never strip the whole claim away
  return stripped.length >= 3 ? stripped : claim.trim();
}

/**
 * Checks one claim against the source text it cites.
 *
 * `threshold` is the share of content words that must appear. The default
 * (config `GROUNDING_THRESHOLD`, 0.5) tolerates genuine paraphrase
 * ("Γυναικείο κούρεμα" from "κούρεμα γυναικών") while rejecting a wholly
 * invented term, whose words are absent entirely.
 */
export function checkGrounding(claim: string, sourceText: string, threshold = config.pipeline.groundingThreshold): GroundingVerdict {
  const words = contentWords(stripFraming(claim));
  if (words.length === 0) return { grounded: false, coverage: 0, missingWords: [] };

  const haystack = fold(sourceText);
  const missing: string[] = [];
  const found: string[] = [];
  for (const w of words) {
    // A stem match tolerates inflection; the full word is tried first.
    if (haystack.includes(w) || haystack.includes(stem(w))) found.push(w);
    else missing.push(w);
  }
  const coverage = found.length / words.length;

  // A short claim ("Θεωρείται κατάλληλο για παιδιά" -> 3 content words) can be a
  // faithful paraphrase of "Καλό για παιδιά" and still miss the ratio, because
  // Greek synonyms share no stem. When the claim's DISTINCTIVE term — its
  // longest content word — is present in the source, the claim is anchored to
  // real evidence even if the connecting words were reworded. An invention has
  // no such anchor: its subject noun is absent entirely.
  // "Distinctive" = a long-enough word to be a subject noun rather than a
  // connector. Matching one of those in the source is the anchor.
  const anchored = words.length <= 4
    && found.some((w) => w.length >= 6)
    && coverage >= 1 / 3;

  return { grounded: coverage >= threshold || anchored, coverage, missingWords: missing };
}

/**
 * A quoted review must be near-verbatim, not paraphrased: it will be shown to
 * the business as their customer's words. The longest common run of words has
 * to be substantial.
 */
export function checkQuoteGrounding(quote: string, sourceText: string): GroundingVerdict {
  const q = contentWords(quote);
  if (q.length === 0) return { grounded: false, coverage: 0, missingWords: [] };
  // Compare content words to content words: the quote may be trimmed and the
  // source keeps stopwords/punctuation between them, so a raw substring test on
  // the original text would fail on genuinely verbatim citations.
  const hay = ` ${contentWords(sourceText).join(' ')} `;

  // longest run of consecutive claim words that appears verbatim in the source
  let longestRun = 0;
  for (let i = 0; i < q.length; i++) {
    for (let len = q.length - i; len > longestRun; len--) {
      if (hay.includes(` ${q.slice(i, i + len).join(' ')} `)) {
        longestRun = len;
        break;
      }
    }
  }
  const coverage = longestRun / q.length;
  // 6 consecutive words, or 60% of a short quote, is a real citation
  const grounded = longestRun >= 6 || coverage >= 0.6;
  return { grounded, coverage, missingWords: grounded ? [] : q };
}
