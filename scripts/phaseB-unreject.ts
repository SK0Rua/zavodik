/**
 * Moves businesses that stage 7 hard-rejected into `needs_review`.
 *
 * Stage 7's calls are judgement, not fact, so they must stay reversible (see
 * `src/workers/score.ts`). Only rows whose reason came from the score worker
 * are touched — a stage-3 rejection (closed, chain, wrong category) is objective
 * and stays terminal.
 */
import { eq, and, like, sql } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';

const campaignId = process.argv[2] ?? 'gr-patras-beauty';

const rows = await db.select().from(schema.businesses).where(and(
  eq(schema.businesses.campaignId, campaignId),
  eq(schema.businesses.status, 'rejected'),
  like(schema.businesses.statusReason, '%no_opportunity%'),
));

if (rows.length === 0) { console.log('no stage-7 rejections to reverse'); process.exit(0); }

for (const b of rows) {
  await db.update(schema.businesses)
    .set({ status: 'needs_review', statusReason: `not qualified: ${b.statusReason}`, updatedAt: new Date() })
    .where(eq(schema.businesses.id, b.id));
  await db.insert(schema.statusHistory).values({
    businessId: b.id, fromStatus: 'rejected', toStatus: 'needs_review',
    actor: 'phaseB-unreject', reason: 'stage 7 no longer hard-rejects; decision is reversible',
  });
  console.log(`  ${b.id}: rejected -> needs_review (${b.statusReason})`);
}
console.log(`\nreversed ${rows.length} stage-7 rejection(s)`);
process.exit(0);
