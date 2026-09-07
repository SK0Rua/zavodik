/**
 * Adding a business Roman found on the map himself.
 *
 * He pastes a Google Maps link; this turns it into the same `RawCandidate`
 * discovery produces and hands it to `NormalizationService`. Reusing that path
 * is the whole point: dedup against everything already in the funnel, the
 * immutable raw evidence, the `business_sources` row and the fast-qualify
 * hand-off all come for free and cannot drift from the automatic pipeline.
 *
 * The link alone is NOT enough to create a business. A name typed into a URL
 * is not evidence, and the project's rule is that every fact traces to a
 * source. So the link is only used to work out WHAT to ask gosom — the one
 * component allowed to read Maps — and the business is built from gosom's
 * answer, exactly as an automatically discovered one is.
 *
 * A manual add deliberately SKIPS the campaign's discovery filter and the
 * chain/category rejects (Roman's decision 2026-09-07): he picked this
 * business on purpose, and a machine second-guessing that choice makes the
 * feature useless. The hard stops still apply — see `manualQualifyReasons`.
 */
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema.js';
import type { RawCandidate } from '../discovery/candidate.js';
import { normalizeName } from '../discovery/normalization.js';
import { parseMapsLink, MapsLinkError } from '../discovery/mapsLink.js';
import {
  createGosomJob, downloadGosomCsv, mapCsvToCandidates, waitForGosomJob,
  type GosomJobData,
} from '../workers/discovery.js';
import { putRaw } from '../lib/storage.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import type { NormalizationService } from './normalizationService.js';

type ManualDatabase = NodePgDatabase<typeof schema>;

/** Where manually added businesses live, one campaign per country. */
export const MANUAL_CAMPAIGN_PREFIX = 'manual';

export type AddByLinkResult =
  | { kind: 'created'; businessId: string; name: string; campaignId: string }
  | { kind: 'duplicate'; businessId: string; name: string; campaignId: string }
  | { kind: 'not_found'; message: string }
  | { kind: 'invalid'; message: string };

/**
 * The campaign manual finds go into.
 *
 * Separate from the real campaigns on purpose: those carry a niche, a
 * geofence, a discovery filter and a stop-point that describe an automated
 * search, none of which mean anything for a business Roman picked by hand. Its
 * own campaign also keeps the funnel numbers on the campaigns page honest.
 *
 * `auto_stage: 'discover'` is what makes the flow «додав → сам натиснув
 * "Зібрати дані"» rather than the factory running off with it.
 */
export async function ensureManualCampaign(
  db: ManualDatabase,
  input: { country: string; city: string; language: string },
): Promise<string> {
  const campaignId = `${MANUAL_CAMPAIGN_PREFIX}-${input.country.toLowerCase()}`;
  const [existing] = await db.select({ id: schema.campaigns.id })
    .from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
  if (existing) return campaignId;

  await db.insert(schema.campaigns).values({
    id: campaignId,
    country: input.country,
    city: input.city,
    niche: 'знайдені вручну',
    language: input.language,
    queries: [],
    geofence: { lat: 0, lng: 0, radiusKm: 0 },
    targetCount: 0,
    status: 'running',
    autoBuild: 'manual',
    autoStage: 'discover',
  }).onConflictDoNothing();

  log.info('manual campaign created', { campaignId });
  return campaignId;
}

/**
 * Hard stops that survive a manual add.
 *
 * Everything the automatic filter would reject for is dropped — chains,
 * off-target categories, the campaign's own keep/drop rules — because Roman
 * overrode all of that by choosing this business. What remains are the two
 * facts no operator intent can override: the place is gone, or contacting it
 * is forbidden.
 */
export function manualQualifyReasons(input: {
  businessStatus: string | null;
  blockedByDnc: boolean;
}): string[] {
  const reasons: string[] = [];
  if (input.blockedByDnc) reasons.push('do_not_contact');
  if (input.businessStatus
    && ['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY'].includes(input.businessStatus)) {
    reasons.push(`closed:${input.businessStatus.toLowerCase()}`);
  }
  return reasons;
}

/**
 * Which gosom result is the place Roman meant?
 *
 * A search for "Coffee Room" near a point returns the neighbours too. Exported
 * so the choice is testable without gosom: name match first, distance as the
 * tie-break, and nothing at all rather than a confident wrong guess.
 */
