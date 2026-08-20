/**
 * Server-side fetch of a URL that came from SCRAPED CONTENT.
 *
 * THE THREAT. `brandIdentity.ts` reads an `og:image` out of captured social
 * HTML and downloads it to sample its colours. That URL is attacker-controlled
 * in the ordinary case — anyone who can get a page captured (a business's own
 * site, a profile a SERP surfaced) chooses its meta tags. A plain `fetch()` of
 * it is a server-side request forgery primitive, and these workers run INSIDE
 * the compose network, where `postgres:5432`, `minio:9000` (which holds every
 * raw evidence object) and the gosom API are all reachable by name and
 * unauthenticated-by-network-position. On a cloud host `169.254.169.254` would
 * hand out instance credentials.
 *
 * THE GUARD, in the order it has to happen:
 *
 *   1. scheme must be http/https — `file://`, `gopher://`, `ftp://` are out;
 *   2. the hostname is RESOLVED and every returned address checked against the
 *      private/loopback/link-local ranges. Checking the literal string is not
 *      enough: `http://internal.attacker.com/` can resolve to 127.0.0.1, and a
 *      decimal or hex literal (`http://2130706433/`) is the same address in a
 *      form no regex list would match — `dns.lookup` normalises both;
 *   3. redirects are followed MANUALLY, revalidating each hop, because a public
 *      host answering `302 -> http://169.254.169.254/` defeats a check that only
 *      ran on the first URL;
 *   4. the response is capped by declared AND streamed length, and by
 *      content-type, so a hostile host cannot answer a 2 GB body.
 *
 * KNOWN LIMIT — TOCTOU. Between the lookup and the socket's own resolution, a
 * DNS record can change (a "DNS rebinding" attack). Closing that hole properly
 * means pinning the resolved address and reconnecting to the literal IP with a
 * `Host:` header, which Node's fetch does not expose. What is here defeats the
 * realistic case (a scraped URL naming an internal host or a private literal);
 * the residual risk is an attacker who controls a nameserver AND wins a race,
 * to read an image-shaped response they cannot see the body of. Recorded rather
 * than left implicit.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class BlockedUrlError extends Error {
  readonly code = 'BLOCKED_URL';
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

/**
 * Is this IP one nobody on the public internet should be able to send us at?
 *
 * Covers the ranges named in RFC 1918 (private), RFC 3927 / 4291 (link-local,
 * which is where cloud metadata lives), loopback, "this network", carrier-grade
 * NAT, and IPv6 unique-local. IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is unwrapped
 * first — it is the same address wearing a different notation, and skipping the
 * unwrap is the classic way one of these lists gets bypassed.
 */
export function isPrivateAddress(addr: string): boolean {
  const ip = addr.trim().toLowerCase();

  // IPv4-mapped / IPv4-compatible IPv6: judge the embedded v4 address.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip)
    ?? /^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]!);

  if (isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 0) return true;                                   // 0.0.0.0/8 "this network"
    if (a === 10) return true;                                  // 10/8 private
    if (a === 127) return true;                                 // 127/8 loopback
    if (a === 169 && b === 254) return true;                    // 169.254/16 link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;           // 172.16/12 private
    if (a === 192 && b === 168) return true;                    // 192.168/16 private
    if (a === 100 && b >= 64 && b <= 127) return true;          // 100.64/10 carrier-grade NAT
    if (a === 192 && b === 0) return true;                      // 192.0.0/24 + 192.0.2/24 special-use
    if (a === 198 && (b === 18 || b === 19)) return true;        // 198.18/15 benchmarking
    if (a >= 224) return true;                                  // multicast + reserved + broadcast
    return false;
  }

  if (isIP(ip) === 6) {
    if (ip === '::' || ip === '::1') return true;               // unspecified, loopback
    const head = ip.split(':')[0] ?? '';
    // fc00::/7 unique-local — first byte 0xfc or 0xfd
    if (/^f[cd][0-9a-f]{0,2}$/.test(head)) return true;
    // fe80::/10 link-local — fe80..febf
    if (/^fe[89ab][0-9a-f]?$/.test(head)) return true;
    return false;
  }

  // Not a parseable address at all: refuse rather than guess.
  return true;
}

/**
 * Validates one URL and returns it parsed. Throws `BlockedUrlError` with a
 * reason a human can read in the logs — a blocked fetch should be legible as a
 * policy decision, not as a mysterious null.
 */
/**
 * How a hostname is resolved. Injectable for ONE reason: the redirect-hop check
 * is the part of this guard most likely to be broken by a refactor, and it
 * cannot be exercised offline without a hostname that resolves publicly and
 * redirects somewhere private. A test resolver lets the real loop run against a
 * local server while every other rule stays exactly as it is in production.
 *
 * Production callers never pass this.
 */
