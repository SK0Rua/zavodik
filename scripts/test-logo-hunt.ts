/**
 * Unit tests for logo hunting and photo mining — pure functions, no network,
 * no database, no browser.
 *
 * The cases are not invented. Every "must reject" here is a row that is IN the
 * production database right now, tagged `intended_usage='logo'` by the regex
 * this scorer replaces: The Parlor's eight partner brands, Laser Beauty's
 * WordPress banner, Elegant Hairdesign's third-party booking-widget mark. If a
 * future change makes the scorer accept one of them again, that is the exact
 * regression that put a competitor's logo on a salon's demo.
 */
import {
  fileStem, largestFromSrcset, logoCandidatesFromHtml, rankLogoCandidates,
  resolveUrl, scoreLogoCandidate, sectionAt, type LogoCandidate,
} from '../src/enrichment/logoHunt.js';
import {
  baseImageName, isStockOrFurniture, photoCandidatesFromHtml,
} from '../src/enrichment/photoHunt.js';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

function candidate(over: Partial<LogoCandidate> & { url: string }): LogoCandidate {
  return {
    via: '<img>', position: 'body', width: null, height: null,
    alt: '', attrs: '', svg: false, ...over,
  };
}

console.log('\n── logo scoring: real production rows ──────────────────────────');

// ── 1..8: the eight partner brands currently mis-tagged on The Parlor ───────
const parlorPartners = [
  'https://theparlorhair.gr/wp-content/uploads/2024/02/loreal_logo.png',
  'https://theparlorhair.gr/wp-content/uploads/2024/02/wella_logo.png',
  'https://theparlorhair.gr/wp-content/uploads/2024/02/farcom_logo.jpg',
  'https://theparlorhair.gr/wp-content/uploads/2024/03/glossco_logo.png',
  'https://theparlorhair.gr/wp-content/uploads/2024/03/tangleteezer_logo.png',
  'https://theparlorhair.gr/wp-content/uploads/2024/03/invisiblebobble_logo.png',
  'https://theparlorhair.gr/wp-content/uploads/2024/02/saryna-key_logo.png',
  'https://theparlorhair.gr/wp-content/uploads/2024/02/cndc_logo.png',
];
const parlorOwn = candidate({
  url: 'https://theparlorhair.gr/wp-content/uploads/2024/02/logo.png',
  position: 'header', width: 458, height: 458, alt: 'The Parlor',
  attrs: 'custom-logo',
});

for (const url of parlorPartners) {
  const c = candidate({ url, position: 'partner_strip', width: 300, height: 170, alt: '' });
  const { score } = scoreLogoCandidate(c);
  const own = scoreLogoCandidate(parlorOwn).score;
  check(`partner "${fileStem(url)}" scores below the salon's own logo`, score < own, `${score} vs ${own}`);
}

// ── 9: the salon's own mark clears the acceptance floor ────────────────────
{
  const { score } = scoreLogoCandidate(parlorOwn);
  check('The Parlor own logo.png clears the floor', score >= 20, `score=${score}`);
}

// ── 10: ranking the whole Parlor set returns ONLY the real logo ────────────
{
  const all = [
    ...parlorPartners.map((url) => candidate({ url, position: 'partner_strip', width: 300, height: 170 })),
    parlorOwn,
  ];
  const ranked = rankLogoCandidates(all);
  check('ranking The Parlor keeps only the salon logo',
    ranked.length === 1 && ranked[0]!.url.endsWith('/logo.png'),
    `kept ${ranked.length}: ${ranked.map((r) => fileStem(r.url)).join(', ')}`);
}

// ── 11: Laser Beauty's WordPress promo banner is rejected ─────────────────
{
  const banner = candidate({
    url: 'https://laser-beauty.gr/wp-content/uploads/2022/05/e-banner.png',
    position: 'body', width: 712, height: 193,
  });
  const ranked = rankLogoCandidates([banner]);
  check('Laser Beauty e-banner.png is not accepted as a logo', ranked.length === 0,
    `score=${scoreLogoCandidate(banner).score}`);
}

// ── 12: Elegant Hairdesign's third-party booking-widget mark is rejected ──
{
  const widget = candidate({
    url: 'https://i.ibb.co/hJc91KL0/margilogo.webp',
    position: 'body', width: 640, height: 314,
  });
  const ranked = rankLogoCandidates([widget], { siteHost: 'eleganthairdesign.gr' });
  check('third-party booking widget mark is not accepted', ranked.length === 0,
    `score=${scoreLogoCandidate(widget, { siteHost: 'eleganthairdesign.gr' }).score}`);
}

console.log('\n── logo scoring: signal weights ────────────────────────────────');

