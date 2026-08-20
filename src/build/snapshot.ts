/**
 * Build snapshot — the frozen, source-backed package the builder agent sees.
 *
 * SPEC §4 stage 10 / CLAUDE.md invariant: "Кожен факт має source_id → immutable
 * raw evidence. Немає доказу = null + gap." The snapshot is the enforcement point:
 * the builder agent has no DB access and no internet, so anything not in here
 * cannot legitimately appear on the site. Provenance checking after the build
 * (`provenance.ts`) diffs the rendered HTML against exactly this object.
 *
 * Relationship to `src/workers/snapshot.ts` (owned by phase B): that module builds
 * the light `ClientSnapshot` used by enrichment-era code. This one is a superset —
 * it carries contacts as rows (not just `businesses.phone`), source ids per fact,
 * asset provenance including `ai_generated`, and the audit verdict — and is frozen
 * to storage so a rebuild months later reproduces the same site inputs.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { log } from '../lib/logger.js';

/** A fact that survived into the snapshot always names the evidence behind it. */
export interface SourcedValue<T> {
  value: T;
  /** business_sources.id rows backing this value. Empty only for gosom-native columns. */
  sourceIds: number[];
  confidence: number;
}

export interface SnapshotContact {
  channel: string; // phone | email | whatsapp | instagram | facebook | viber | contact_form
  value: string;
  verified: boolean;
  sourceIds: number[];
}

export interface SnapshotAsset {
  /** Path as it will exist in the workspace: `assets/<file>` or `generated/<file>`. */
  file: string;
  objectKey: string;
  kind: string; // hero | logo | gallery | menu | background | pattern | og | hero_clip | demo
  width: number | null;
  height: number | null;
  contentType: string | null;
  /** AI-generated media is decorative and must never be captioned as a real photo. */
  aiGenerated: boolean;
  generator: string | null;
  sourceUrl: string;
}

/**
 * The business's OWN visual identity, measured from its evidence by
 * `src/enrichment/brandIdentity.ts`. This is the section the art director must
 * start from (SPEC §2.4; Roman's rejection of the first batch: "Чого всі демо в
 * одному стилі?").
 *
 * Every colour here was decoded from a real pixel or read out of a real
 * stylesheet declaration, and carries the `source_id` of the capture that
 * proves it. `null` throughout means the business genuinely published no
 * identity we could measure — which is a fact the design must be told, not a
 * hole to fill with the reference pack's taste.
 */
export interface SnapshotBrand {
  /** Which evidence the palette rests on. `none` = nothing measurable. */
  paletteSource: 'logo' | 'avatar' | 'site' | 'photos' | 'none';
  /** The business's dominant identity colour. */
  primary: { hex: string; from: string; sourceIds: number[] } | null;
  /**
   * The colour to key on, plus the two contrast-corrected variants. Text or a
   * button in the raw accent frequently fails AA; the corrected pair keeps the
   * hue and moves only lightness, so the page stays the brand's colour and
   * still passes.
   */
  accent: {
    hex: string; from: string; sourceIds: number[];
    onLight: string | null; onDark: string | null;
  } | null;
  /** Full measured palettes, so a direction can build a scale rather than pick two swatches. */
  logoColors: BrandPalette | null;
  avatarColors: BrandPalette | null;
  siteColors: BrandPalette | null;
  photoColors: BrandPalette | null;
  /** Typefaces the business's own site asks for. Not a licence to use them — a signal of register. */
  fontsSeen: { fonts: string[]; sourceIds: number[] } | null;
  /**
   * The business's OWN mark, when one was found — the file the header and
   * footer must use verbatim.
   *
   * It is repeated here, next to the palette, rather than left for the builder
   * to locate among thirty assets by `kind`. A logo is not one image among
   * many: it is the single element that must never be redrawn, restyled or
   * approximated, and putting it in the brand section is what makes that
   * instruction unmissable in `BUILD-TASK.md`.
   *
   * `null` means the business publishes no mark we could verify. That is a
   * fact, and the correct response is a typographic wordmark of the business's
   * NAME — never an invented emblem.
   */
  logo: {
    /** Workspace-relative path, identical to the matching `assets[]` entry. */
    file: string;
    width: number | null;
    height: number | null;
    /** SVG marks scale losslessly; rasters must not be enlarged past 1x. */
    vector: boolean;
    /** Where it was found: the site, an Instagram avatar, ... */
    origin: string;
    sourceUrl: string;
  } | null;
  /** Register of the business's own words, from a single structured call over captured bios. */
  voice: {
    tone: string;
    formality: string;
    selfDescribedAs: string[];
    statedBrandElements: string[];
    sourceIds: number[];
  } | null;
}

