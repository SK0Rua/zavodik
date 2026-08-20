/**
 * Proxy for the WAHA pairing QR.
 *
 * Roman scans this ONCE with the dedicated outreach number. The QR is a
 * credential — anyone who scans it gets the WhatsApp session — so it is never
 * a public URL: WAHA stays bound to loopback inside the compose network and
 * this authenticated route (middleware already rejected anonymous requests)
 * streams the image through.
 *
 * The API key is read from the settings store, so the QR works with whatever
 * WAHA credentials Roman just saved on /settings, without a restart.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { effectiveValue } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const [base, apiKey, defaultSession] = await Promise.all([
    effectiveValue('WAHA_URL'),
    effectiveValue('WAHA_API_KEY'),
    effectiveValue('WAHA_SESSION'),
  ]);
  const session = req.nextUrl.searchParams.get('session') || defaultSession || 'default';
  if (!base) return NextResponse.json({ error: 'WAHA_URL не заданий' }, { status: 400 });

  const url = `${base.replace(/\/+$/, '')}/api/${encodeURIComponent(session)}/auth/qr?format=image`;
  try {
    const res = await fetch(url, {
      headers: apiKey ? { 'X-Api-Key': apiKey } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // WAHA 422s when the session is already WORKING — that is good news, not
      // an error, and the page says so rather than showing a broken image.
      return NextResponse.json(
        { error: `WAHA ${res.status}`, detail: text.slice(0, 300) },
        { status: res.status === 404 ? 404 : 502 },
      );
    }
    const body = new Uint8Array(await res.arrayBuffer());
    return new NextResponse(body as BodyInit, {
      headers: {
        'content-type': res.headers.get('content-type') ?? 'image/png',
        // A QR is a live credential: never cached, never indexed.
        'cache-control': 'no-store, must-revalidate',
        'x-robots-tag': 'noindex, nofollow',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: 'WAHA недоступний', detail: String(err).slice(0, 200) }, { status: 502 });
  }
}
