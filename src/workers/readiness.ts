/**
 * Production-readiness gate: qualified != ready for a demo site.
 * Missing inputs create targeted gaps; the business waits rather than
 * generating a dishonest demo.
 */
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { transition } from '../orchestrator/statuses.js';
import { advance } from '../orchestrator/router.js';
import type { JobPayload } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';

export async function readinessHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const facts = await db.select().from(schema.businessFacts).where(eq(schema.businessFacts.businessId, businessId));
  const contacts = await db.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, businessId));
  const assetRows = await db.select().from(schema.assets).where(eq(schema.assets.businessId, businessId));

  const gaps: string[] = [];
  const services = facts.filter((f) => f.key === 'service' && f.verified);
  const reviews = facts.filter((f) => f.key === 'review_excerpt' && f.verified);
  const identity = facts.some((f) => f.key === 'identity.description');
  const heroOrLogo = assetRows.some((a) => ['hero', 'logo', 'gallery'].includes(a.intendedUsage) && (a.width ?? 0) >= 800)
    || assetRows.some((a) => a.intendedUsage === 'logo');

  if (!identity) gaps.push('identity');
  if (!contacts.some((c) => c.verified)) gaps.push('verified_contact');
  if (services.length < 3) gaps.push('services_min3');
  if (assetRows.length < 3) gaps.push('assets_min3');
  if (!heroOrLogo) gaps.push('hero_or_logo');
  if (reviews.length < 1) gaps.push('review_context');

  // reset previous unresolved gap rows for idempotency
  await db.update(schema.productionGaps)
    .set({ resolved: true })
    .where(and(eq(schema.productionGaps.businessId, businessId), eq(schema.productionGaps.resolved, false)));

  if (gaps.length > 0) {
    for (const gap of gaps) {
      await db.insert(schema.productionGaps).values({ businessId, gap, blockerLevel: 'hard' });
    }
    log.info('not production ready', { businessId, gaps });
    // stays 'qualified'; dashboard/telegram shows gaps. A targeted re-enrichment can be triggered manually
    // or by the daily summary job if new sources may exist.
    await transition(businessId, 'needs_review', 'readiness-gate', `gaps: ${gaps.join(',')}`);
    return;
  }

  await transition(businessId, 'production_ready', 'readiness-gate');
  await advance(businessId); // -> content-and-design
}
