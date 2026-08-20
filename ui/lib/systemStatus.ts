/**
 * "Стан системи" panel data: is each dependency actually up, right now.
 *
 * Deliberately shallow probes (a TCP/HTTP touch, not a full handshake) so the
 * page renders in well under a second even when something is down. The deep,
 * credential-proving checks are the per-group "Перевірити" buttons.
 */
import { sql } from 'drizzle-orm';
import { db } from './db';
import { effectiveValue, loadHeartbeats, loadPendingJobs, type HeartbeatView, type PendingJobs } from './settings';

export interface StatusLine {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

async function probe(label: string, id: string, url: string, headers?: Record<string, string>): Promise<StatusLine> {
  try {
    const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(4000) });
    return { id, label, ok: res.ok, detail: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}` };
  } catch (err) {
    return { id, label, ok: false, detail: String(err).slice(0, 120) };
  }
}

export interface SystemStatus {
  services: StatusLine[];
  heartbeats: HeartbeatView[];
  jobs: PendingJobs | null;
}

export async function loadSystemStatus(): Promise<SystemStatus> {
  const wahaUrl = await effectiveValue('WAHA_URL');
  const factoryBase = (process.env.FACTORY_API_URL ?? 'http://factory:8787').replace(/\/+$/, '');
  const s3 = (process.env.S3_ENDPOINT ?? 'http://minio:9000').replace(/\/+$/, '');
  const gosom = (process.env.GOSOM_URL ?? 'http://gosom:8080').replace(/\/+$/, '');

  const [dbLine, ...rest] = await Promise.all([
    (async (): Promise<StatusLine> => {
      try {
        await db.execute(sql`select 1`);
        return { id: 'db', label: 'Postgres', ok: true, detail: 'відповідає' };
      } catch (err) {
        return { id: 'db', label: 'Postgres', ok: false, detail: String(err).slice(0, 120) };
      }
    })(),
    probe('MinIO', 'minio', `${s3}/minio/health/live`),
    probe('gosom', 'gosom', `${gosom}/api/v1/jobs`),
    probe('Factory API', 'factory', `${factoryBase}/health`),
    wahaUrl
      ? probe('WAHA', 'waha', `${wahaUrl.replace(/\/+$/, '')}/ping`)
      : Promise.resolve<StatusLine>({ id: 'waha', label: 'WAHA', ok: false, detail: 'WAHA_URL не заданий' }),
  ]);

  const [heartbeats, jobs] = await Promise.all([
    loadHeartbeats().catch(() => [] as HeartbeatView[]),
    loadPendingJobs().catch(() => null),
  ]);

  return { services: [dbLine, ...rest], heartbeats, jobs };
}
