/**
 * Scoring (deterministic) + independent QA (separate agent from the enrichment one).
 * Qualification / priority score / production readiness are three separate concepts.
 */
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { runAgent, z } from '../agents/agent.js';
import { transition } from '../orchestrator/statuses.js';
import { advance } from '../orchestrator/router.js';
import type { JobPayload } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';

const SITE_GAP_POINTS: Record<string, number> = {
  none: 30, unreachable_all_endpoints: 28, working_with_https_issue: 24,
  working_but_dated: 20, acceptable: 8, strong_modern: 0,
};

const QaSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string()),
  notes: z.string(),
});

export async function scoreAndQaHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error(`business not found: ${businessId}`);

  const [audit] = await db.select().from(schema.websiteAudits)
    .where(eq(schema.websiteAudits.businessId, businessId))
    .orderBy(desc(schema.websiteAudits.auditedAt)).limit(1);
  const facts = await db.select().from(schema.businessFacts).where(eq(schema.businessFacts.businessId, businessId));
  const contacts = await db.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, businessId));
  const assetRows = await db.select().from(schema.assets).where(eq(schema.assets.businessId, businessId));

  const services = facts.filter((f) => f.key === 'service' && f.verified);
  const reviews = facts.filter((f) => f.key === 'review_excerpt' && f.verified);
  const verifiedContacts = contacts.filter((c) => c.verified);

  // ── deterministic score ──
  const breakdown: Record<string, number> = {
    site_gap: SITE_GAP_POINTS[audit?.verdict ?? 'none'] ?? 15,
    contactability: Math.min(verifiedContacts.length * 8, 25),
    content_richness: Math.min(services.length * 3 + reviews.length * 2 + assetRows.length * 2, 25),
    business_health: Math.min(((biz.rating ?? 0) >= 4 ? 10 : 5) + Math.min((biz.reviewCount ?? 0) / 10, 10), 20),
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);

  // ── qualification (boolean, independent of score) ──
  const reasons: string[] = [];
  const opportunity = (audit?.verdict ?? 'none') !== 'strong_modern';
  if (!opportunity) reasons.push('strong_modern_site_no_opportunity');
  if (verifiedContacts.length === 0) reasons.push('no_verified_contact');
  const qualified = opportunity && verifiedContacts.length > 0;

  // ── independent QA agent: verifies the package coherence, not re-does enrichment ──
  let qaPassed: boolean | null = null;
  let qaNotes = '';
  try {
    const qa = await runAgent(
      'independent-qa',
      `You are an independent QA reviewer for a lead evidence package. You did NOT build this package.
Check internal consistency: do the services fit the category? do contacts look real (not invented patterns)?
does the website verdict match the evidence? Flag anything suspicious. Be strict.`,
      JSON.stringify({
        business: { name: biz.name, category: biz.category, address: biz.address, rating: biz.rating, reviewCount: biz.reviewCount },
        websiteVerdict: audit?.verdict ?? 'none',
        auditNotes: audit?.notes,
        services: services.map((s) => s.value),
        reviewExcerpts: reviews.map((r) => r.value),
        contacts: verifiedContacts.map((c) => ({ channel: c.channel, value: c.value })),
        assetCount: assetRows.length,
      }, null, 2),
      QaSchema,
    );
    qaPassed = qa.passed;
    qaNotes = [qa.notes, ...qa.issues].join('; ').slice(0, 1000);
  } catch (err) {
    log.warn('qa agent unavailable, marking for review', { businessId });
    qaNotes = 'qa agent unavailable';
  }

  await db.insert(schema.qualifications).values({
    businessId, stage: 'full', qualified, reasons, score, scoreBreakdown: breakdown, qaPassed, qaNotes,
  });
  await db.update(schema.businesses).set({ score, scoreBreakdown: breakdown, updatedAt: new Date() })
    .where(eq(schema.businesses.id, businessId));

  if (!qualified) {
    await transition(businessId, 'rejected', 'score-worker', reasons.join(','));
    return;
  }
  if (qaPassed === false) {
    await transition(businessId, 'needs_review', 'score-worker', `QA failed: ${qaNotes.slice(0, 200)}`);
    return;
  }
  await transition(businessId, 'qualified', 'score-worker', `score=${score}`);
  await advance(businessId); // -> readiness-gate
}
