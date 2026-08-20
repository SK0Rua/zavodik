import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, browserUrl, checkPassword, createSessionValue, sessionCookieOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '/inbox');

  // Only same-origin relative paths: a crafted `next` must not become an open redirect.
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/inbox';

  if (!(await checkPassword(password))) {
    return NextResponse.redirect(
      browserUrl(req, `/login?error=1&next=${encodeURIComponent(target)}`),
      { status: 303 },
    );
  }

  const res = NextResponse.redirect(browserUrl(req, target), { status: 303 });
  res.cookies.set(SESSION_COOKIE, await createSessionValue(), sessionCookieOptions);
  return res;
}
