import type { Hono, MiddlewareHandler } from 'hono';
import type { ArchiveService } from '../orchestrator/archiveService.js';

export type ArchiveCommandExecutor = Pick<
  ArchiveService,
  | 'archiveBusiness' | 'unarchiveBusiness' | 'deleteBusiness'
  | 'archiveBusinesses' | 'unarchiveBusinesses' | 'deleteBusinesses'
  | 'archiveCampaign' | 'unarchiveCampaign' | 'deleteCampaign'
>;

/**
 * How many ids one bulk call may carry.
 *
 * A filter can match everything in the database, and «архівувати все за
 * фільтром» is a legitimate thing to want — but an unbounded request body is
 * not. The cap is high enough for any real campaign and low enough that a
 * malformed or runaway caller cannot ask for an unbounded transaction.
 */
const MAX_BULK_IDS = 5000;

function readIds(body: Record<string, unknown> | null): string[] | null {
  const raw = body?.businessIds;
  if (!Array.isArray(raw)) return null;
  const ids = raw
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  return ids.length ? [...new Set(ids)] : null;
}

function conflictStatus(kind: string): 404 | 409 {
  return kind === 'not_found' ? 404 : 409;
}

function readReason(body: Record<string, unknown> | null): string | undefined {
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  return reason || undefined;
}

/**
 * Archive/delete mutations for businesses and campaigns.
 *
 * Delete is a DELETE verb rather than a POST alias so an accidental replay of a
 * queued request cannot re-run it as something else; archive stays POST because
 * it carries a reason and is reversible.
 */
export function registerArchiveCommandRoutes(
  app: Hono,
  internalAuth: MiddlewareHandler,
  execute: ArchiveCommandExecutor,
): void {
  app.post('/internal/businesses/:businessId/archive', internalAuth, async (context) => {
    const businessId = context.req.param('businessId').trim();
    if (!businessId) return context.json({ ok: false, message: 'businessId is required' }, 400);
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const result = await execute.archiveBusiness(businessId, readReason(body));
    if (result.kind !== 'archived') {
      return context.json({
        ok: false,
        message: result.kind === 'not_found' ? 'business not found' : result.message,
        result,
      }, conflictStatus(result.kind));
    }
    return context.json({ ok: true, message: 'business archived', result });
  });

  app.post('/internal/businesses/:businessId/unarchive', internalAuth, async (context) => {
    const businessId = context.req.param('businessId').trim();
    if (!businessId) return context.json({ ok: false, message: 'businessId is required' }, 400);
    const result = await execute.unarchiveBusiness(businessId);
    if (result.kind !== 'unarchived') {
      return context.json({
        ok: false,
        message: result.kind === 'not_found' ? 'business not found' : result.message,
        result,
      }, conflictStatus(result.kind));
    }
    return context.json({ ok: true, message: 'business restored', result });
  });

  app.delete('/internal/businesses/:businessId', internalAuth, async (context) => {
    const businessId = context.req.param('businessId').trim();
    if (!businessId) return context.json({ ok: false, message: 'businessId is required' }, 400);
    const result = await execute.deleteBusiness(businessId);
    if (result.kind !== 'deleted') {
      return context.json({
        ok: false,
        message: result.kind === 'not_found' ? 'business not found' : result.message,
        result,
      }, conflictStatus(result.kind));
    }
    return context.json({ ok: true, message: 'business deleted', result });
  });

  // ── Bulk: one transaction over a whole filtered selection ────────────────
  //
  // Ids rather than the filter itself: the caller has already resolved the
  // filter to a concrete list, so what gets archived is exactly what was
  // counted and shown in the confirmation — the set cannot quietly grow
  // between the question and the answer.

  app.post('/internal/businesses/archive-bulk', internalAuth, async (context) => {
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const ids = readIds(body);
    if (!ids) return context.json({ ok: false, message: 'businessIds are required' }, 400);
    if (ids.length > MAX_BULK_IDS) {
      return context.json({
        ok: false,
        message: `Забагато бізнесів за раз (${ids.length}, максимум ${MAX_BULK_IDS}). Звузь фільтр.`,
      }, 400);
    }
    const result = await execute.archiveBusinesses(ids, readReason(body));
    return context.json({ ok: true, message: `archived ${result.archived}`, result });
  });

  app.post('/internal/businesses/unarchive-bulk', internalAuth, async (context) => {
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const ids = readIds(body);
    if (!ids) return context.json({ ok: false, message: 'businessIds are required' }, 400);
    if (ids.length > MAX_BULK_IDS) {
      return context.json({
        ok: false,
        message: `Забагато бізнесів за раз (${ids.length}, максимум ${MAX_BULK_IDS}). Звузь фільтр.`,
      }, 400);
    }
    const result = await execute.unarchiveBusinesses(ids);
    return context.json({ ok: true, message: `restored ${result.restored}`, result });
  });

  app.post('/internal/businesses/delete-bulk', internalAuth, async (context) => {
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const ids = readIds(body);
    if (!ids) return context.json({ ok: false, message: 'businessIds are required' }, 400);
    if (ids.length > MAX_BULK_IDS) {
      return context.json({
        ok: false,
        message: `Забагато бізнесів за раз (${ids.length}, максимум ${MAX_BULK_IDS}). Звузь фільтр.`,
      }, 400);
    }
    const result = await execute.deleteBusinesses(ids);
    return context.json({ ok: true, message: `deleted ${result.deleted}`, result });
  });

  app.post('/internal/campaigns/:campaignId/archive', internalAuth, async (context) => {
    const campaignId = context.req.param('campaignId').trim();
    if (!campaignId) return context.json({ ok: false, message: 'campaignId is required' }, 400);
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const result = await execute.archiveCampaign(campaignId, readReason(body));
    if (result.kind !== 'archived') {
      return context.json({
        ok: false,
        message: result.kind === 'not_found' ? 'campaign not found' : result.message,
        result,
      }, conflictStatus(result.kind));
    }
    return context.json({ ok: true, message: 'campaign archived', result });
  });

  app.post('/internal/campaigns/:campaignId/unarchive', internalAuth, async (context) => {
    const campaignId = context.req.param('campaignId').trim();
    if (!campaignId) return context.json({ ok: false, message: 'campaignId is required' }, 400);
    const result = await execute.unarchiveCampaign(campaignId);
    if (result.kind !== 'unarchived') {
      return context.json({
        ok: false,
        message: result.kind === 'not_found' ? 'campaign not found' : result.message,
        result,
      }, conflictStatus(result.kind));
    }
    return context.json({ ok: true, message: 'campaign restored', result });
  });

  app.delete('/internal/campaigns/:campaignId', internalAuth, async (context) => {
    const campaignId = context.req.param('campaignId').trim();
    if (!campaignId) return context.json({ ok: false, message: 'campaignId is required' }, 400);
    const result = await execute.deleteCampaign(campaignId);
    if (result.kind !== 'deleted') {
      return context.json({
        ok: false,
        message: result.kind === 'not_found' ? 'campaign not found' : result.message,
        result,
      }, conflictStatus(result.kind));
    }
    return context.json({ ok: true, message: 'campaign deleted', result });
  });
}
