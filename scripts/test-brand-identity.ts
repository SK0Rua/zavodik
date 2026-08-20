/**
 * Unit tests for brand identity extraction — no network, no DB, no agent.
 *
 * Two halves:
 *   1. pure colour maths (`colorExtract.ts`) against hand-computed answers and
 *      a SYNTHETIC fixture image whose true palette is known by construction;
 *   2. HTML mining (`brandIdentity.ts`) against markup shaped like the real
 *      captures in this project's storage.
 *
 * The fixture image is generated in-process rather than committed: a PNG built
 * from known colour blocks is a stronger assertion than a photo whose "correct"
 * palette is whatever the algorithm said last time. Determinism is checked by
 * running the extraction twice and requiring byte-identical output — median cut
 * is chosen over k-means precisely so that test can pass.
 */
import { createServer, type Server } from 'node:http';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import {
  contrastCorrect, contrastRatio, decodeImage, fromHex, luminance, medianCut, mergeNear,
  paletteFromImage, pickAccent, pickNeutrals, quantiseSamples, rgbToHsl, hslToRgb, toHex,
} from '../src/enrichment/colorExtract.js';
import { avatarUrlFromHtml, bioFromHtml, colorsFromHtml, fontsFromHtml, isFrameworkToken } from '../src/enrichment/brandIdentity.js';
import { assertPublicUrl, isPrivateAddress, safeFetchImage, type Resolver } from '../src/lib/safeFetch.js';

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function eq<T>(name: string, actual: T, expected: T): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── a real PNG, built by hand ───────────────────────────────────────────────

/**
 * Minimal RGBA PNG encoder. Writing 40 lines of CRC and zlib framing beats
 * adding an image dependency to the project for one test fixture.
 */
function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  // 10-12: compression / filter / interlace, all zero
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The fixture: 60% deep teal, 30% off-white, 10% vivid gold, plus a fully
 * transparent stripe that must be ignored entirely. Those proportions and
 * colours are the assertion.
 */
const FIXTURE = {
  teal: { r: 0x0f, g: 0x4c, b: 0x4a },
  cream: { r: 0xf2, g: 0xee, b: 0xe4 },
  gold: { r: 0xd4, g: 0xa0, b: 0x1e },
};

function buildFixture(): Buffer {
  const w = 100, h = 100;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let c = FIXTURE.teal, a = 255;
      if (y >= 60 && y < 90) c = FIXTURE.cream;
      else if (y >= 90) c = FIXTURE.gold;
      if (x >= 90) { a = 0; c = { r: 255, g: 0, b: 255 }; } // magenta, invisible
      px[i] = c.r; px[i + 1] = c.g; px[i + 2] = c.b; px[i + 3] = a;
    }
  }
  return encodePng(w, h, px);
}