export interface BrandPalette {
  from: string;
  sourceIds: number[];
  colors: Array<{ hex: string; share: number; hsl: { h: number; s: number; l: number } }>;
}

export interface BuildSnapshot {
  /** Frozen at this instant; the object is written to storage verbatim. */
  snapshotVersion: 1;
  capturedAt: string;
  businessId: string;
  campaignId: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  /** BCP-47-ish language for ALL visible copy, from the campaign. */
  language: string;
  languageName: string;
  description: SourcedValue<string> | null;
  hours: SourcedValue<unknown> | null;
  rating: number | null;
  reviewCount: number | null;
  services: Array<SourcedValue<{ name: string; price?: string | null; description?: string | null }>>;
  reviews: Array<SourcedValue<{ text: string; rating?: number | null; author?: string | null }>>;
  socials: Record<string, string>;
  contacts: SnapshotContact[];
  /** Every other verified fact, so the brief writer can use what exists. */
  otherFacts: Array<{ key: string; value: unknown; sourceIds: number[]; confidence: number }>;
  assets: SnapshotAsset[];
  /** The business's own visual identity — the starting point for the palette. */
  brand: SnapshotBrand;
  website: {
    url: string | null;
    verdict: string;
    meaningfulContent: boolean | null;
    notes: string | null;
  };
  /**
   * Unresolved production gaps, so the brief can route around them honestly.
   * As the agent wrote them, in the language of the evidence — this is the copy
   * the BUILDER reads, and it must not be paraphrased through a translation.
   */
  openGaps: string[];
  /**
   * The same gaps in Ukrainian, aligned by index, for the snapshot page Roman
   * reads. Null where no translation was stored (a row written before
   * `gap_uk` existed, or a translation call that failed) — the page falls back
   * to `openGaps[i]` rather than showing a hole.
   */
  openGapsUk: Array<string | null>;
  sources: Array<{ id: number; type: string; url: string; capturedAt: string; method: string }>;
}

const LANGUAGE_NAMES: Record<string, string> = {
  el: 'Greek (Ελληνικά)',
  en: 'English',
  uk: 'Ukrainian',
  ru: 'Russian',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
};

/** Social hosts whose "profile" paths are frequently scraping artifacts. */
const SOCIAL_PLACEHOLDER_PATHS = new Set([
  '_u', 'p', 'explore', 'accounts', 'reel', 'reels', 'stories', 'share',
  'tr', 'login', 'privacy', 'about', 'directory', 'legal', 'help',
]);

/**
 * Why this contact must not appear on a demo, or null when it is usable.
 *
 * Deliberately conservative: it rejects only strings that are *structurally*
 * wrong, never ones that merely look unusual. Dropping a real contact would
 * leave a demo with no call to action, which is worse than showing an odd one.
 */