export function pickMatch(
  candidates: RawCandidate[],
  wanted: { name: string | null; lat: number | null; lng: number | null },
): RawCandidate | null {
  if (!candidates.length) return null;

  const haveAnchor = wanted.lat !== null && wanted.lng !== null;
  const distance = (c: RawCandidate): number => {
    if (!haveAnchor || c.lat === null || c.lng === null) return Number.POSITIVE_INFINITY;
    return Math.hypot(c.lat - wanted.lat!, c.lng - wanted.lng!);
  };

  // A name is not enough on its own. Chains and coincidences are everywhere:
  // searching "Coffeeman" near Sumy cheerfully returns the Coffeeman in
  // SINGAPORE, an exact name match 8000km away — observed on the very first
  // real link. When the pin is known, everything outside this radius is a
  // different business that happens to share a name, whatever it is called.
  const NAMED_RADIUS_DEG = 0.05;   // ~5km: generous for an imprecise pin
  const ANCHOR_RADIUS_DEG = 0.0015; // ~150m: all a nameless link can justify

  const nearEnough = (c: RawCandidate, limit: number): boolean => {
    if (!haveAnchor) return true;      // nothing to check against
    if (c.lat === null || c.lng === null) return false; // unplaceable, unverifiable
    return distance(c) <= limit;
  };

  if (wanted.name) {
    const target = normalizeName(wanted.name);
    const byDistance = (a: RawCandidate, b: RawCandidate) => distance(a) - distance(b);

    const exact = candidates
      .filter((c) => normalizeName(c.name) === target && nearEnough(c, NAMED_RADIUS_DEG));
    if (exact.length) return exact.sort(byDistance)[0]!;

    const partial = candidates.filter((c) => {
      const n = normalizeName(c.name);
      return (n.includes(target) || target.includes(n)) && nearEnough(c, NAMED_RADIUS_DEG);
    });
    if (partial.length) return partial.sort(byDistance)[0]!;

    // A name was asked for and nothing near the pin carries it. Falling back to
    // "closest result" here would add the neighbouring shop under the name
    // Roman typed, which is the one outcome worth failing for.
    return null;
  }

  // No name to go on: only the pin can decide, and only when a result sits
  // essentially on top of it.
  if (haveAnchor) {
    const nearest = [...candidates].sort((a, b) => distance(a) - distance(b))[0]!;
    if (nearEnough(nearest, ANCHOR_RADIUS_DEG)) return nearest;
  }
  return null;
}

export class ManualBusinessService {
  constructor(
    private readonly db: ManualDatabase,
    private readonly normalization: NormalizationService,
  ) {}

  /**
   * Look the place up through gosom and put it in the funnel.
   *
   * Synchronous by design: Roman pastes a link and expects an answer about
   * THAT link — «додав» or «не знайшов» — not a job id. The gosom probe is one
   * keyword at depth 1, which is seconds, not the minutes a campaign takes.
   */
  async addByLink(input: {
    url: string;
    country: string;
    city: string;
    language: string;
  }): Promise<AddByLinkResult> {
    let parsed;
    try {
      parsed = await parseMapsLink(input.url);
    } catch (err) {
      if (err instanceof MapsLinkError) return { kind: 'invalid', message: err.message };
      throw err;
    }

    const keyword = parsed.name ?? `${input.city}`;
    const jobData: GosomJobData = {
      keywords: [keyword],
      lang: input.language.slice(0, 2),
      zoom: config.gosom.zoom,
      lat: String(parsed.lat ?? 0),
      lon: String(parsed.lng ?? 0),
      fast_mode: false,
      // A tight radius around the pin: this is a lookup of one known place,
      // not a search of the area.
      radius: parsed.lat !== null ? 500 : config.gosom.radiusMeters,
      depth: 1,
      email: config.gosom.email,
      extra_reviews: false,
      max_time: config.gosom.maxTimeSeconds,
      proxies: config.gosom.proxies,
    };

    const gosomJobId = await createGosomJob(`manual-${Date.now()}`, jobData);
    log.info('manual lookup started', { gosomJobId, keyword, lat: parsed.lat, lng: parsed.lng });
    await waitForGosomJob(gosomJobId);
    const csv = await downloadGosomCsv(gosomJobId);

    // Evidence first, before any parsing — the same order discovery uses.
    const rawObjectKey = await putRaw(`manual/${gosomJobId}`, csv, 'text/csv');
    const candidates = mapCsvToCandidates(csv, `manual: ${parsed.url}`, rawObjectKey);
    const match = pickMatch(candidates, parsed);

    if (!match) {
      return {
        kind: 'not_found',
        message: parsed.name
          ? `Не знайшли «${parsed.name}» на цих координатах. `
            + 'Перевір, що посилання веде саме на картку бізнесу.'
          : 'За цим посиланням не вдалось однозначно визначити бізнес. '
            + 'Відкрий його картку на карті й скопіюй посилання звідти.',
      };
    }

    const campaignId = await ensureManualCampaign(this.db, input);
    // Keep the link Roman pasted as the source URL: it is what he will
    // recognise on the business card, and it is the evidence for this add.
    const result = await this.normalization.normalize(campaignId, {
      ...match,
      listingUrl: match.listingUrl || parsed.url,
    }, { operatorChosen: true });

    log.info('manual business added', {
      businessId: result.businessId, kind: result.kind, campaignId,
    });
    return {
      kind: result.kind === 'duplicate' ? 'duplicate' : 'created',
      businessId: result.businessId,
      name: match.name,
      campaignId,
    };
  }

  /** Is contacting this business forbidden? Mirrors fast-qualify's own check. */
  async isBlockedByDnc(businessId: string): Promise<boolean> {
    const [biz] = await this.db.select().from(schema.businesses)
      .where(eq(schema.businesses.id, businessId)).limit(1);
    if (!biz) return false;
    const contacts = await this.db.select().from(schema.businessContacts)
      .where(eq(schema.businessContacts.businessId, businessId));
    const dnc = await this.db.select().from(schema.doNotContact);
    return dnc.some((d) =>
      (d.matchType === 'phone' && d.value === biz.normalizedPhone)
      || (d.matchType === 'domain' && !!biz.domain && d.value === biz.domain)
      || (d.matchType === 'business_id' && d.value === biz.id)
      || (d.matchType === 'email' && contacts.some((c) => c.channel === 'email' && c.value === d.value)));
  }
}