async function main(): Promise<void> {
  // ── colour space ─────────────────────────────────────────────────────────
  eq('toHex rounds and pads', toHex({ r: 15, g: 76, b: 74 }), '#0f4c4a');
  eq('fromHex 6-digit', fromHex('#0F4C4A'), { r: 15, g: 76, b: 74 });
  eq('fromHex 3-digit expands', fromHex('#fa0'), { r: 255, g: 170, b: 0 });
  eq('fromHex rejects junk', fromHex('not a colour'), null);

  const goldHsl = rgbToHsl(FIXTURE.gold);
  check('rgbToHsl gold hue is yellow-orange', Math.abs(goldHsl.h - 43) < 2, `h=${goldHsl.h}`);
  check('rgbToHsl gold is saturated', goldHsl.s > 0.7, `s=${goldHsl.s}`);
  eq('grey has zero saturation', Number(rgbToHsl({ r: 128, g: 128, b: 128 }).s.toFixed(3)), 0);

  // hsl -> rgb -> hsl is the round trip the contrast corrector depends on
  const round = rgbToHsl(hslToRgb(goldHsl.h, goldHsl.s, goldHsl.l));
  check('hsl round-trips', Math.abs(round.h - goldHsl.h) < 1 && Math.abs(round.s - goldHsl.s) < 0.01,
    `${JSON.stringify(round)} vs ${JSON.stringify(goldHsl)}`);

  eq('luminance of white is 1', Number(luminance({ r: 255, g: 255, b: 255 }).toFixed(3)), 1);
  eq('luminance of black is 0', Number(luminance({ r: 0, g: 0, b: 0 }).toFixed(3)), 0);
  eq('contrast black on white is 21', Number(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }).toFixed(0)), 21);

  // ── contrast correction ──────────────────────────────────────────────────
  const light = { r: 250, g: 249, b: 246 };
  const dark = { r: 18, g: 18, b: 20 };
  const corrected = contrastCorrect(FIXTURE.gold, light, 4.5);
  check('gold on cream is corrected to pass AA', contrastRatio(corrected, light) >= 4.5,
    `${toHex(corrected)} ratio ${contrastRatio(corrected, light).toFixed(2)}`);
  const correctedHsl = rgbToHsl(corrected);
  check('correction preserves hue', Math.abs(correctedHsl.h - goldHsl.h) < 2,
    `${correctedHsl.h} vs ${goldHsl.h}`);
  check('correction only darkens on light bg', correctedHsl.l < goldHsl.l,
    `l ${correctedHsl.l} vs ${goldHsl.l}`);
  const onDark = contrastCorrect(FIXTURE.teal, dark, 4.5);
  check('deep teal on near-black is lightened to pass', contrastRatio(onDark, dark) >= 4.5,
    `${toHex(onDark)} ratio ${contrastRatio(onDark, dark).toFixed(2)}`);
  const alreadyFine = contrastCorrect({ r: 255, g: 255, b: 255 }, dark, 4.5);
  eq('a colour that already passes is returned untouched', toHex(alreadyFine), '#ffffff');

  // ── quantiser rules ──────────────────────────────────────────────────────
  {
    // 4 pixels: opaque teal, transparent, near-white, near-black
    const data = Uint8ClampedArray.from([
      15, 76, 74, 255,
      212, 160, 30, 10,      // alpha 10 -> transparent, must be skipped
      252, 252, 252, 255,    // near-white, unsaturated -> skipped
      4, 4, 5, 255,          // near-black, unsaturated -> skipped
    ]);
    const q = quantiseSamples(data);
    eq('transparent pixels are skipped', q.skippedTransparent, 1);
    eq('near-white/near-black are skipped', q.skippedExtreme, 2);
    eq('only the real colour is counted', q.counted, 1);
    const keep = quantiseSamples(data, { keepExtremes: true });
    eq('keepExtremes retains white and black', keep.counted, 3);
  }

  // ── median cut ───────────────────────────────────────────────────────────
  {
    const samples = [
      { r: 200, g: 0, b: 0, count: 60 },
      { r: 0, g: 200, b: 0, count: 30 },
      { r: 0, g: 0, b: 200, count: 10 },
    ];
    const cut = medianCut(samples, 3);
    eq('median cut returns the requested count', cut.length, 3);
    eq('largest share first', Number(cut[0]!.share.toFixed(2)), 0.6);
    eq('shares sum to 1', Number(cut.reduce((n, c) => n + c.share, 0).toFixed(3)), 1);
    // The same input twice must give the same answer, byte for byte.
    eq('median cut is deterministic', JSON.stringify(medianCut(samples, 3)), JSON.stringify(cut));
    // Shuffled input, same answer: no dependence on insertion order.
    const shuffled = medianCut([samples[2]!, samples[0]!, samples[1]!], 3);
    eq('median cut is order-independent',
      shuffled.map((c) => toHex(c.rgb)).sort().join(','),
      cut.map((c) => toHex(c.rgb)).sort().join(','));
  }

  {
    const merged = mergeNear([
      { rgb: { r: 100, g: 100, b: 100 }, share: 0.5 },
      { rgb: { r: 104, g: 102, b: 101 }, share: 0.3 }, // within threshold
      { rgb: { r: 10, g: 200, b: 10 }, share: 0.2 },
    ]);
    eq('near-identical entries merge', merged.length, 2);
    eq('merged share is the sum', Number(merged[0]!.share.toFixed(2)), 0.8);
  }

  // ── accent / neutral picking ─────────────────────────────────────────────
  {
    const palette = [
      { hex: '#f2eee4', share: 0.6, hsl: rgbToHsl(FIXTURE.cream) },
      { hex: '#d4a01e', share: 0.1, hsl: rgbToHsl(FIXTURE.gold) },
      { hex: '#0f4c4a', share: 0.3, hsl: rgbToHsl(FIXTURE.teal) },
    ];
    eq('accent is the saturated colour, not the biggest', pickAccent(palette)?.hex, '#d4a01e');
    const neutrals = pickNeutrals(palette);
    eq('darkest is the teal', neutrals.darkest?.hex, '#0f4c4a');
    eq('lightest is the cream', neutrals.lightest?.hex, '#f2eee4');
    eq('a greyscale palette yields no accent',
      pickAccent([{ hex: '#333333', share: 0.9, hsl: rgbToHsl({ r: 51, g: 51, b: 51 }) }]), null);
    eq('a colour below the share floor is not an accent',
      pickAccent([{ hex: '#d4a01e', share: 0.005, hsl: rgbToHsl(FIXTURE.gold) }]), null);
  }

  // ── HTML mining ──────────────────────────────────────────────────────────
  {
    const html = `<!doctype html><html><head>
      <meta name="theme-color" content="#0f4c4a">
      <link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;700&family=Manrope&display=swap" rel="stylesheet">
      <style>
        :root { --brand-accent: #d4a01e; --spacing: 12px; }
        body { font-family: "EB Garamond", Georgia, serif; color: #222222; }
        .cta { background-color: rgb(212, 160, 30); }
        .x { color: #ffffff; } .y { color: #000; }
      </style></head><body></body></html>`;
    const colors = colorsFromHtml(html);
    eq('theme-color ranks first', colors[0]?.hex, '#0f4c4a');
    check('the named brand variable is found', colors.some((c) => c.hex === '#d4a01e'),
      JSON.stringify(colors.map((c) => c.hex)));
    check('pure white and black are dropped', !colors.some((c) => c.hex === '#ffffff' || c.hex === '#000000'),
      JSON.stringify(colors.map((c) => c.hex)));
    check('rgb() notation is parsed', colors.some((c) => c.hex === '#d4a01e'), '');

    const fonts = fontsFromHtml(html);
    eq('Google Fonts families rank first', fonts.slice(0, 2), ['EB Garamond', 'Manrope']);
    check('generic fallbacks are dropped',
      !fonts.some((f) => /^(serif|georgia|sans-serif)$/i.test(f)), JSON.stringify(fonts));

    // Real markup from trendyhair.gr, which produced `&quot` and `dl-icon` as
    // "fonts this brand chose" before these two rules.
    const messy = fontsFromHtml(`<style>
      .a{font-family:&quot;Playfair Display&quot;,serif}
      .b{font-family:dl-icon}.c{font-family:FontAwesome}.d{font-family:"Noto Sans",sans-serif}</style>`);
    check('HTML-escaped quotes do not become a font',
      !messy.some((f) => /&quot|^&/.test(f)), JSON.stringify(messy));
    check('icon fonts are dropped',
      !messy.some((f) => /^(dl-icon|FontAwesome)$/i.test(f)), JSON.stringify(messy));
    eq('the real families survive', messy.sort(), ['Noto Sans', 'Playfair Display']);
  }

  // ── framework chrome must never become a brand colour ────────────────────
  {
    check('WordPress admin tokens are framework tokens',
      isFrameworkToken('--wp-admin-theme-color') && isFrameworkToken('--wp--preset--color--vivid-purple'),
      '');
    check('Bootstrap and Tailwind tokens are framework tokens',
      isFrameworkToken('--bs-primary') && isFrameworkToken('--tw-ring-color'), '');
    check('a site\'s own token is NOT a framework token',
      !isFrameworkToken('--brand-accent') && !isFrameworkToken('--color-primary'), '');
    // The exact markup WordPress inlines on every front end, which produced
    // "#7a00df is M.K Hair Studio's brand colour" before the namespace filter.
    const wp = `<style id="wp-block-library-inline-css">
      :root{--wp-block-synced-color:#7a00df;--wp-admin-theme-color:#007cba;--wp-admin-theme-color-darker-10:#006ba1;
      --wp--preset--color--vivid-green-cyan: #00d084;--wp--preset--color--vivid-cyan-blue: #0693e3;}
      </style><style>:root{--brand:#d8875b}.hdr{background:#d8875b}</style>`;
    const wpColors = colorsFromHtml(wp).map((c) => c.hex);
    check('WordPress editor chrome is excluded',
      !wpColors.some((h) => ['#7a00df', '#007cba', '#006ba1', '#00d084', '#0693e3'].includes(h)),
      JSON.stringify(wpColors));
    eq('the site\'s own brand token survives and ranks first', wpColors[0], '#d8875b');
  }

  {
    const ig = `<html><head>
      <meta property="og:image" content="https://scontent.cdninstagram.com/v/t51/avatar.jpg?_nc_cat=1&amp;oh=abc">
      <meta property="og:description" content="Hair &amp; beauty στην Πάτρα ✨ Book: 2610 000000">
      <meta property="og:title" content="exte hair design (@extehairdesign)"></head><body></body></html>`;
    eq('avatar URL is unescaped',
      avatarUrlFromHtml(ig), 'https://scontent.cdninstagram.com/v/t51/avatar.jpg?_nc_cat=1&oh=abc');
    const bio = bioFromHtml(ig);
    check('bio carries the description', bio.includes('Hair & beauty στην Πάτρα'), bio);
    check('bio carries the handle', bio.includes('@extehairdesign'), bio);
    eq('a page with no og:image yields null', avatarUrlFromHtml('<html><head></head></html>'), null);
  }

  // ── the fixture image, end to end through a real decoder ─────────────────
  const png = buildFixture();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const decoded = await decodeImage(page, png, 'image/png', 100);
    check('the fixture PNG decodes', decoded !== null);
    if (decoded) {
      eq('decoded at full size', [decoded.width, decoded.height], [100, 100]);
      const { palette, transparentShare } = paletteFromImage(decoded, { keepExtremes: true, maxColours: 4 });
      const hexes = palette.map((p) => p.hex);
      check('the teal block is found', hexes.includes('#0f4c4a'), JSON.stringify(hexes));
      check('the cream block is found', hexes.includes('#f2eee4'), JSON.stringify(hexes));
      check('the gold block is found', hexes.includes('#d4a01e'), JSON.stringify(hexes));
      check('the transparent stripe is never a colour',
        !hexes.some((h) => h === '#ff00ff'), JSON.stringify(hexes));
      eq('transparent share matches the stripe', Number(transparentShare.toFixed(1)), 0.1);

      const teal = palette.find((p) => p.hex === '#0f4c4a')!;
      const gold = palette.find((p) => p.hex === '#d4a01e')!;
      check('teal share ≈ 60% of opaque pixels', Math.abs(teal.share - 0.6) < 0.03, `${teal.share}`);
      check('gold share ≈ 10% of opaque pixels', Math.abs(gold.share - 0.1) < 0.03, `${gold.share}`);
      eq('the accent is the gold, not the dominant teal', pickAccent(palette)?.hex, '#d4a01e');

      // Determinism on a real decode: same bytes in, same palette out.
      const again = paletteFromImage(decoded, { keepExtremes: true, maxColours: 4 });
      eq('palette extraction is deterministic', JSON.stringify(again.palette), JSON.stringify(palette));
      const redecoded = await decodeImage(page, png, 'image/png', 100);
      eq('a second decode of the same bytes gives the same palette',
        JSON.stringify(paletteFromImage(redecoded!, { keepExtremes: true, maxColours: 4 }).palette),
        JSON.stringify(palette));

      // Downscaling must not change which colours exist, only their precision.
      const small = await decodeImage(page, png, 'image/png', 40);
      const smallHexes = paletteFromImage(small!, { keepExtremes: true, maxColours: 4 }).palette.map((p) => p.hex);
      check('downscaling preserves the three brand colours',
        ['#0f4c4a', '#f2eee4', '#d4a01e'].every((h) => smallHexes.some((s) => {
          const a = fromHex(h)!, b = fromHex(s)!;
          return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) < 12;
        })), JSON.stringify(smallHexes));
    }

    // A buffer that is not an image at all must yield null, not a crash.
    const junk = await decodeImage(page, Buffer.from('<html>404 not found</html>'), 'image/jpeg');
    eq('an undecodable buffer returns null', junk, null);
  } finally {
    await browser.close().catch(() => {});
  }

  // ── SSRF guard on scraped image URLs ─────────────────────────────────────
  //
  // `paletteOfUrl` downloads an `og:image` parsed out of captured social HTML.
  // That value is chosen by whoever controls the captured page, and these
  // workers run INSIDE the compose network next to minio (all raw evidence),
  // postgres and the gosom API. Without the guard it is an SSRF primitive.

  check('loopback, link-local and private v4 literals are private', [
    '127.0.0.1', '127.1.2.3', '169.254.169.254', '10.0.0.1', '172.16.0.1',
    '172.31.255.255', '192.168.1.1', '0.0.0.0', '100.64.0.1',
  ].every(isPrivateAddress));

  check('private IPv6 and IPv4-mapped forms are private', [
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ].every(isPrivateAddress), 'an IPv4-mapped v6 literal is the same address in other clothes');

  check('ordinary public addresses are not private',
    ['8.8.8.8', '1.1.1.1', '157.240.1.35', '2606:4700::1111'].every((a) => !isPrivateAddress(a)));

  check('172.32 and 11.x are public, not swept up by the /12 and /8 checks',
    !isPrivateAddress('172.32.0.1') && !isPrivateAddress('11.0.0.1'),
    'an over-broad range check would silently block real CDNs');

  for (const [label, url] of [
    ['a link-local literal (cloud metadata)', 'http://169.254.169.254/latest/meta-data/'],
    ['a loopback literal', 'http://127.0.0.1:9000/raw/'],
    ['a private literal', 'http://10.0.0.5/avatar.jpg'],
    ['a bare compose service name', 'http://minio:9000/assets/x.jpg'],
    ['a postgres service name', 'http://postgres:5432/'],
    ['a file:// URL', 'file:///etc/passwd'],
    ['a gopher:// URL', 'gopher://127.0.0.1:9000/_x'],
    ['an embedded-credential URL', 'http://cdn.example.com@169.254.169.254/a.jpg'],
    ['a decimal-encoded loopback', 'http://2130706433/'],
    ['a .internal domain', 'http://metadata.google.internal/computeMetadata/v1/'],
  ] as const) {
    let blocked = false;
    let reason = '';
    try {
      await assertPublicUrl(url);
    } catch (err) {
      blocked = true;
      reason = String(err);
    }
    check(`${label} is rejected`, blocked, `${url} was allowed`);
    void reason;
  }

  check('a normal CDN URL passes the guard',
    await assertPublicUrl('https://scontent.cdninstagram.com/v/t51/avatar.jpg?oh=abc')
      .then(() => true).catch((e) => { failures.push(`CDN URL rejected: ${e}`); return false; }),
    'blocking real Instagram CDN URLs would break every social-only business');

  // A real server, so the redirect path is exercised rather than reasoned about.
  {
    const server: Server = createServer((req, res) => {
      if (req.url === '/redirect-to-metadata') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
      } else if (req.url === '/redirect-to-private') {
        // A DIFFERENT private address from the test server's own, so the
        // narrow test resolver (which vouches only for 127.0.0.1) judges this
        // hop on its literal, as production would.
        res.writeHead(302, { location: 'http://10.0.0.5/x.jpg' });
        res.end();
      } else if (req.url === '/huge.jpg') {
        // Declares nothing and streams far past the cap.
        res.writeHead(200, { 'content-type': 'image/jpeg' });
        const blob = Buffer.alloc(256 * 1024, 0x41);
        for (let i = 0; i < 40; i++) res.write(blob);
        res.end();
      } else if (req.url === '/not-an-image') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>secret internal page</html>');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const direct = await safeFetchImage(`http://127.0.0.1:${port}/redirect-to-metadata`);
      check('a loopback origin is blocked before it can redirect anywhere',
        'blocked' in direct, JSON.stringify(direct).slice(0, 120));

      // The real thing: an origin that RESOLVES PUBLICLY and then redirects to
      // cloud metadata. This is the bypass a first-URL-only check permits.
      //
      // The test resolver vouches for the TEST SERVER ONLY (127.0.0.1 with the
      // ephemeral port's host), and reports every other host truthfully. A
      // resolver that blanket-returned a public address would also vouch for
      // 169.254.169.254 and the loop would genuinely dial it — which is exactly
      // what happened on the first version of this test, and is why the
      // narrowness matters.
      const publicOrigin: Resolver = async (host) => (host === '127.0.0.1'
        ? [{ address: '93.184.216.34' }]        // a public address, as a real CDN would be
        : [{ address: host }]);                  // everything else judged on its literal
      const hop = await safeFetchImage(
        `http://127.0.0.1:${port}/redirect-to-metadata`,
        { resolver: publicOrigin, timeoutMs: 4_000 },
      );
      check('a public-resolving origin redirecting to cloud metadata is blocked at the hop',
        'blocked' in hop && /169\.254|private/.test(hop.blocked),
        `expected the 169.254 hop to be refused, got ${JSON.stringify(hop).slice(0, 160)}`);

      const hopLoop = await safeFetchImage(
        `http://127.0.0.1:${port}/redirect-to-private`,
        { resolver: publicOrigin, timeoutMs: 4_000 },
      );
      check('a public-resolving origin redirecting to an RFC1918 address is blocked at the hop',
        'blocked' in hopLoop && /10\.0\.0\.5|private/.test(hopLoop.blocked),
        JSON.stringify(hopLoop).slice(0, 160));

      const oversized = await safeFetchImage(`http://127.0.0.1:${port}/huge.jpg`, {
        maxBytes: 1024, resolver: publicOrigin,
      });
      check('an oversized body is blocked', 'blocked' in oversized
        && /cap|exceeded/.test(oversized.blocked), JSON.stringify(oversized).slice(0, 120));

      const html = await safeFetchImage(`http://127.0.0.1:${port}/not-an-image`, {
        resolver: publicOrigin,
      });
      check('a non-image content-type is blocked', 'blocked' in html
        && /content-type/.test(html.blocked), JSON.stringify(html).slice(0, 120));

      // The guard must not block a legitimate image, or every social-only
      // business silently loses its avatar palette.
      const okServer: Server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(png);
      });
      await new Promise<void>((r) => okServer.listen(0, '127.0.0.1', r));
      const okPort = (okServer.address() as { port: number }).port;
      try {
        const good = await safeFetchImage(`http://127.0.0.1:${okPort}/avatar.png`, {
          resolver: publicOrigin,
        });
        check('a normal image response passes and returns its bytes',
          !('blocked' in good) && good.buffer.length === png.length,
          JSON.stringify(good).slice(0, 140));
      } finally {
        await new Promise<void>((r) => okServer.close(() => r()));
      }
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  // The redirect hop is revalidated with the same function the fetch loop uses,
  // so a public host redirecting to metadata cannot slip through.
  check('a Location pointing at cloud metadata fails revalidation',
    await assertPublicUrl('http://169.254.169.254/latest/meta-data/').then(() => false).catch(() => true),
    'this is the exact hop safeFetchImage re-checks on every redirect');

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.error(`  FAIL ${f}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