export function unusableContactReason(channel: string, raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'empty';

  if (channel === 'phone' || channel === 'whatsapp' || channel === 'viber') {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 8) return `only ${digits.length} digits — not a dialable number`;
    if (digits.length > 15) return `${digits.length} digits — longer than E.164 allows`;
    if (/^(\d)\1+$/.test(digits)) return 'all identical digits — placeholder';
    return null;
  }

  if (channel === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) return 'not a syntactically valid address';
    const domain = value.split('@')[1]!.toLowerCase();
    // RFC 2606 / 6761 reserved names exist precisely so they never resolve.
    if (/(^|\.)(example|invalid|test|localhost)\.[a-z]{2,}$/.test(domain)
      || /(^|\.)(example|invalid|test|localhost)$/.test(domain)) {
      return `reserved placeholder domain "${domain}" — would never deliver`;
    }
    if (/^(no-?reply|do-?not-?reply)@/i.test(value)) return 'no-reply address — not a contact';
    return null;
  }

  if (channel === 'instagram' || channel === 'facebook') {
    // Check the bare-handle form FIRST. `new URL('https://@velvet.lounge')`
    // parses successfully with the handle as the *host* and an empty path, which
    // would otherwise be misread as "links to the network root".
    if (!/^https?:\/\//i.test(value) && !value.includes('/')) {
      return /^@?[\w.]{2,}$/.test(value) ? null : 'neither a URL nor a handle';
    }
    let url: URL;
    try {
      url = new URL(value.startsWith('http') ? value : `https://${value}`);
    } catch {
      return 'neither a URL nor a handle';
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return 'links to the network root, not a profile';
    const handle = segments[0]!.toLowerCase();
    if (SOCIAL_PLACEHOLDER_PATHS.has(handle)) {
      return `"${handle}" is a platform path, not a profile (scraping artifact)`;
    }
    if (handle.length < 2) return `"${handle}" is too short to be a profile`;
    return null;
  }

  if (/^https?:/i.test(value)) {
    try {
      const url = new URL(value);
      // Google's redirector is what a Maps listing links through, not a real site.
      if (/(^|\.)google\.[a-z.]+$/.test(url.host) && url.pathname.startsWith('/url')) {
        return 'Google redirector URL, not the business\'s own link';
      }
      return null;
    } catch {
      return 'malformed URL';
    }
  }

  return null;
}

/** Text a human would read on the site, in the order it must be checkable against. */
function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'text' in (v as Record<string, unknown>)) {
    const t = (v as Record<string, unknown>).text;
    if (typeof t === 'string') return t;
  }
  return null;
}

/**
 * Some enrichment writes services as one fact per service (`key='service'`),
 * some as a single array (`key='services'`). Accept both rather than forcing
 * phase B to change its writer.
 */
function explodeFacts(
  rows: Array<{ key: string; value: unknown; sourceId: number | null; confidence: number; verified: boolean }>,
  singular: string,
  plural: string,
): Array<{ value: unknown; sourceIds: number[]; confidence: number }> {
  const out: Array<{ value: unknown; sourceIds: number[]; confidence: number }> = [];
  for (const r of rows) {
    if (!r.verified) continue;
    if (r.key === singular) {
      out.push({ value: r.value, sourceIds: r.sourceId ? [r.sourceId] : [], confidence: r.confidence });
    } else if (r.key === plural && Array.isArray(r.value)) {
      for (const item of r.value) {
        out.push({ value: item, sourceIds: r.sourceId ? [r.sourceId] : [], confidence: r.confidence });
      }
    }
  }
  return out;
}

/**
 * Build the frozen snapshot for one business. Pure read: it never writes DB state,
 * so it is safe to call from the brief stage, the build stage and QA alike.
 */
