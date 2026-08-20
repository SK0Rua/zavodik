/**
 * Deterministic matcher deciding whether a captured social profile belongs to a
 * given business (spec §5: "LLM ніколи не вирішує ... Це код").
 *
 * The rule that matters: a profile is only linked to a business when the
 * CAPTURED PROFILE PAGE itself carries corroborating evidence. Search engines
 * return plausible-looking profiles for any query; "the name is similar" is not
 * evidence, because Greek beauty salons share the same handful of words
 * ("hair", "beauty", "studio", "nails"). So name similarity alone can never
 * reach `verified` — it must be joined by a phone, an address, a website link,
 * or the city, all of which are read from the profile's own public page.
 *
 * Everything here is pure string work over already-captured text. Nothing in
 * this file performs I/O, so `scripts/test-social-match.ts` covers it fully.
 */
import { fold } from './grounding.js';

export type SocialPlatform = 'instagram' | 'facebook' | 'tiktok';

export interface MatchInput {
  /** Business identity from the DB — the thing we are trying to confirm. */
  business: {
    name: string;
    city: string;
    /** Digits only; whatever `businesses.normalized_phone` holds. */
    phone?: string | null;
    address?: string | null;
    /** Owned domain (never a directory), used to spot a bio linking home. */
    domain?: string | null;
    category?: string | null;
  };
  /** Everything publicly readable on the captured profile page. */
  profile: {
    platform: SocialPlatform;
    /** Handle / page slug taken from the URL. */
    handle: string;
    /** og:title, page <title>, and any displayed full name. */
    title: string;
    /** og:description + visible bio text. */
    bio: string;
    /** Full readable page text (bounded by the caller). */
    text: string;
  };
}

export type MatchStrength = 'strong' | 'medium' | 'weak';

export interface MatchVerdict {
  strength: MatchStrength;
  score: number;
  /** Human-readable reasons, stored with the contact so Roman can audit them. */
  signals: string[];
  /** Why it was not stronger — surfaced in the run report. */
  blockers: string[];
  nameSimilarity: number;
  /** True when a hard corroborating signal (phone/website/address) was found. */
  corroborated: boolean;
}

/**
 * Greek → Latin transliteration, so "Κομμωτήριο Δημησιάνος" and
 * "Dimisianos Coiffures" share tokens, and an Instagram handle written in
 * Latin can match a listing name written in Greek.
 *
 * Digraphs come first: μπ→b, ντ→d, γκ→g are how Greek writes sounds Latin
 * spells with a single letter, and a per-character pass would produce "mp",
 * "nt", "gk" and silently lose the match.
 */
const GREEK_DIGRAPHS: Array<[RegExp, string]> = [
  [/ου/g, 'ou'], [/μπ/g, 'b'], [/ντ/g, 'd'], [/γκ/g, 'g'], [/γγ/g, 'ng'],
  [/τσ/g, 'ts'], [/τζ/g, 'tz'], [/αι/g, 'ai'], [/ει/g, 'ei'], [/οι/g, 'oi'],
  [/αυ/g, 'av'], [/ευ/g, 'ev'],
];
const GREEK_CHARS: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i',
  κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's',
  ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

/** Lowercases, strips diacritics, and renders Greek in Latin letters. */
export function translit(s: string): string {
  let out = fold(s);
  for (const [re, rep] of GREEK_DIGRAPHS) out = out.replace(re, rep);
  return out.replace(/[Ͱ-Ͽἀ-῿]/g, (ch) => GREEK_CHARS[ch] ?? ch);
}

/**
 * Words that describe the TRADE rather than identify the business. Two unrelated
 * Patras salons both called "… hair studio" must not match on those two words,
 * so they are excluded from the distinctive set — but they are NOT deleted:
 * a name that is *only* generic words ("Hair Salon") still needs something to
 * compare, and the category-overlap signal uses them.
 */
