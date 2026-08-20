/**
 * Single-password auth (SPEC §8: the UI is never exposed without auth).
 *
 * One shared password (`UI_PASSWORD`) — this is a one-operator console, not a
 * multi-tenant app. On success we set an HMAC-signed cookie carrying only an
 * expiry; there is no session store to keep in sync. The signature uses
 * `UI_SESSION_SECRET` (falling back to the password), so cookies cannot be
 * forged without the secret and rotate automatically when it changes.
 *
 * Runs on the Edge (middleware) as well as in Node, so it uses WebCrypto only.
 */

export const SESSION_COOKIE = 'factory_session';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days: Roman's own phone/laptop

function secret(): string {
  return process.env.UI_SESSION_SECRET || process.env.UI_PASSWORD || '';
}

export function authConfigured(): boolean {
  return Boolean(process.env.UI_PASSWORD);
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret()),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64url(sig);
}

/** Constant-time compare so a wrong password/signature leaks no timing signal. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(input: string): Promise<boolean> {
  const expected = process.env.UI_PASSWORD ?? '';
  if (!expected) return false;
  // Hash both sides first: equal-length digests keep the compare constant-time
  // regardless of how long the submitted password is.
  const digest = async (s: string) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return timingSafeEqual(await digest(input), await digest(expected));
}

export async function createSessionValue(): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = String(expiresAt);
  return `${payload}.${await sign(payload)}`;
}

export async function verifySessionValue(value: string | undefined): Promise<boolean> {
  if (!value || !secret()) return false;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!timingSafeEqual(sig, await sign(payload))) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_TTL_MS / 1000,
  // Behind a TLS terminator in prod; plain http on localhost during dev.
  secure: process.env.NODE_ENV === 'production',
};

/**
 * Build an absolute same-origin URL for redirects from the browser-facing host.
 * In the standalone Docker build Next binds to HOSTNAME=0.0.0.0 and `req.url` /
 * `req.nextUrl` carry that bind address, so `new URL(path, req.url)` sends the
 * browser to http://0.0.0.0:3000. The Host / X-Forwarded-* headers are what the
 * browser actually used, so derive the origin from them.
 */
export function browserUrl(req: { headers: Headers; url: string }, pathAndQuery: string): URL {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return host ? new URL(pathAndQuery, `${proto}://${host}`) : new URL(pathAndQuery, req.url);
}
