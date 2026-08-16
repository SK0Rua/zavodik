/**
 * Content brief + design contract.
 * One agent writes a source-backed content brief; a second generates 3 structurally
 * different art directions; a deterministic rubric picks one. Both documents are
 * versioned in object storage and referenced by the site project.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { putRaw } from '../lib/storage.js';
import { runAgent, z } from '../agents/agent.js';
import { transition } from '../orchestrator/statuses.js';
import { enqueue, type JobPayload } from '../orchestrator/queue.js';
import { buildClientSnapshot } from './snapshot.js';

const BriefSchema = z.object({
  businessOneLiner: z.string(),
  mainOffer: z.string(),
  primaryCta: z.string(),
  sections: z.array(z.object({ name: z.string(), purpose: z.string(), contentSummary: z.string() })),
  toneOfVoice: z.string(),
  language: z.string(),
  claimsAllowed: z.array(z.string()),
  claimsForbidden: z.array(z.string()),
});

const DirectionsSchema = z.object({
  directions: z.array(z.object({
    name: z.string(),
    layoutConcept: z.string(),
    typography: z.string(),
    palette: z.array(z.string()),
    motion: z.string(),
    heroTreatment: z.string(),
    distinctiveness: z.number(), // 0-10 self-assessed structural difference from a generic template
    riskOfKitsch: z.number(),    // 0-10
  })),
});

export async function contentDesignHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error(`business not found: ${businessId}`);
  await transition(businessId, 'site_in_progress', 'content-design-worker');

  const snapshot = await buildClientSnapshot(businessId);

  const brief = await runAgent(
    'content-brief',
    `You write a content brief for a personalized demo website for a local business.
Use ONLY facts present in the verified client snapshot. Any claim not in the snapshot goes to claimsForbidden.
Write in the business's customer language (${snapshot.language}).`,
    JSON.stringify(snapshot, null, 2),
    BriefSchema,
    { maxTokens: 6000 },
  );

  const directions = await runAgent(
    'design-directions',
    `You are an art director. Produce exactly 3 STRUCTURALLY different design directions for this business's demo site.
They must differ in layout composition, typography treatment and motion concept, not just colors.
Base aesthetic on the niche (${biz.category ?? 'local business'}) but make each direction distinctive. Avoid kitsch.`,
    JSON.stringify({ snapshot, brief }, null, 2),
    DirectionsSchema,
    { heavy: true, maxTokens: 6000 },
  );

  // deterministic rubric: max(distinctiveness) with riskOfKitsch <= 5
  const viable = directions.directions.filter((d) => d.riskOfKitsch <= 5);
  const chosen = (viable.length ? viable : directions.directions)
    .sort((a, b) => b.distinctiveness - a.distinctiveness)[0];

  const briefKey = await putRaw(`sites/${businessId}/brief`, JSON.stringify(brief, null, 2), 'application/json');
  const designKey = await putRaw(`sites/${businessId}/design`, JSON.stringify({ chosen, all: directions.directions }, null, 2), 'application/json');

  const [project] = await db.insert(schema.siteProjects).values({
    businessId, dir: `sites/${businessId}`,
    contentBriefKey: briefKey, designContractKey: designKey,
    designDirection: chosen.name, state: 'brief',
  }).returning();

  await enqueue('build-site', { businessId, campaignId: biz.campaignId, projectId: project.id });
}
