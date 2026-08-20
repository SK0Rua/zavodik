import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, browserUrl } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(browserUrl(req, '/login'), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
