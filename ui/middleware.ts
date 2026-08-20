/**
 * Everything is behind auth (SPEC §8). Default-deny: the matcher covers all
 * routes and only the login page + static assets are carved out, so a new page
 * added later is protected without anyone remembering to protect it.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionValue, authConfigured, browserUrl } from '@/lib/auth';

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (pathname === '/login' || pathname.startsWith('/api/auth')) return NextResponse.next();

  // No password configured = the console would be wide open. Refuse to serve.
  if (!authConfigured()) {
    return new NextResponse('UI_PASSWORD is not set; the control UI refuses to run without auth.', {
      status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  if (await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  // API routes get a clean 401; pages get redirected with a return path.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(browserUrl(req, `/login?next=${encodeURIComponent(pathname + search)}`));
}

export const config = {
  // `icon.svg` joins the carve-out for the same reason as favicon.ico: the
  // browser requests the tab icon on every page including /login, and
  // redirecting that request to the login page makes every load log a failure
  // for an asset that carries nothing private.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
