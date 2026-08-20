/**
 * `enrich-socials` — the social discovery step, and NOTHING else.
 *
 * WHY IT EXISTS AS ITS OWN JOB. Social discovery already runs inside `enrich`
 * (stage 4), but by then most of the Patras businesses had moved on:
 * production_ready, site_in_progress, deployed. Re-running `enrich` for them is
 * not an option — it deletes and rebuilds every fact and would trip the
 * ENRICHABLE guard anyway. Until now the only way to fill the gap was
 * `scripts/enrich-socials.ts` from a terminal, and Roman's rule is that an
 * operator action is a UI button, not a script.
 *
 * WHAT IT DOES NOT DO — deliberately:
 *   - no status transition. A business keeps whatever status it had; this job
 *     adds sources and contacts, so there is nothing for the state machine to
 *     decide.
 *   - no fact deletion. `enrich` clears `business_facts` before rebuilding
 *     them; this must never do that, because the demo currently being built may
 *     be reading them.
 *   - no agent call. Search + capture + deterministic scoring, so it does not
 *     consume the subscription window and is not in AGENT_JOBS.
 *
 * It is Playwright-bound, which is why it lives in the `enrich` group: those
 * containers already have the browser and already do page captures.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { JobPayload } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';
import { config } from '../config.js';
import { discoverSocials, existingSocialPlatforms } from '../enrichment/socialDiscovery.js';
import { extractBrandIdentity } from '../enrichment/brandIdentity.js';

export async function enrichSocialsHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error(`business not found: ${businessId}`);

  if (!config.socialDiscovery.enabled) {
    log.warn('enrich-socials skipped: SOCIAL_DISCOVERY=false', { businessId });
    return;
  }

  // Already has both? Searching again would spend minutes of SERP requests to
  // rediscover what is already evidenced. Skipping is the honest answer, and
  // the UI says so rather than pretending work happened.
  const alreadyHave = await existingSocialPlatforms(businessId);
  if (alreadyHave.includes('instagram') && alreadyHave.includes('facebook')) {
    log.info('enrich-socials skipped: verified socials already present', { businessId, alreadyHave });
    return;
  }

  const [campaign] = await db.select().from(schema.campaigns)
    .where(eq(schema.campaigns.id, biz.campaignId));

  const result = await discoverSocials({
    id: businessId,
    name: biz.name,
    city: campaign?.city ?? '',
    phone: biz.phone,
    normalizedPhone: biz.normalizedPhone,
    address: biz.address,
    domain: biz.domain,
    websiteUrl: biz.websiteUrl,
    category: biz.category,
  }, { skipPlatforms: alreadyHave });

  // The gap is a fact about the business ("we searched and could not confirm a
  // profile"), so it is opened at most once and closed the moment socials are
  // found — same bookkeeping the script does, so repeated runs converge.
  if (result.gap) {
    const open = await db.select().from(schema.productionGaps).where(and(
      eq(schema.productionGaps.businessId, businessId),
      eq(schema.productionGaps.gap, result.gap),
      eq(schema.productionGaps.resolved, false),
    ));
    if (open.length === 0) {
      await db.insert(schema.productionGaps).values({
        businessId, gap: result.gap, blockerLevel: 'soft',
      });
    }
  } else {
    await db.update(schema.productionGaps).set({ resolved: true }).where(and(
      eq(schema.productionGaps.businessId, businessId),
      eq(schema.productionGaps.gap, 'socials_unresolved'),
      eq(schema.productionGaps.resolved, false),
    ));
  }

  // ── Brand identity, from the profiles this job just captured ────────────
  //
  // The cheapest place to refresh it: an Instagram/Facebook profile page is
  // exactly where a social-only business keeps its avatar (its de-facto logo)
  // and its bio, and this job has just stored both as immutable evidence. For
  // the Patras beauty businesses — most of which have no website at all —
  // this is the ONLY route to a real brand palette.
  //
  // Non-fatal, like everything else in this job.
  try {
    const brand = await extractBrandIdentity(businessId);
    log.info('brand identity refreshed from socials', {
      businessId,
      paletteSource: brand.paletteSource,
      primary: brand.primary?.hex ?? null,
      accent: brand.accent?.hex ?? null,
      voice: brand.voice?.tone ?? null,
      gap: brand.gap,
    });
    if (brand.notes.length) log.warn('brand identity notes', { businessId, notes: brand.notes.slice(0, 6) });
  } catch (err) {
    log.warn('brand identity refresh failed', { businessId, err: String(err).slice(0, 200) });
  }

  log.info('enrich-socials done', {
    businessId,
    serpsCaptured: result.serpsCaptured,
    serpsFailed: result.serpsFailed,
    candidates: result.candidates.length,
    profilesRead: result.profiles.length,
    strong: result.profiles.filter((p) => p.verdict.strength === 'strong').length,
    medium: result.profiles.filter((p) => p.verdict.strength === 'medium').length,
    contactsWritten: result.contactsWritten.length,
    gap: result.gap,
  });
  if (result.notes.length) {
    log.warn('enrich-socials notes', { businessId, notes: result.notes.slice(0, 8) });
  }
}