const GENERIC_TOKENS = new Set([
  // Latin / English
  'hair', 'salon', 'design', 'studio', 'beauty', 'nails', 'nail', 'spa', 'center', 'centre',
  'laser', 'clinic', 'lounge', 'room', 'shop', 'store', 'bar', 'art', 'style', 'styling',
  'coiffure', 'coiffures', 'barber', 'barbershop', 'makeup', 'make', 'up', 'lashes', 'lash',
  'skin', 'aesthetic', 'aesthetics', 'cosmetic', 'cosmetics', 'institute', 'by', 'the', 'and',
  'more', 'group', 'team', 'official', 'gr', 'greece', 'professional', 'luxury', 'new', 'my',
  // Greek (transliterated, since comparison happens post-transliteration)
  'kommotirio', 'kommotiria', 'institouto', 'aisthitikis', 'aisthitiki', 'omorfias',
  'kentro', 'nyxion', 'malliwn', 'peripoiisi', 'gynaikeio', 'andriko',
]);

/** City names never distinguish two businesses in the same city. */
const CITY_TOKENS = new Set(['patras', 'patra', 'patrai', 'patron', 'ptr']);

export function tokenize(name: string): string[] {
  return translit(name)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Tokens that actually identify this business, generic trade words removed. */
export function distinctiveTokens(name: string): string[] {
  const all = tokenize(name);
  const distinctive = all.filter((t) => !GENERIC_TOKENS.has(t) && !CITY_TOKENS.has(t) && t.length >= 3);
  // A name made entirely of trade words ("Hair Salon") has no distinctive part.
  // Returning the generic tokens instead would let every salon match every
  // other one, so an empty set is the honest answer and the caller treats it
  // as "cannot be identified by name".
  return distinctive;
}

/**
 * How much of the business's identifying name shows up in the profile's
 * name/handle. Handles concatenate ("extehairdesign"), so a token counts as
 * present when it occurs as a substring of the de-punctuated profile string.
 *
 * Returns the share of DISTINCTIVE business tokens found. A profile carrying
 * extra words of its own does not lose points: "Exte Hair Design Patras" is
 * still the same business.
 */
export function nameSimilarity(businessName: string, profileName: string, profileHandle: string): number {
  const wanted = distinctiveTokens(businessName);
  if (wanted.length === 0) return 0;
  const hay = `${translit(profileName)} ${translit(profileHandle)}`.replace(/[^a-z0-9]+/g, ' ');
  const squashed = hay.replace(/\s+/g, '');
  let found = 0;
  for (const t of wanted) {
    // A short token must match as a whole word; a longer one may be glued into
    // a handle. Without the length guard, "ae" would match inside "michael".
    const whole = new RegExp(`(^| )${t}( |$)`).test(hay);
    if (whole || (t.length >= 4 && squashed.includes(t))) found++;
  }
  return found / wanted.length;
}

/** Digits of a phone number, for substring comparison against bio text. */
export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

/**
 * Does the page text contain this phone? Bios write numbers with spaces, dots
 * and country prefixes ("tel 2610270502", "+30 2610 270 502"), so both sides
 * are reduced to digits and the last 9-10 digits are compared — that is the
 * Greek subscriber number, stable across +30 / 0030 / bare forms.
 */
export function phoneMentioned(phone: string | null | undefined, text: string): boolean {
  const want = phoneDigits(phone);
  if (want.length < 9) return false;
  const tail = want.slice(-9);
  const hay = text.replace(/\D/g, '');
  return hay.includes(tail);
}

/**
 * Street name from a Greek listing address ("Γούναρη 21-23, Πάτρα 262 21").
 * Only the street WORD is used: house numbers and postcodes are formatted too
 * many ways to compare reliably, and the street alone plus a city is already a
 * meaningful coincidence to require.
 */
export function addressStreetTokens(address: string | null | undefined): string[] {
  if (!address) return [];
  const first = address.split(',')[0] ?? '';
  return translit(first)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !/^\d+$/.test(t) && !CITY_TOKENS.has(t));
}

const CITY_MENTION = /\b(patra|patras|patrai|patron)\b/;

/**
 * Scores one candidate profile against one business.
 *
 * Weights are deliberately lopsided: name similarity alone caps out below the
 * `strong` line, so no profile is ever marked verified on a name alone.
 *
 *   phone in bio      +45   (near-conclusive: a phone is unique to a business)
 *   own website link  +30
 *   street + city     +25
 *   city mention      +12
 *   name similarity   +35 * share
 *   category words    +8
 *
 * strong  >= 70 AND a hard corroborator (phone / website / street) AND name >= 0.5
 * medium  >= 40 (a candidate for Roman to confirm in the UI)
 * weak    otherwise (evidence is kept, no contact row is written)
 */
