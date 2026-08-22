/**
 * Live build log, proxied from the factory.
 *
 * The log file lives on the `sitesdata` volume, which only the factory
 * containers mount — this process cannot read it directly and should not try
 * to, because the UI must not become a second owner of workspace state. So it
 * asks over the internal API, exactly like the build preview and the QA note do.
 *
 * Read-only: the endpoint behind this cannot start, stop or influence a build.
 * Middleware has already rejected anonymous requests by the time this runs.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { factoryFetch } from '@/lib/factoryApi';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Keyed by business: the pipeline log spans the whole run, including the
  // design stage that happens before any project exists.
  const businessId = req.nextUrl.searchParams.get('businessId') ?? '';
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(businessId)) {
    return NextResponse.json({ ok: false, message: 'Невірний id бізнесу.' }, { status: 400 });
  }
  const after = Number(req.nextUrl.searchParams.get('after') ?? 0);
  const offset = Number.isFinite(after) && after > 0 ? Math.floor(after) : 0;

  // Short timeout: this is polled every few seconds, and a slow answer is worse
  // than a missed tick — the next poll is already on its way.
  const res = await factoryFetch(`/internal/build-log/${encodeURIComponent(businessId)}?after=${offset}`, { timeoutMs: 8_000 });

  if (!res.ok) {
    return NextResponse.json(
      { ok: false, message: res.message || 'Фабрика не віддала лог збірки.' },
      { status: res.status && res.status >= 400 ? res.status : 502 },
    );
  }
  return NextResponse.json(res.body ?? { ok: true, lines: [], nextOffset: offset }, {
    headers: { 'cache-control': 'no-store' },
  });
}
