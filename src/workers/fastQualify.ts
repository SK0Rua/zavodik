/**
 * Fast qualification: deterministic filter so deep enrichment isn't wasted
 * on obviously weak candidates. No LLM.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { transition } from '../orchestrator/statuses.js';
import { advance } from '../orchestrator/router.js';
import type { JobPayload } from '../orchestrator/queue.js';

const CHAIN_MARKERS = ['franchise', 'chain'];

export async function fastQualifyHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error(`business not found: ${businessId}`);

  const reasons: string[] = [];
  let verdict: 'prequalified' | 'rejected' | 'needs_review' = 'prequalified';

  // dnc check
  const dnc = await db.select().from(schema.doNotContact);
  const blocked = dnc.some((d) =>
    (d.matchType === 'phone' && d.value === biz.normalizedPhone) ||
    (d.matchType === 'domain' && d.value === biz.domain) ||
    (d.matchType === 'business_id' && d.value === biz.id));
  if (blocked) { verdict = 'rejected'; reasons.push('do_not_contact'); }

  if (biz.businessStatus && biz.businessStatus !== 'OPERATIONAL') {
    verdict = 'rejected'; reasons.push(`business_status:${biz.businessStatus}`);
  }
  const contacts = await db.select().from(schema.businessContacts).where(eq(schema.businessContacts.businessId, businessId));
  if (contacts.length === 0) {
    verdict = verdict === 'rejected' ? 'rejected' : 'needs_review';
    reasons.push('no_public_contact_yet');
  }
  if (CHAIN_MARKERS.some((m) => biz.name.toLowerCase().includes(m))) {
    verdict = 'needs_review'; reasons.push('possible_chain_no_local_decision_path');
  }

  await db.insert(schema.qualifications).values({
    businessId, stage: 'fast', qualified: verdict === 'prequalified', reasons,
  });
  await transition(businessId, verdict, 'fast-qualify-worker', reasons.join(',') || 'passed');
  if (verdict === 'prequalified') await advance(businessId); // -> enrich
}