export function scoreProfileMatch(input: MatchInput): MatchVerdict {
  const { business, profile } = input;
  const signals: string[] = [];
  const blockers: string[] = [];
  let score = 0;

  const haystackRaw = `${profile.title}\n${profile.bio}\n${profile.text}`;
  const haystack = translit(haystackRaw);

  const sim = nameSimilarity(business.name, profile.title, profile.handle);
  if (distinctiveTokens(business.name).length === 0) {
    blockers.push('business name has no distinctive tokens (generic trade words only)');
  }
  score += Math.round(35 * sim);
  if (sim > 0) signals.push(`name similarity ${sim.toFixed(2)}`);

  let corroborated = false;
  // Hard corroborators are counted, not just flagged: two independent ones
  // (a phone AND the business's own domain, say) identify a business even when
  // its NAME cannot — see the name-similarity exemption below.
  let hardSignals = 0;

  if (phoneMentioned(business.phone, haystackRaw)) {
    score += 45;
    corroborated = true;
    hardSignals++;
    signals.push('listing phone appears on the profile');
  }

  // A bio linking to the business's own domain is the business pointing at
  // itself — as strong as a phone and impossible to produce by coincidence.
  if (business.domain) {
    const dom = fold(business.domain).replace(/^www\./, '');
    if (haystack.includes(dom)) {
      score += 30;
      corroborated = true;
      hardSignals++;
      signals.push(`profile links the business domain (${dom})`);
    }
  }

  const streetTokens = addressStreetTokens(business.address);
  const cityHit = CITY_MENTION.test(haystack) || haystack.includes(translit(business.city));
  const streetHit = streetTokens.some((t) => haystack.includes(t));
  if (streetHit && cityHit) {
    score += 25;
    corroborated = true;
    hardSignals++;
    signals.push(`address street + city on the profile (${streetTokens.filter((t) => haystack.includes(t)).join(', ')})`);
  } else if (streetHit) {
    score += 12;
    signals.push(`address street on the profile (${streetTokens.filter((t) => haystack.includes(t)).join(', ')})`);
  } else if (cityHit) {
    score += 12;
    signals.push('city mentioned on the profile');
  } else {
    blockers.push('no city or address on the profile');
  }

  // Category words ("κομμωτήριο" / "hair salon") corroborate the TRADE but
  // never the identity, so the weight is small on purpose.
  const catTokens = tokenize(business.category ?? '').filter((t) => t.length >= 4);
  if (catTokens.some((t) => haystack.includes(t))) {
    score += 8;
    signals.push('business category words on the profile');
  }

  if (!corroborated) blockers.push('no hard corroborator (phone / own domain / street+city)');

  /**
   * The name check exists to stop "similar name, different business". It must
   * not block a match that identity-level evidence has already settled.
   *
   * Real cases from the Patras run: "GK Beauty Room" and "ᗅ ᗄ Hair Salon" have
   * NO distinctive name tokens at all (trade words, initials, unicode glyphs),
   * so name similarity is 0 by construction — yet their Facebook pages carry
   * the listing's phone, its street AND its city, and for GK also a link to
   * gkbeautyroom.gr. Demanding a name match there rejects a page proven by
   * three independent facts, purely because the business is named generically.
   *
   * So two or more independent hard corroborators substitute for the name
   * check. One is deliberately not enough: a lone shared street or a single
   * phone digit-run could be a coincidence, and staying at `medium` puts it in
   * front of Roman rather than into outreach.
   */
  const identityProven = hardSignals >= 2;
  if (sim < 0.5 && !identityProven) blockers.push(`name similarity below 0.5 (${sim.toFixed(2)})`);

  const strength: MatchStrength =
    score >= 70 && corroborated && (sim >= 0.5 || identityProven) ? 'strong'
      : score >= 40 ? 'medium'
        : 'weak';

  return { strength, score, signals, blockers, nameSimilarity: sim, corroborated };
}