export async function buildSnapshot(businessId: string): Promise<BuildSnapshot> {
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error(`business not found: ${businessId}`);
  const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, biz.campaignId));

  const factRows = await db.select().from(schema.businessFacts)
    .where(eq(schema.businessFacts.businessId, businessId));
  const contactRows = await db.select().from(schema.businessContacts)
    .where(eq(schema.businessContacts.businessId, businessId));
  const assetRows = await db.select().from(schema.assets)
    .where(eq(schema.assets.businessId, businessId));
  const sourceRows = await db.select().from(schema.businessSources)
    .where(eq(schema.businessSources.businessId, businessId));
  const [audit] = await db.select().from(schema.websiteAudits)
    .where(eq(schema.websiteAudits.businessId, businessId))
    .orderBy(desc(schema.websiteAudits.auditedAt)).limit(1);
  const gapRows = await db.select().from(schema.productionGaps)
    .where(and(eq(schema.productionGaps.businessId, businessId), eq(schema.productionGaps.resolved, false)));

  const facts = factRows.map((f) => ({
    key: f.key,
    value: f.value,
    sourceId: f.sourceId,
    confidence: f.confidence,
    verified: f.verified,
  }));

  const socials: Record<string, string> = {};
  for (const f of facts) {
    if (f.key.startsWith('social.')) {
      const v = asString(f.value);
      if (v) socials[f.key.slice('social.'.length)] = v;
    }
  }

  const identity = facts.find((f) => f.key === 'identity.description');
  const hours = facts.find((f) => f.key === 'hours' || f.key === 'opening_hours');

  const services = explodeFacts(facts, 'service', 'services')
    .map((s) => {
      const v = s.value as Record<string, unknown> | string;
      const obj = typeof v === 'string' ? { name: v } : v;
      return {
        value: {
          name: String((obj as Record<string, unknown>).name ?? ''),
          price: ((obj as Record<string, unknown>).price as string | null | undefined) ?? null,
          description: ((obj as Record<string, unknown>).description as string | null | undefined) ?? null,
        },
        sourceIds: s.sourceIds,
        confidence: s.confidence,
      };
    })
    .filter((s) => s.value.name.length > 0);

  const reviews = explodeFacts(facts, 'review_excerpt', 'reviews')
    .map((r) => {
      const v = r.value as Record<string, unknown> | string;
      const obj = typeof v === 'string' ? { text: v } : v;
      return {
        value: {
          text: String((obj as Record<string, unknown>).text ?? ''),
          rating: ((obj as Record<string, unknown>).rating as number | null | undefined) ?? null,
          author: ((obj as Record<string, unknown>).author as string | null | undefined) ?? null,
        },
        sourceIds: r.sourceIds,
        confidence: r.confidence,
      };
    })
    .filter((r) => r.value.text.length > 0);

  const consumedKeys = new Set([
    'identity.description', 'hours', 'opening_hours', 'service', 'services',
    'review_excerpt', 'reviews',
  ]);
  const otherFacts = facts
    // `brand.*` has its own section; leaving it in otherFacts too would put the
    // same palette in front of the art director twice, in two shapes.
    .filter((f) => f.verified && !consumedKeys.has(f.key) && !f.key.startsWith('social.')
      && !f.key.startsWith('brand.'))
    .map((f) => ({
      key: f.key,
      value: f.value,
      sourceIds: f.sourceId ? [f.sourceId] : [],
      confidence: f.confidence,
    }));

  // Contacts: the rows are authoritative. `businesses.phone` came from gosom and
  // is folded in only when no contact row already carries it (dedup by digits).
  //
  // `verified` means "we have evidence for this string", NOT "this string is a
  // usable contact". Scraping produces artifacts that pass verification and are
  // still unusable — e.g. `instagram.com/_u`, Google's own redirector, a `tel:`
  // with four digits. Putting one of those on a demo is a broken link in front of
  // a business owner, so they are dropped here rather than shown.
  const contacts: SnapshotContact[] = contactRows
    .filter((c) => {
      const reason = unusableContactReason(c.channel, c.value);
      if (reason) {
        log.warn('contact dropped from build snapshot', {
          businessId, channel: c.channel, value: c.value, reason,
        });
      }
      return reason === null;
    })
    .map((c) => ({
      channel: c.channel,
      value: c.value,
      verified: c.verified,
      sourceIds: c.sourceId ? [c.sourceId] : [],
    }));
  const digits = (s: string) => s.replace(/\D/g, '');
  if (biz.phone && !contacts.some((c) => digits(c.value) && digits(c.value) === digits(biz.phone!))) {
    contacts.push({ channel: 'phone', value: biz.phone, verified: false, sourceIds: [] });
  }

  const language = campaign?.language ?? 'en';

  return {
    snapshotVersion: 1,
    capturedAt: new Date().toISOString(),
    businessId,
    campaignId: biz.campaignId,
    name: biz.name,
    category: biz.category,
    address: biz.address,
    city: campaign?.city ?? null,
    language,
    languageName: LANGUAGE_NAMES[language] ?? language,
    description: identity && asString(identity.value)
      ? { value: asString(identity.value)!, sourceIds: identity.sourceId ? [identity.sourceId] : [], confidence: identity.confidence }
      : null,
    hours: hours ? { value: hours.value, sourceIds: hours.sourceId ? [hours.sourceId] : [], confidence: hours.confidence } : null,
    rating: biz.rating,
    reviewCount: biz.reviewCount,
    services,
    reviews,
    socials,
    contacts,
    otherFacts,
    brand: brandFromFacts(facts, assetRows),
    assets: assetRows.map((a) => ({
      file: `${a.aiGenerated ? 'generated' : 'assets'}/${a.objectKey.split('/').pop()}`,
      objectKey: a.objectKey,
      kind: a.intendedUsage,
      width: a.width,
      height: a.height,
      contentType: a.contentType,
      aiGenerated: a.aiGenerated,
      generator: a.generator,
      sourceUrl: a.sourceUrl,
    })),
    website: {
      url: biz.websiteUrl,
      verdict: audit?.verdict ?? 'none',
      meaningfulContent: audit?.meaningfulContent ?? null,
      notes: audit?.notes ?? null,
    },
    openGaps: gapRows.map((g) => g.gap),
    openGapsUk: gapRows.map((g) => g.gapUk ?? null),
    sources: sourceRows.map((s) => ({
      id: s.id,
      type: s.sourceType,
      url: s.url,
      capturedAt: s.capturedAt.toISOString(),
      method: s.method,
    })),
  };
}

