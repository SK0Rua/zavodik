/**
 * Stage 3 — fast qualification (spec §4).
 *
 * A cheap deterministic filter so expensive enrichment is not spent on
 * candidates that can never convert. No LLM: every verdict here is a rule with
 * a stored reason, so a rejection is always explainable in the UI.
 *
 * The three verdicts are `prequalified` / `needs_review` / `rejected`.
 * `needs_review` is used whenever a human could reasonably disagree — the
 * pipeline never silently discards a borderline lead.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import {
  businessTransitions,
  requireBusinessStatus,
} from '../orchestrator/statuses.js';
import { commitWorkflow, type JobPayload } from '../orchestrator/queue.js';
import { mayAutoAdvance } from '../orchestrator/autoAdvance.js';
import { manualQualifyReasons } from '../orchestrator/manualBusinessService.js';
import {
  type DiscoveryFilter, DEFAULT_DISCOVERY_FILTER,
  discoveryFilterReasons, normalizeDiscoveryFilter,
} from '../orchestrator/campaignFlow.js';
import { log } from '../lib/logger.js';

/**
 * Big chains/franchises: no local decision-maker to sell to. Matched on word
 * boundaries so "Hairway" does not match "Hair".
 */
const CHAIN_NAMES = [
  'hondos center', 'sephora', 'douglas', 'marinopoulos', 'the body shop',
  'yves rocher', 'notos galleries', 'attica', 'public', 'holland & barrett',
  'jysk', 'ikea', 'lidl', 'ab vasilopoulos', 'sklavenitis', 'my market',
  "l'oreal", 'wella', 'schwarzkopf',
];
const CHAIN_MARKERS = ['franchise', 'φραντσάιζ', 'αλυσίδα'];

/** Categories that are not our target even when a beauty query surfaced them. */
const OFF_TARGET_CATEGORIES = [
  'φαρμακείο', 'pharmacy', 'super market', 'σούπερ μάρκετ', 'supermarket',
  'νοσοκομείο', 'hospital', 'κλινική', 'clinic',
  'ξενοδοχείο', 'hotel', 'εστιατόριο', 'restaurant', 'καφετέρια', 'cafe',
  'γυμναστήριο', 'gym', 'σχολή', 'school', 'φροντιστήριο',
  'κατάστημα ρούχων', 'clothing store', 'κοσμηματοπωλείο', 'jewelry store',
];

/** Google's own signals that a place is gone. */
const CLOSED_STATUSES = ['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY'];

export interface FastQualifyDecision {
  verdict: 'prequalified' | 'needs_review' | 'rejected';
  reasons: string[];
}

/** Pure decision function so the rules are testable without a database. */
export function decideFastQualification(input: {
  name: string;
  category: string | null;
  businessStatus: string | null;
  normalizedPhone: string | null;
  hasContact: boolean;
  /** Has an owned domain (not a social/booking profile). Defaults to false. */
  hasOwnSite?: boolean;
  rating: number | null;
  reviewCount: number | null;
  blockedByDnc: boolean;
  /** Per-campaign keep/drop rules chosen by Roman at launch. Defaults to no-op. */
  filter?: DiscoveryFilter;
}): FastQualifyDecision {
  const reasons: string[] = [];
  let verdict: FastQualifyDecision['verdict'] = 'prequalified';
  /** Rejection is terminal and always wins over needs_review. */
  const reject = (reason: string) => { verdict = 'rejected'; reasons.push(reason); };
  const review = (reason: string) => { if (verdict !== 'rejected') verdict = 'needs_review'; reasons.push(reason); };

  if (input.blockedByDnc) reject('do_not_contact');

  // Campaign discovery filter: hard rejects the operator explicitly asked for
  // ("лише без сайту", min rating/reviews, must have a contact). These run
  // BEFORE data collection so a filtered-out lead never costs enrichment time.
  for (const r of discoveryFilterReasons(input.filter ?? DEFAULT_DISCOVERY_FILTER, {
    hasOwnSite: input.hasOwnSite ?? false,
    hasContact: input.hasContact || !!input.normalizedPhone,
    rating: input.rating,
    reviewCount: input.reviewCount,
  })) {
    reject(r);
  }

  if (input.businessStatus && CLOSED_STATUSES.includes(input.businessStatus)) {
    reject(`closed:${input.businessStatus.toLowerCase()}`);
  }

  const name = input.name.toLowerCase();
  const category = (input.category ?? '').toLowerCase();

  const chainHit = CHAIN_NAMES.find((c) => name.includes(c));
  if (chainHit) reject(`chain_or_franchise:${chainHit}`);
  const markerHit = CHAIN_MARKERS.find((m) => name.includes(m) || category.includes(m));
  if (markerHit) review(`possible_franchise_marker:${markerHit}`);

  const offTarget = OFF_TARGET_CATEGORIES.find((c) => category.includes(c));
  if (offTarget) reject(`non_target_category:${offTarget}`);

  // No phone AND no other contact means there is no way to reach them at all.
  if (!input.normalizedPhone && !input.hasContact) reject('no_phone_no_contact');
  else if (!input.normalizedPhone) review('no_phone');

  // A place with almost no reviews may be brand new or a ghost listing.
  if ((input.reviewCount ?? 0) < 3) review(`low_review_count:${input.reviewCount ?? 0}`);
  // Consistently poor ratings: a demo site will not fix the underlying problem.
  if (input.rating !== null && input.rating < 3.5 && (input.reviewCount ?? 0) >= 10) {
    review(`low_rating:${input.rating}`);
  }

  return { verdict, reasons };
}

