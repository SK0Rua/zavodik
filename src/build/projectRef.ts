/**
 * Resolve which site_project a build-chain job refers to.
 *
 * The payload normally carries `projectId`. Jobs enqueued before the payload
 * column existed — or hand-crafted ones — may not. For those, the most recent
 * project of the business is the only sensible referent; refusing with
 * "site project not found: undefined" turned a lossy retry into a dead end.
 */
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { log } from '../lib/logger.js';
import type { JobPayload } from '../orchestrator/queue.js';

export async function resolveProject(
  jobName: string,
  payload: JobPayload,
): Promise<typeof schema.siteProjects.$inferSelect> {
  const businessId = payload.businessId as string | undefined;
  const projectId = payload.projectId as number | undefined;

  if (projectId != null) {
    const [project] = await db.select().from(schema.siteProjects)
      .where(eq(schema.siteProjects.id, projectId));
    if (project) return project;
    throw Object.assign(
      new Error(`site project #${projectId} не існує (job ${jobName})`),
      { code: 'NEEDS_HUMAN' },
    );
  }

  if (!businessId) {
    throw Object.assign(
      new Error(`job ${jobName} без projectId і без businessId — нема що будувати`),
      { code: 'NEEDS_HUMAN' },
    );
  }

  const [latest] = await db.select().from(schema.siteProjects)
    .where(eq(schema.siteProjects.businessId, businessId))
    .orderBy(desc(schema.siteProjects.id))
    .limit(1);
  if (!latest) {
    throw Object.assign(
      new Error(`у бізнеса ${businessId} немає жодного site project — запусти «Побудувати демо» з картки`),
      { code: 'NEEDS_HUMAN' },
    );
  }
  log.warn('projectId missing from payload; resolved latest project', {
    jobName, businessId, projectId: latest.id, state: latest.state,
  });
  return latest;
}