/**
 * Assembles the `brand` section from the `brand.*` facts written by
 * `src/enrichment/brandIdentity.ts`.
 *
 * Pure and total: a business with no brand facts gets a fully-null section with
 * `paletteSource: 'none'`, which is the honest input for stage 9 rather than an
 * absent key the prompt would have to guess about. Nothing is derived here —
 * every value was measured at enrichment time and is copied through with its
 * source id, so the snapshot stays a frozen reading of the evidence.
 */
export function brandFromFacts(
  facts: Array<{ key: string; value: unknown; sourceId: number | null; confidence: number; verified: boolean }>,
  assets: Array<{
    objectKey: string; intendedUsage: string; width: number | null; height: number | null;
    contentType: string | null; aiGenerated: boolean; sourceUrl: string; sourceType: string;
    generationMeta?: unknown;
  }> = [],
): SnapshotBrand {
  const brand: SnapshotBrand = {
    paletteSource: 'none',
    primary: null, accent: null,
    logoColors: null, avatarColors: null, siteColors: null, photoColors: null,
    logo: null,
    fontsSeen: null, voice: null,
  };

  // The mark itself, chosen the same way the palette chooses its evidence: the
  // best real logo, never a generated one. `logoHunt` has already ranked these
  // and stored at most two, so "the first real logo asset" is the winner rather
  // than an arbitrary row — the situation that used to hand The Parlor a coin
  // flip between its own mark and L'Oreal's.
  const logoAsset = assets.find((a) => a.intendedUsage === 'logo' && !a.aiGenerated);
  if (logoAsset) {
    const meta = logoAsset.generationMeta && typeof logoAsset.generationMeta === 'object'
      ? logoAsset.generationMeta as Record<string, unknown>
      : null;
    brand.logo = {
      file: `assets/${logoAsset.objectKey.split('/').pop()}`,
      width: logoAsset.width,
      height: logoAsset.height,
      vector: (logoAsset.contentType ?? '').includes('svg'),
      origin: typeof meta?.origin === 'string' ? meta.origin : logoAsset.sourceType,
      sourceUrl: logoAsset.sourceUrl,
    };
  }
  const get = (key: string) => facts.find((f) => f.key === key && f.verified);
  const obj = (f: ReturnType<typeof get>): Record<string, unknown> | null =>
    f && f.value && typeof f.value === 'object' && !Array.isArray(f.value)
      ? f.value as Record<string, unknown>
      : null;
  const ids = (f: ReturnType<typeof get>): number[] => (f?.sourceId ? [f.sourceId] : []);

  const primaryFact = get('brand.palette_primary');
  const primary = obj(primaryFact);
  if (primary && typeof primary.hex === 'string') {
    brand.primary = { hex: primary.hex, from: String(primary.from ?? ''), sourceIds: ids(primaryFact) };
    const src = primary.paletteSource;
    if (src === 'logo' || src === 'avatar' || src === 'site' || src === 'photos') brand.paletteSource = src;
  }

  const accentFact = get('brand.palette_accent');
  const accent = obj(accentFact);
  if (accent && typeof accent.hex === 'string') {
    brand.accent = {
      hex: accent.hex,
      from: String(accent.from ?? ''),
      sourceIds: ids(accentFact),
      onLight: typeof accent.onLight === 'string' ? accent.onLight : null,
      onDark: typeof accent.onDark === 'string' ? accent.onDark : null,
    };
  }

  const palette = (key: string): BrandPalette | null => {
    const f = get(key);
    const v = obj(f);
    if (!v || !Array.isArray(v.colors) || v.colors.length === 0) return null;
    return {
      from: String(v.from ?? ''),
      sourceIds: ids(f),
      colors: v.colors as BrandPalette['colors'],
    };
  };
  brand.logoColors = palette('brand.logo_colors');
  brand.avatarColors = palette('brand.avatar_colors');
  brand.siteColors = palette('brand.site_colors');
  brand.photoColors = palette('brand.photo_colors');

  const fontsFact = get('brand.fonts_seen');
  const fonts = obj(fontsFact);
  if (fonts && Array.isArray(fonts.fonts) && fonts.fonts.length) {
    brand.fontsSeen = { fonts: fonts.fonts.map(String), sourceIds: ids(fontsFact) };
  }

  const voiceFact = get('brand.voice');
  const voice = obj(voiceFact);
  if (voice && typeof voice.tone === 'string') {
    brand.voice = {
      tone: voice.tone,
      formality: String(voice.formality ?? 'neutral'),
      selfDescribedAs: Array.isArray(voice.selfDescribedAs) ? voice.selfDescribedAs.map(String) : [],
      statedBrandElements: Array.isArray(voice.statedBrandElements) ? voice.statedBrandElements.map(String) : [],
      sourceIds: ids(voiceFact),
    };
  }

  return brand;
}

/** The contact the CTA should use, in the order a Greek salon customer would expect. */
export function primaryContact(snapshot: BuildSnapshot): SnapshotContact | null {
  const order = ['phone', 'whatsapp', 'viber', 'email', 'instagram', 'facebook'];
  const verified = snapshot.contacts.filter((c) => c.verified);
  const pool = verified.length > 0 ? verified : snapshot.contacts;
  for (const channel of order) {
    const hit = pool.find((c) => c.channel === channel);
    if (hit) return hit;
  }
  return pool[0] ?? null;
}

/** Real (non-AI) photography, largest first — hero candidates. */
export function realPhotos(snapshot: BuildSnapshot): SnapshotAsset[] {
  return snapshot.assets
    .filter((a) => !a.aiGenerated && a.kind !== 'hero_clip' && (a.contentType ?? '').startsWith('image/'))
    .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
}