export async function fastQualifyHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error(`business not found: ${businessId}`);
  const expectedStatus = requireBusinessStatus(biz.status, `business ${businessId}`);
  if (expectedStatus !== 'discovered') {
    log.info('fast qualification skipped: business already left discovery', {
      businessId,
      status: expectedStatus,
    });
    return;
  }

  const [campaign] = await db.select().from(schema.campaigns)
    .where(eq(schema.campaigns.id, biz.campaignId));
  const filter = normalizeDiscoveryFilter(campaign?.discoveryFilter);

  const contacts = await db.select().from(schema.businessContacts)
    .where(eq(schema.businessContacts.businessId, businessId));
  const dnc = await db.select().from(schema.doNotContact);
  const blockedByDnc = dnc.some((d) =>
    (d.matchType === 'phone' && d.value === biz.normalizedPhone)
    || (d.matchType === 'domain' && !!biz.domain && d.value === biz.domain)
    || (d.matchType === 'business_id' && d.value === biz.id)
    || (d.matchType === 'email' && contacts.some((c) => c.channel === 'email' && c.value === d.value)));

  // A business Roman added by hand from a Maps link has already been judged by
  // the person whose judgement this stage exists to approximate. Re-running the
  // taste filters on it — chain names, off-target categories, the campaign's
  // keep/drop rules — would let the machine overrule the operator and drop the
  // business he deliberately went and found. Only the two facts no intent can
  // override survive: the place is closed, or it must not be contacted.
  const operatorChosen = payload.operatorChosen === true;
  const { verdict, reasons } = operatorChosen
    ? (() => {
        const hard = manualQualifyReasons({
          businessStatus: biz.businessStatus,
          blockedByDnc,
        });
        return {
          verdict: (hard.length ? 'rejected' : 'prequalified') as FastQualifyDecision['verdict'],
          reasons: hard.length ? hard : ['added by operator from a map link'],
        };
      })()
    : decideFastQualification({
        name: biz.name,
        category: biz.category,
        businessStatus: biz.businessStatus,
        normalizedPhone: biz.normalizedPhone,
        hasContact: contacts.some((c) => c.channel !== 'website'),
        hasOwnSite: !!biz.domain,
        rating: biz.rating,
        reviewCount: biz.reviewCount,
        blockedByDnc,
        filter,
      });

  let committed = false;
  await commitWorkflow(async (tx) => {
    const [locked] = await tx.select({
      status: schema.businesses.status,
      campaignId: schema.businesses.campaignId,
    }).from(schema.businesses)
      .where(eq(schema.businesses.id, businessId))
      .limit(1)
      .for('update');
    if (!locked) throw new Error(`business not found: ${businessId}`);
    if (locked.status !== 'discovered') return [];

    await tx.insert(schema.qualifications).values({
      businessId, stage: 'fast', qualified: verdict === 'prequalified', reasons,
    });
    const transitioned = await businessTransitions.normalInTransaction(tx, {
      businessId,
      expectedStatus: 'discovered',
      to: verdict,
      actor: 'fast-qualify-worker',
      reason: reasons.join(',') || 'passed all fast checks',
    });
    if (transitioned.kind !== 'moved') {
      throw new Error(`fast qualification lost its locked transition for ${businessId}`);
    }
    committed = true;
    if (verdict !== 'prequalified') return [];
    // `enrich` is the door to the data-collection phase, so it is one of the
    // two transitions the campaign's pause and stop-point ladder gate. A
    // blocked business simply rests at `prequalified` until Roman resumes the
    // campaign or presses «Зібрати дані» himself.
    if (!await mayAutoAdvance(tx, {
      campaignId: locked.campaignId, businessId, nextJob: 'enrich',
    })) return [];
    return [{
      name: 'enrich',
      payload: {
        businessId,
        campaignId: locked.campaignId,
        idempotencyKey: `enrich:${businessId}`,
      },
    }];
  });
  if (!committed) {
    log.info('fast qualification result discarded: business already advanced', { businessId });
    return;
  }
  log.info('fast qualification', { businessId, verdict, reasons });
}
