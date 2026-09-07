import type { Hono, MiddlewareHandler } from 'hono';
import type { ManualBusinessService } from '../orchestrator/manualBusinessService.js';

export type ManualBusinessCommandExecutor = Pick<ManualBusinessService, 'addByLink'>;

/**
 * «Додати бізнес за посиланням».
 *
 * Long by API standards — it waits for a gosom lookup — but deliberately
 * synchronous: Roman pastes a link and needs an answer about THAT link, not a
 * job id he would have to go and look up. The probe is one keyword at depth 1.
 */
export function registerManualBusinessCommandRoutes(
  app: Hono,
  internalAuth: MiddlewareHandler,
  execute: ManualBusinessCommandExecutor,
): void {
  app.post('/internal/businesses/from-link', internalAuth, async (context) => {
    const body = await context.req.json().catch(() => null) as Record<string, unknown> | null;
    const url = typeof body?.url === 'string' ? body.url.trim() : '';
    if (!url) return context.json({ ok: false, message: 'url is required' }, 400);

    const country = typeof body?.country === 'string' && body.country.trim()
      ? body.country.trim() : 'UA';
    const city = typeof body?.city === 'string' && body.city.trim()
      ? body.city.trim() : '';
    const language = typeof body?.language === 'string' && body.language.trim()
      ? body.language.trim() : 'uk';

    const result = await execute.addByLink({ url, country, city, language });

    // A bad link and a place we could not identify are ANSWERS, not failures:
    // both carry a sentence telling Roman what to do differently, and neither
    // deserves a 500 that hides it behind "щось пішло не так".
    if (result.kind === 'invalid') {
      return context.json({ ok: false, message: result.message, result }, 400);
    }
    if (result.kind === 'not_found') {
      return context.json({ ok: false, message: result.message, result }, 404);
    }
    return context.json({
      ok: true,
      message: result.kind === 'duplicate'
        ? `«${result.name}» вже є у воронці`
        : `«${result.name}» додано`,
      result,
    }, result.kind === 'duplicate' ? 200 : 201);
  });
}
