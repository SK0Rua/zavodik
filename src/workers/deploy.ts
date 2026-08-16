/**
 * Private demo deploy.
 * static  : copy the site into deploys/<random-slug>/ served by the built-in demo
 *           server with X-Robots-Tag: noindex. URL is unguessable.
 * dokploy : optional adapter for a Dokploy instance (compose deploy via API).
 * A public production domain is never created here.
 */
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { customAlphabet } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { config } from '../config.js';
import { transition } from '../orchestrator/statuses.js';
import { advance } from '../orchestrator/router.js';
import type { JobPayload } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';

const slug = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 16);
export const DEPLOYS_ROOT = path.resolve('deploys');

export async function deployHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const projectId = payload.projectId as number;
  const [project] = await db.select().from(schema.siteProjects).where(eq(schema.siteProjects.id, projectId));
  if (!project) throw new Error(`site project not found: ${projectId}`);
  if (project.state !== 'ready') throw new Error(`project not ready: state=${project.state}`);

  // idempotency: already deployed -> reuse
  if (project.deployUrl) {
    log.info('already deployed, skipping', { businessId, url: project.deployUrl });
    await transition(businessId, 'site_ready', 'deploy-worker');
    await advance(businessId);
    return;
  }

  let deployUrl: string;
  if (config.deploy.mode === 'dokploy' && config.deploy.dokployUrl) {
    deployUrl = await deployToDokploy(businessId, project.dir);
  } else {
    const s = slug();
    const target = path.join(DEPLOYS_ROOT, s);
    await mkdir(DEPLOYS_ROOT, { recursive: true });
    await cp(project.dir, target, { recursive: true });
    deployUrl = `${config.deploy.demoBaseUrl}/${s}/`;
  }

  // health check
  const ok = await fetch(deployUrl, { signal: AbortSignal.timeout(10_000) })
    .then((r) => r.ok).catch(() => config.deploy.mode === 'static'); // local static: server may start later
  if (!ok && config.deploy.mode === 'dokploy') throw new Error(`deploy health check failed: ${deployUrl}`);

  await db.update(schema.siteProjects)
    .set({ deployUrl, deployedAt: new Date(), state: 'deployed' })
    .where(eq(schema.siteProjects.id, projectId));
  await transition(businessId, 'site_ready', 'deploy-worker', deployUrl);
  log.info('demo deployed', { businessId, deployUrl });
  await advance(businessId); // -> request-approval
}

async function deployToDokploy(businessId: string, dir: string): Promise<string> {
  // Minimal Dokploy static deploy: relies on a pre-created "demos" project with
  // a static-site application per business. Kept as an adapter; static mode is default.
  const res = await fetch(`${config.deploy.dokployUrl}/api/application.deploy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.deploy.dokployToken },
    body: JSON.stringify({ applicationId: businessId }),
  });
  if (!res.ok) throw new Error(`dokploy deploy failed: ${res.status} ${await res.text().catch(() => '')}`);
  return `${config.deploy.demoBaseUrl}/${businessId}/`;
}
