import type { Hono, MiddlewareHandler } from 'hono';
import type { ArchiveService } from '../orchestrator/archiveService.js';

export type ArchiveCommandExecutor = Pick<
  ArchiveService,
  | 'archiveBusiness' | 'unarchiveBusiness' | 'deleteBusiness'
  | 'archiveCampaign' | 'unarchiveCampaign' | 'deleteCampaign'
>;

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