// ── 13: a declaration outranks an ANONYMOUS body image by a wide margin ───
{
  const declared = candidate({ url: 'https://x.gr/apple-touch-icon.png', via: 'link rel="apple-touch-icon"', position: 'declared', width: 180, height: 180 });
  const anonymous = candidate({ url: 'https://x.gr/img/brand-thing.png', position: 'body', width: 400, height: 100 });
  check('a declared mark outranks an anonymous body image',
    scoreLogoCandidate(declared).score > scoreLogoCandidate(anonymous).score);
}

// ── 14: SVG is preferred over the same mark as a raster ───────────────────
{
  const svg = candidate({ url: 'https://x.gr/logo.svg', position: 'header', svg: true, width: 300, height: 90 });
  const png = candidate({ url: 'https://x.gr/logo.png', position: 'header', width: 300, height: 90 });
  check('SVG mark outranks the identical PNG',
    scoreLogoCandidate(svg).score > scoreLogoCandidate(png).score);
}

// ── 15: a 16px favicon never wins over a real mark ────────────────────────
{
  const tiny = candidate({ url: 'https://x.gr/favicon.ico', via: 'link rel="icon"', position: 'declared', width: 16, height: 16 });
  const real = candidate({ url: 'https://x.gr/logo.png', position: 'header', width: 420, height: 120 });
  check('16px favicon scores below a real header mark',
    scoreLogoCandidate(tiny).score < scoreLogoCandidate(real).score);
}

// ── 16: a salon genuinely NAMED after a stocked brand can still win ───────
{
  const own = candidate({
    url: 'https://wella-studio-patras.gr/logo.svg',
    position: 'declared', via: 'og:logo', svg: true, width: 500, height: 160,
    attrs: 'site-logo',
  });
  check('a salon named after a stocked brand is not hard-rejected',
    scoreLogoCandidate(own).score >= 20, `score=${scoreLogoCandidate(own).score}`);
}

// ── 17: an extreme banner ratio is penalised ──────────────────────────────
{
  const strip = candidate({ url: 'https://x.gr/logo-strip.png', position: 'header', width: 1600, height: 90 });
  const mark = candidate({ url: 'https://x.gr/logo.png', position: 'header', width: 400, height: 130 });
  check('1600x90 strip scores below a 400x130 mark',
    scoreLogoCandidate(strip).score < scoreLogoCandidate(mark).score);
}

// ── 18: UI furniture named "logo" is rejected ─────────────────────────────
{
  const sprite = candidate({ url: 'https://x.gr/assets/logo-sprite.png', position: 'body', width: 512, height: 512 });
  check('logo-sprite.png is rejected', rankLogoCandidates([sprite]).length === 0);
}

// ── 19: nothing convincing means an EMPTY result, not a best guess ────────
{
  const junk = [
    candidate({ url: 'https://x.gr/images/banner-summer.jpg', position: 'body', width: 1200, height: 300 }),
    candidate({ url: 'https://x.gr/images/photo1.jpg', position: 'body', width: 800, height: 600 }),
  ];
  check('no plausible mark yields no logo at all', rankLogoCandidates(junk).length === 0);
}

// ── 20: the same file in header and footer collapses to one entry ─────────
{
  const dup = [
    candidate({ url: 'https://x.gr/logo.png', position: 'footer', width: 300, height: 100 }),
    candidate({ url: 'https://x.gr/logo.png', position: 'header', width: 300, height: 100 }),
  ];
  const ranked = rankLogoCandidates(dup);
  check('duplicate URL collapses to one, keeping the header hit',
    ranked.length === 1 && ranked[0]!.position === 'header');
}

console.log('\n── HTML extraction ────────────────────────────────────────────');

const SITE_HTML = `<!doctype html><html><head>
<meta property="og:image" content="https://sal.gr/wp-content/uploads/hero.jpg">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" sizes="32x32" href="/favicon-32.png">
<script type="application/ld+json">{"@type":"LocalBusiness","logo":{"url":"https://sal.gr/brand/mark.svg"}}</script>
</head><body>
<header class="site-header"><a href="/"><img src="/wp-content/uploads/2024/logo.png" class="custom-logo" alt="Salon logo" width="420" height="120"></a></header>
<main>
  <img src="/wp-content/uploads/2024/gallery_01-1024x683.jpg" alt="haircut" width="1024" height="683">
  <img src="/wp-content/uploads/2024/gallery_01-300x200.jpg" alt="haircut" width="300" height="200">
  <img src="https://images.unsplash.com/photo-123" alt="stock" width="1600" height="900">
  <div style="background-image:url('/img/interior.jpg')"></div>
  <section class="partners">
    <img src="/brands/loreal_logo.png" width="300" height="170" alt="">
    <img src="/brands/wella_logo.png" width="300" height="170" alt="">
    <img src="/brands/farcom_logo.png" width="300" height="170" alt="">
  </section>
</main>
<footer class="site-footer"><img src="/wp-content/uploads/2024/logo.png" alt="logo" width="200" height="57"></footer>
</body></html>`;

