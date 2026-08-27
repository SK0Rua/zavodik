/**
 * City-assessment probe worker (Roman, 2026-08-27).
 *
 * A deliberately lightweight, THROWAWAY run of gosom for one city+niche, so
 * Roman can judge whether a full campaign is worth it before creating one. It
 * reuses the exact same gosom client as discovery, but:
 *   - small depth (1-2) and the minimum gosom budget — a probe, not a scrape;
 *   - NOTHING is persisted except the aggregate counts on the `city_assessments`
 *     row: no businesses, no raw evidence, no queue fan-out.
 *
 * The row is the job's own status tracker. A failure marks the row `failed` with
 * the reason and does NOT rethrow: a probe that could not reach gosom is not a
 * pipeline incident, it is a card that says "спробуй ще раз", so it must not spin
 * pg-boss retries or fire the failed-job Telegram alert.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import type { JobPayload } from '../orchestrator/queue.js';
import {
  appendCity, createGosomJob, downloadGosomCsv, mapCsvToCandidates, waitForGosomJob,
  type GosomJobData,
} from './discovery.js';
import { extractDomain } from './normalize.js';
import { cityVerdict } from '../lib/cityAssessment.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

/** gosom rejects max_time <= 180s; a probe wants the floor, not the campaign budget. */
const PROBE_MAX_TIME_SECONDS = 200;

export async function assessCityHandler(payload: JobPayload): Promise<void> {
  const id = Number(payload.assessmentId);
  if (!Number.isFinite(id)) throw new Error('assess-city: missing assessmentId');

  const [row] = await db.select().from(schema.cityAssessments)
    .where(eq(schema.cityAssessments.id, id));
  if (!row) throw new Error(`assess-city: assessment ${id} not found`);

  try {
    // One keyword is enough for a probe; gosom's own `lang` covers the local
    // spelling, and appendCity keeps the city in the query the way discovery does.
    const keyword = appendCity(row.niche, row.city);
    const jobData: GosomJobData = {
      keywords: [keyword],
      lang: row.language.slice(0, 2),
      zoom: config.gosom.zoom,
      lat: String(row.lat ?? 0),
      lon: String(row.lng ?? 0),
      fast_mode: false,
      radius: row.radiusKm ? Math.round(row.radiusKm * 1000) : config.gosom.radiusMeters,
      depth: Math.max(1, row.depth),
      email: false,          // a probe does not need emails, and they slow gosom down
      extra_reviews: false,
      max_time: PROBE_MAX_TIME_SECONDS,
      proxies: config.gosom.proxies,
    };

    const gosomJobId = await createGosomJob(`assess-${id}-${Date.now()}`, jobData);
    log.info('city-assessment gosom job created', { assessmentId: id, gosomJobId, keyword });
    await waitForGosomJob(gosomJobId);
    const csv = await downloadGosomCsv(gosomJobId);
    // rawObjectKey is unused here — the probe stores no evidence.
    const candidates = mapCsvToCandidates(csv, keyword, 'probe');

    const extra = config.discovery.extraDirectoryDomains;
    let noSite = 0;
    let socialOnly = 0;
    let ratingSum = 0;
    let ratingN = 0;
    for (const c of candidates) {
      const hasOwnSite = extractDomain(c.websiteUrl, extra) !== null;
      if (!hasOwnSite) {
        noSite++;
        if (c.websiteUrl) socialOnly++; // had a link, but it was a profile/catalogue
      }
      if (c.rating !== null) { ratingSum += c.rating; ratingN++; }
    }
    const found = candidates.length;
    const hasSite = found - noSite;
    const avgRating = ratingN ? Math.round((ratingSum / ratingN) * 10) / 10 : null;

    // Most-reviewed first: the sample should show the places Roman would recognise.
    const sample = [...candidates]
      .sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0))
      .slice(0, 8)
      .map((c) => ({
        name: c.name,
        rating: c.rating,
        reviewCount: c.reviewCount,
        hasSite: extractDomain(c.websiteUrl, extra) !== null,
      }));

    const verdict = cityVerdict({ found, noSite });

    await db.update(schema.cityAssessments).set({
      status: 'done', found, noSite, hasSite, socialOnly, avgRating, sample, verdict,
      error: null, finishedAt: new Date(),
    }).where(eq(schema.cityAssessments.id, id));

    log.info('city-assessment done', { assessmentId: id, found, noSite, verdict });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err).slice(0, 500);
    await db.update(schema.cityAssessments).set({
      status: 'failed', error: msg, finishedAt: new Date(),
    }).where(eq(schema.cityAssessments.id, id));
    log.warn('city-assessment failed', { assessmentId: id, err: msg });
    // Deliberately no rethrow: a probe failure is a card state, not a job incident.
  }
}