export type Resolver = (host: string) => Promise<Array<{ address: string }>>;

const defaultResolver: Resolver = (host) => lookup(host, { all: true });

export async function assertPublicUrl(raw: string, resolver: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('not a parseable URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError(`scheme "${url.protocol}" is not http/https`);
  }
  // Credentials in a scraped URL are never legitimate here and are a known way
  // to confuse host parsing (`http://expected.com@evil.internal/`).
  if (url.username || url.password) {
    throw new BlockedUrlError('URL carries embedded credentials');
  }

  // `new URL` keeps IPv6 literals in brackets; dns/isIP want them bare.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new BlockedUrlError('URL has no host');

  // A literal address never reaches DNS, so it is checked directly.
  //
  // The injected resolver is consulted for literals too. In production the
  // default resolver is not even called on this branch (the literal IS the
  // answer), so behaviour is unchanged; it exists so a test can stand a real
  // HTTP server on loopback and still exercise the rest of the guard — the
  // redirect loop, the size cap, the content-type check — against it. Without
  // that, every one of those paths could only be reasoned about, not run.
  if (isIP(host)) {
    const resolved = resolver === defaultResolver
      ? [{ address: host }]
      : await resolver(host).catch(() => [{ address: host }]);
    for (const { address } of resolved) {
      if (isPrivateAddress(address)) {
        throw new BlockedUrlError(`host ${host} is a private/loopback/link-local address`);
      }
    }
    return url;
  }

  // A bare label with no dot is a container/service name on the compose network
  // ("minio", "postgres", "gosom"). No public image is ever served from one.
  if (!host.includes('.')) {
    throw new BlockedUrlError(`host "${host}" is not a public hostname (no dot — internal service name)`);
  }
  if (host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new BlockedUrlError(`host "${host}" is in a reserved internal domain`);
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await resolver(host);
  } catch {
    throw new BlockedUrlError(`host "${host}" does not resolve`);
  }
  if (addresses.length === 0) throw new BlockedUrlError(`host "${host}" resolved to nothing`);
  // EVERY address must be public: a host answering both a public A record and a
  // private one would otherwise be reachable by whichever the socket picks.
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new BlockedUrlError(`host "${host}" resolves to private address ${address}`);
    }
  }
  return url;
}

export interface SafeFetchResult {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
}

const MAX_REDIRECTS = 3;

/**
 * Fetches a scraped URL under the guard above.
 *
 * Returns null for every ordinary failure — blocked host, dead link, wrong
 * type, oversized body — because every caller here treats "no image" as a gap
 * rather than an error. Blocks are logged by the caller with the reason.
 */
export async function safeFetchImage(
  rawUrl: string,
  opts: { maxBytes?: number; timeoutMs?: number; userAgent?: string; resolver?: Resolver } = {},
): Promise<SafeFetchResult | { blocked: string }> {
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: URL;
    try {
      // Revalidated on EVERY hop: a public host is allowed to redirect, and a
      // redirect to 169.254.169.254 is exactly how this guard gets bypassed if
      // only the first URL is checked.
      url = await assertPublicUrl(current, opts.resolver ?? defaultResolver);
    } catch (err) {
      return { blocked: err instanceof BlockedUrlError ? err.message : String(err).slice(0, 160) };
    }

    let res: Response;
    try {
      res = await fetch(url, {
        // Manual, so each Location is put back through `assertPublicUrl`.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'user-agent': opts.userAgent
            ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          accept: 'image/*',
        },
      });
    } catch (err) {
      return { blocked: `fetch failed: ${String(err).slice(0, 120)}` };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { blocked: `redirect ${res.status} with no Location` };
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) return { blocked: `HTTP ${res.status}` };

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      return { blocked: `content-type "${contentType || '(none)'}" is not an image` };
    }
    // Trust the declared length as a cheap early reject, but never as the cap:
    // a hostile server can under-declare or omit it entirely.
    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { blocked: `declared ${declared} bytes, over the ${maxBytes} cap` };
    }

    const chunks: Buffer[] = [];
    let total = 0;
    if (!res.body) return { blocked: 'response had no body' };
    try {
      // Streamed so the cap holds even when Content-Length lied or was absent.
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.length;
        if (total > maxBytes) {
          return { blocked: `body exceeded the ${maxBytes} byte cap` };
        }
        chunks.push(Buffer.from(chunk));
      }
    } catch (err) {
      return { blocked: `body read failed: ${String(err).slice(0, 120)}` };
    }

    return { buffer: Buffer.concat(chunks), contentType, finalUrl: url.toString() };
  }

  return { blocked: `more than ${MAX_REDIRECTS} redirects` };
}