{
  const cands = logoCandidatesFromHtml(SITE_HTML, 'https://sal.gr/');
  const ranked = rankLogoCandidates(cands, { siteHost: 'sal.gr' });
  check('extraction finds the schema.org declared mark',
    cands.some((c) => c.url === 'https://sal.gr/brand/mark.svg' && c.position === 'declared'));
  check('extraction finds the header custom-logo',
    cands.some((c) => c.url.endsWith('/2024/logo.png') && c.position === 'header'));
  check('extraction detects the 300x170 partner strip',
    cands.filter((c) => c.position === 'partner_strip').length === 3,
    `got ${cands.filter((c) => c.position === 'partner_strip').length}`);
  // The header `custom-logo` wins over the declared apple-touch-icon and the
  // schema.org SVG, and that is the RIGHT answer, not a scoring accident: it is
  // named exactly `logo`, it sits in the theme's dedicated logo slot inside the
  // home link, and it has a wordmark's aspect ratio. An `apple-touch-icon` is a
  // squared-off derivative made for a home screen, and a mark declared in
  // JSON-LD is frequently the same file at a different path. When all three are
  // present the one rendered in the header is the one the owner recognises.
  check('ranking picks the header custom-logo first',
    ranked[0]?.url === 'https://sal.gr/wp-content/uploads/2024/logo.png',
    `got ${ranked[0]?.url}`);
  check('the declared marks are the runners-up, not discarded',
    ranked.length === 2 && /mark\.svg|apple-touch-icon/.test(ranked[1]!.url),
    `runner-up ${ranked[1]?.url}`);
  check('no partner brand survives ranking',
    !ranked.some((c) => /loreal|wella|farcom/.test(c.url)));
}

{
  const photos = photoCandidatesFromHtml(SITE_HTML, 'https://sal.gr/', { origin: 'site' });
  const urls = photos.map((p) => p.url);
  check('photos keep the 1024 variant and drop the 300 one',
    urls.some((u) => u.includes('gallery_01-1024x683')) && !urls.some((u) => u.includes('gallery_01-300x200')));
  check('photos exclude the unsplash stock image',
    !urls.some((u) => u.includes('unsplash')));
  check('photos include the CSS background interior shot',
    urls.some((u) => u.endsWith('/img/interior.jpg')));
  check('photos exclude every logo and partner mark',
    !urls.some((u) => /logo|loreal|wella|farcom|favicon|apple-touch/.test(u)),
    urls.filter((u) => /logo/.test(u)).join(', '));
  check('og:image is offered as the hero',
    photos.some((p) => p.url.endsWith('/hero.jpg') && p.kind === 'hero'));
}

console.log('\n── helpers ────────────────────────────────────────────────────');

check('sectionAt finds header', sectionAt(SITE_HTML, SITE_HTML.indexOf('custom-logo')) === 'header');
check('sectionAt finds footer', sectionAt(SITE_HTML, SITE_HTML.lastIndexOf('<img src="/wp-content/uploads/2024/logo.png"')) === 'footer');
check('largestFromSrcset picks the widest', largestFromSrcset('a.png 300w, b.png 1200w, c.png 800w') === 'b.png');
check('largestFromSrcset handles x descriptors', largestFromSrcset('a.png 1x, b.png 2x') === 'b.png');
check('resolveUrl rejects data URIs', resolveUrl('data:image/png;base64,AAA', 'https://x.gr/') === null);
check('resolveUrl resolves relative paths', resolveUrl('/a/b.png', 'https://x.gr/page/') === 'https://x.gr/a/b.png');
check('fileStem strips directories and extension', fileStem('https://x.gr/a/b/My-Logo.PNG') === 'my-logo');
check('baseImageName collapses WordPress size variants',
  baseImageName('https://x.gr/u/photo-1024x683.jpg') === baseImageName('https://x.gr/u/photo-300x200.jpg'));
check('baseImageName collapses -scaled', baseImageName('https://x.gr/u/p-scaled.jpg') === '/u/p.jpg');
check('isStockOrFurniture catches unsplash', isStockOrFurniture('https://images.unsplash.com/photo-1'));
check('isStockOrFurniture catches theme assets', isStockOrFurniture('https://x.gr/wp-content/themes/astra/assets/img/x.png'));
check('isStockOrFurniture allows a real upload', !isStockOrFurniture('https://x.gr/wp-content/uploads/2024/salon.jpg'));

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 1 - 1 : 1);
