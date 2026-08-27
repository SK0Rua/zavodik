/**
 * Campaign flow controls — HOW FAR the factory advances a business on its own,
 * and WHICH candidates a campaign keeps at all. Pure decision logic, deliberately
 * free of DB and queue imports so both the worker side (`router.ts`,
 * `fastQualify.ts`) and the UI (`ui/lib/campaignFlow.ts` re-exports it) reach the
 * same verdict from the same code — exactly like `buildPolicy.ts`.
 *
 * Two orthogonal knobs, set per campaign:
 *
 *   auto_stage      — the stop-point ladder. Roman's workflow (2026-08-27):
 *                     "запускаю на 50 сайтів з фільтром «лише без сайту», ставлю
 *                     «не заповнювати дані», спершу переглядаю список — сам оцінюю
 *                     які перспективні — і даю команду по підготовці до демо."
 *                       discover — collect + fast-qualify only, then STOP. A
 *                                  reviewable list; no photos, facts or audits.
 *                       enrich   — go through enrichment + audit + scoring +
 *                                  readiness, STOP at production_ready (no build).
 *                       build    — full auto; WHO gets built is then decided by
 *                                  `auto_build` (buildPolicy.ts) on top.
 *
 *   discovery_filter — cheap deterministic keep/drop rules applied at stage 3
 *                     (fast-qualify), BEFORE any data is collected. So a "лише
 *                     без сайту" run never spends enrichment on a business that
 *                     already has its own site.
 *
 * Neither knob moves a business between statuses. A blocked auto-advance simply
 * leaves the business resting where it is (prequalified, or production_ready),
 * which is a normal waiting state, not a stall — Roman resumes it with a button.
 */

// ─── auto_stage: the stop-point ladder ───────────────────────────────────────

export const AUTO_STAGES = ['discover', 'enrich', 'build'] as const;
export type AutoStage = typeof AUTO_STAGES[number];

/** Default = the pre-2026-08-27 behaviour: run all the way to the build gate. */
export const DEFAULT_AUTO_STAGE: AutoStage = 'build';

export function normalizeAutoStage(value: string | null | undefined): AutoStage {
  return (AUTO_STAGES as readonly string[]).includes(value ?? '')
    ? (value as AutoStage)
    : DEFAULT_AUTO_STAGE;
}

/**
 * May the router auto-advance this business INTO the given next job, under the
 * campaign's stop-point?
 *
 * The ladder is enforced at exactly two transitions, because those two jobs are
 * the doors to the two expensive phases:
 *   - `enrich` is the first data-collection job (it fans out to assets + audit +
 *     scoring). Blocking it under `discover` freezes the whole "fill data" phase.
 *   - `content-and-design` is the build. Blocking it under anything below `build`
 *     freezes the build phase; `auto_build` then decides WHO, on top of this.
 *
 * Every other transition (fast-qualify itself, readiness-gate, request-approval,
 * send-outreach) is always allowed — those are not the phases Roman is gating,
 * and approval/outreach already have their own gates.
 */
export function autoStageAllows(stage: AutoStage, nextJob: string): boolean {
  if (nextJob === 'enrich') return stage === 'enrich' || stage === 'build';
  if (nextJob === 'content-and-design') return stage === 'build';
  return true;
}

// ─── discovery_filter: cheap keep/drop at stage 3 ────────────────────────────

export interface DiscoveryFilter {
  /** Keep only businesses with no owned website (domain is null). */
  websiteNone: boolean;
  /** Drop businesses rated below this, when they have enough reviews to trust it. Null = off. */
  minRating: number | null;
  /** Drop businesses with fewer reviews than this. Null = off. */
  minReviews: number | null;
  /** Drop businesses with no phone and no other reachable contact. */
  requireContact: boolean;
}

export const DEFAULT_DISCOVERY_FILTER: DiscoveryFilter = {
  websiteNone: false,
  minRating: null,
  minReviews: null,
  requireContact: false,
};

/** Is every field of a discovery filter at its default (i.e. the filter is a no-op)? */
export function discoveryFilterIsEmpty(f: DiscoveryFilter): boolean {
  return !f.websiteNone && f.minRating === null && f.minReviews === null && !f.requireContact;
}

function toPosNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Coerce whatever is stored in `campaigns.discovery_filter` (jsonb, possibly from
 * an older row or a hand-edited form) into a valid, fully-populated filter. A
 * missing column reads as the empty (no-op) filter, so old campaigns keep their
 * exact previous behaviour.
 */
export function normalizeDiscoveryFilter(raw: unknown): DiscoveryFilter {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    websiteNone: r.websiteNone === true || r.websiteNone === 'true' || r.websiteNone === 'on',
    minRating: toPosNumberOrNull(r.minRating),
    minReviews: toPosNumberOrNull(r.minReviews),
    requireContact: r.requireContact === true || r.requireContact === 'true' || r.requireContact === 'on',
  };
}

export interface DiscoveryFilterSignals {
  /** True when the business has an owned domain (not a social/booking profile). */
  hasOwnSite: boolean;
  hasContact: boolean;
  rating: number | null;
  reviewCount: number | null;
}

/**
 * Reasons this candidate is dropped by the campaign's discovery filter, or an
 * empty array when it passes. These are HARD rejects (the operator asked to see
 * only a subset), reported with a stable token so the UI can explain the drop —
 * e.g. `filter:has_own_site`, `filter:below_min_rating:3.5`.
 *
 * The rating rule mirrors fast-qualify's own caution: a low rating is only
 * trusted once there are enough reviews behind it (≥3), so a brand-new place
 * with one 2★ review is not thrown away on a single opinion.
 */
export function discoveryFilterReasons(
  filter: DiscoveryFilter,
  s: DiscoveryFilterSignals,
): string[] {
  const reasons: string[] = [];
  if (filter.websiteNone && s.hasOwnSite) reasons.push('filter:has_own_site');
  if (filter.requireContact && !s.hasContact) reasons.push('filter:no_contact');
  if (filter.minReviews !== null && (s.reviewCount ?? 0) < filter.minReviews) {
    reasons.push(`filter:below_min_reviews:${filter.minReviews}`);
  }
  if (
    filter.minRating !== null
    && s.rating !== null
    && s.rating < filter.minRating
    && (s.reviewCount ?? 0) >= 3
  ) {
    reasons.push(`filter:below_min_rating:${filter.minRating}`);
  }
  return reasons;
}
