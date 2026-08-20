/**
 * Mining the gosom CSV evidence (spec §4 stage 4).
 *
 * The discovery CSV is already immutable evidence in object storage, and it is
 * far richer than the columns discovery mapped into `businesses`: hours, the
 * Google "about" attribute groups, up to ~10 user reviews per place, photo URLs,
 * a thumbnail, the owner profile and the structured address.
 *
 * Mining it is DETERMINISTIC — no model is involved, so these facts carry
 * `extraction_method='deterministic'` and the highest confidence we have. The
 * agent later only sees text we captured; it never sees this parser's output as
 * something it may rewrite.
 */
import { parseCsv } from '../workers/discovery.js';

export interface GosomOpeningHours {
  /** Raw per-day strings exactly as Google rendered them (locale of the scrape). */
  byDay: Record<string, string[]>;
}

export interface GosomReview {
  name: string | null;
  rating: number | null;
  text: string;
  images: string[];
  when: string | null;
}

export interface GosomAboutOption {
  group: string;
  name: string;
  enabled: boolean;
  values?: string[];
}

export interface GosomImage {
  title: string | null;
  url: string;
}

export interface GosomAddress {
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
}

/** One fully mined CSV row. Everything here is verbatim from the evidence file. */
export interface GosomRecord {
  title: string;
  link: string | null;
  category: string | null;
  address: string | null;
  completeAddress: GosomAddress | null;
  phone: string | null;
  website: string | null;
  emails: string[];
  rating: number | null;
  reviewCount: number | null;
  reviewsPerRating: Record<string, number> | null;
  hours: GosomOpeningHours | null;
  about: GosomAboutOption[];
  reviews: GosomReview[];
  images: GosomImage[];
  thumbnail: string | null;
  owner: { name: string | null; link: string | null } | null;
  priceRange: string | null;
  descriptions: string | null;
  placeId: string | null;
  cid: string | null;
  menuLink: string | null;
  orderOnline: string | null;
  reservations: string | null;
  status: string | null;
  latitude: number | null;
  longitude: number | null;
  plusCode: string | null;
  timezone: string | null;
  streetViewUrl: string | null;
}

function txt(v: string | undefined): string | null {
  const t = v?.trim();
  return t && t !== 'null' ? t : null;
}

function num(v: string | undefined): number | null {
  const t = txt(v);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** gosom writes JSON blobs into CSV cells; a malformed cell must never kill a run. */
function json<T>(v: string | undefined, fallback: T): T {
  const t = txt(v);
  if (t === null || t === '[]' || t === '{}') return fallback;
  try {
    const parsed = JSON.parse(t);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

function parseHours(v: string | undefined): GosomOpeningHours | null {
  const raw = json<Record<string, unknown>>(v, {});
  const byDay: Record<string, string[]> = {};
  for (const [day, val] of Object.entries(raw)) {
    if (Array.isArray(val)) byDay[day] = val.map((x) => String(x));
    else if (typeof val === 'string') byDay[day] = [val];
  }
  return Object.keys(byDay).length ? { byDay } : null;
}

function parseAbout(v: string | undefined): GosomAboutOption[] {
  const raw = json<Array<{ name?: string; id?: string; options?: Array<{ name?: string; enabled?: boolean; values?: string[] }> }>>(v, []);
  const out: GosomAboutOption[] = [];
  for (const group of raw) {
    const groupName = group?.name ?? group?.id ?? 'other';
    for (const opt of group?.options ?? []) {
      if (!opt?.name) continue;
      out.push({
        group: groupName,
        name: opt.name,
        enabled: opt.enabled === true,
        ...(opt.values?.length ? { values: opt.values } : {}),
      });
    }
  }
  return out;
}

function parseReviews(v: string | undefined): GosomReview[] {
  const raw = json<Array<{ Name?: string; Rating?: number; Description?: string; Images?: string[]; When?: string }>>(v, []);
  const out: GosomReview[] = [];
  for (const r of raw) {
    const text = (r?.Description ?? '').trim();
    if (!text) continue; // a star-only rating carries no usable content
    out.push({
      name: r?.Name?.trim() || null,
      rating: typeof r?.Rating === 'number' ? r.Rating : null,
      text,
      images: Array.isArray(r?.Images) ? r.Images.filter((i) => typeof i === 'string') : [],
      when: r?.When?.trim() || null,
    });
  }
  return out;
}

function parseImages(v: string | undefined): GosomImage[] {
  const raw = json<Array<{ title?: string; image?: string }>>(v, []);
  return raw
    .filter((i) => typeof i?.image === 'string' && i.image.startsWith('http'))
    // Street View panoramas are Google's road imagery, not the business's own
    // photography — they must never end up in a demo as "their" picture.
    .filter((i) => !/streetviewpixels|\/streetview/i.test(i.image as string))
    .map((i) => ({ title: i.title?.trim() || null, url: i.image as string }));
}

function parseAddress(v: string | undefined): GosomAddress | null {
  const raw = json<Record<string, string>>(v, {});
  if (!Object.keys(raw).length) return null;
  const pick = (k: string) => (raw[k]?.trim() ? raw[k].trim() : null);
  return { street: pick('street'), city: pick('city'), postalCode: pick('postal_code'), country: pick('country') };
}

/**
 * Parses the whole evidence CSV. Columns are resolved by header NAME (a gosom
 * release reordering the CSV can therefore not silently shift data).
 */
export function parseGosomCsv(csv: string): GosomRecord[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => {
    const i = header.indexOf(name);
    return i === -1 ? undefined : i;
  };
  const at = (row: string[], name: string) => {
    const i = col(name);
    return i === undefined ? undefined : row[i];
  };

  const out: GosomRecord[] = [];
  for (const row of rows.slice(1)) {
    const title = txt(at(row, 'title'));
    if (!title) continue;
    const ownerRaw = json<{ name?: string; link?: string }>(at(row, 'owner'), {});
    const menuRaw = json<{ link?: string; source?: string }>(at(row, 'menu'), {});
    out.push({
      title,
      link: txt(at(row, 'link')),
      category: txt(at(row, 'category')),
      address: txt(at(row, 'address')),
      completeAddress: parseAddress(at(row, 'complete_address')),
      phone: txt(at(row, 'phone')),
      website: txt(at(row, 'website')),
      emails: (txt(at(row, 'emails')) ?? '').split(/[,;]/).map((e) => e.trim()).filter((e) => e.includes('@')),
      rating: num(at(row, 'review_rating')),
      reviewCount: num(at(row, 'review_count')),
      reviewsPerRating: (() => {
        const r = json<Record<string, number>>(at(row, 'reviews_per_rating'), {});
        return Object.keys(r).length ? r : null;
      })(),
      hours: parseHours(at(row, 'open_hours')),
      about: parseAbout(at(row, 'about')),
      reviews: parseReviews(at(row, 'user_reviews')),
      images: parseImages(at(row, 'images')),
      thumbnail: txt(at(row, 'thumbnail')),
      owner: ownerRaw?.name ? { name: ownerRaw.name, link: ownerRaw.link ?? null } : null,
      priceRange: txt(at(row, 'price_range')),
      descriptions: txt(at(row, 'descriptions')),
      placeId: txt(at(row, 'place_id')),
      cid: txt(at(row, 'cid')),
      menuLink: menuRaw?.link?.trim() || null,
      orderOnline: txt(at(row, 'order_online')),
      reservations: txt(at(row, 'reservations')),
      status: txt(at(row, 'status')),
      latitude: num(at(row, 'latitude')),
      longitude: num(at(row, 'longitude')),
      plusCode: txt(at(row, 'plus_code')),
      timezone: txt(at(row, 'timezone')),
      streetViewUrl: txt(at(row, 'street_view_url')),
    });
  }
  return out;
}

/**
 * Finds the record belonging to a business. place_id/cid are the stable keys;
 * the maps link and a phone match are fallbacks for older evidence files.
 */
export function findRecord(
  records: GosomRecord[],
  biz: { placeId: string | null; listingUrl: string | null; normalizedPhone: string | null; name: string },
): GosomRecord | null {
  const digits = (s: string | null) => (s ?? '').replace(/[^\d]/g, '');
  const byId = records.find((r) => biz.placeId && (r.placeId === biz.placeId || r.cid === biz.placeId));
  if (byId) return byId;
  const byLink = records.find((r) => biz.listingUrl && r.link === biz.listingUrl);
  if (byLink) return byLink;
  const bizPhone = digits(biz.normalizedPhone);
  const byPhone = bizPhone ? records.find((r) => digits(r.phone) === bizPhone) : undefined;
  if (byPhone) return byPhone;
  return records.find((r) => r.title.trim() === biz.name.trim()) ?? null;
}

/** Compact, human-readable rendering of a record for an agent prompt. */
export function renderRecordForPrompt(rec: GosomRecord, opts: { maxReviews?: number } = {}): string {
  const maxReviews = opts.maxReviews ?? 10;
  const lines: string[] = [];
  lines.push(`Google Maps listing: ${rec.title}`);
  if (rec.category) lines.push(`Category (Google): ${rec.category}`);
  if (rec.address) lines.push(`Address: ${rec.address}`);
  if (rec.phone) lines.push(`Phone: ${rec.phone}`);
  if (rec.website) lines.push(`Website field: ${rec.website}`);
  if (rec.emails.length) lines.push(`Emails found by crawler: ${rec.emails.join(', ')}`);
  if (rec.rating != null) lines.push(`Rating: ${rec.rating} (${rec.reviewCount ?? '?'} reviews)`);
  if (rec.priceRange) lines.push(`Price range: ${rec.priceRange}`);
  if (rec.descriptions) lines.push(`Google description: ${rec.descriptions}`);
  if (rec.owner?.name) lines.push(`Owner profile name: ${rec.owner.name}`);

  if (rec.hours) {
    lines.push('\nOpening hours (verbatim from Google):');
    for (const [day, slots] of Object.entries(rec.hours.byDay)) lines.push(`  ${day}: ${slots.join(', ')}`);
  }
  if (rec.about.length) {
    lines.push('\nGoogle attributes ("about"):');
    for (const a of rec.about) {
      lines.push(`  [${a.group}] ${a.name}: ${a.enabled ? 'yes' : 'no'}${a.values?.length ? ` (${a.values.join(', ')})` : ''}`);
    }
  }
  if (rec.reviews.length) {
    lines.push(`\nCustomer reviews (${rec.reviews.length} captured, showing ${Math.min(maxReviews, rec.reviews.length)}):`);
    for (const r of rec.reviews.slice(0, maxReviews)) {
      lines.push(`  --- ${r.name ?? 'anonymous'} | rating ${r.rating ?? '?'}${r.when ? ` | ${r.when}` : ''}\n  ${r.text.replace(/\s+/g, ' ').slice(0, 900)}`);
    }
  }
  if (rec.images.length) {
    lines.push(`\nPhoto categories on the listing: ${rec.images.map((i) => i.title ?? 'untitled').join(', ')}`);
  }
  return lines.join('\n');
}
