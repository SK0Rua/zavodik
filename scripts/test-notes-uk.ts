/**
 * Unit checks for the Ukrainian note rendering (pure — no DB, no agent).
 *
 *   pnpm tsx scripts/test-notes-uk.ts
 *
 * Two things are worth pinning:
 *
 *   1. `parseAuditNotes` really covers the vocabulary `src/workers/audit.ts`
 *      writes. That file is the only producer of the field, so the coupling is
 *      exact and a new template there without a rule here would silently print
 *      English again. The cases below are real strings taken from the Patras
 *      campaign's `website_audits` rows.
 *   2. Nothing in the translation path can DROP a note. A gap or a segment that
 *      matches no rule must reach the reader as the agent wrote it; showing
 *      nothing would read as "the factory found no problem", which is the one
 *      wrong answer.
 */
import assert from 'node:assert/strict';
import { parseAuditNotes, hasUntranslatedAuditNotes } from '../ui/lib/auditNotes.js';
import { softGapText, isSoftGapTranslated } from '../ui/lib/criticNotes.js';
import { isCyrillic, SOFT_GAP_KEYS_UK } from '../src/lib/translateNotes.js';

let passed = 0;
function ok(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`✅ ${name}`); } catch (err) {
    console.error(`❌ ${name}\n   ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

/** Every segment must render as Cyrillic — i.e. no rule was missed. */
function allUkrainian(raw: string) {
  const segs = parseAuditNotes(raw);
  assert.ok(segs.length > 0, 'no segments parsed');
  for (const s of segs) {
    assert.ok(isCyrillic(s.text, 0.3), `left untranslated: "${s.original}" -> "${s.text}"`);
  }
  return segs;
}

// ── real rows from the Patras campaign ──────────────────────────────────────
ok('slow render + console errors', () => {
  const segs = allUkrainian('slow render (6.4s to settle) | console_errors=4');
  assert.match(segs[0]!.text, /6\.4/);      // the measurement survives
  assert.equal(segs[0]!.severe, true);
  assert.match(segs[1]!.text, /4/);
});

ok('dated signals, comma-separated inside one segment', () => {
  const segs = allUkrainian('dated: 4 layout tables | generator=WordPress 6.9.4');
  assert.match(segs[0]!.text, /4/);
  assert.match(segs[1]!.text, /WordPress 6\.9\.4/); // generator string verbatim
});

ok('several dated signals at once', () => {
  const segs = allUkrainian('dated: no viewport meta, mobile horizontal overflow, thin content (54 chars)');
  assert.match(segs[0]!.text, /viewport/);
  assert.match(segs[0]!.text, /54/);
});

ok('social / directory profile only, url kept intact', () => {
  const url = 'https://www.instagram.com/beautify_patra?igsh=bHVuMnd3ZG55dml4&utm_source=qr';
  const segs = parseAuditNotes(`social profile only: ${url}`);
  assert.equal(segs.length, 1);
  assert.ok(segs[0]!.text.includes(url), 'url was mangled');
  const dir = parseAuditNotes('directory/booking profile only: http://www.treatwell.gr/katasthma/eu-skin');
  assert.ok(dir[0]!.text.includes('treatwell.gr/katasthma/eu-skin'));
});

ok('hard console errors are marked severe', () => {
  const segs = parseAuditNotes('console_errors=12 (hard=3)');
  assert.equal(segs[0]!.severe, true);
  assert.match(segs[0]!.text, /12/);
  assert.match(segs[0]!.text, /3/);
  assert.equal(parseAuditNotes('console_errors=4')[0]!.severe, false);
});

ok('contradiction from the real run', () => {
  const segs = allUkrainian(
    'CONTRADICTION: owned website renders well but enrichment extracted zero services from it',
  );
  assert.equal(segs[0]!.severe, true);
});

ok('every decideVerdict note has a rule', () => {
  allUkrainian('no endpoint rendered');
  allUkrainian('no working https endpoint');
  allUkrainian('page rendered empty after settle (20 chars, 0 images, 2 js errors)');
  allUkrainian('dated: no media queries');
  allUkrainian('dated: flash object');
  allUkrainian('dated: dated generator (WordPress 3.1)');
});

ok('an unknown segment is kept, not dropped', () => {
  const segs = parseAuditNotes('some future template we have not seen');
  assert.equal(segs.length, 1);
  assert.equal(segs[0]!.text, 'some future template we have not seen');
  assert.equal(hasUntranslatedAuditNotes(segs), true);
  assert.equal(hasUntranslatedAuditNotes(parseAuditNotes('generator=WordPress 7.1')), false);
});

ok('empty notes parse to nothing rather than a blank bullet', () => {
  assert.deepEqual(parseAuditNotes(null), []);
  assert.deepEqual(parseAuditNotes('   '), []);
});

// ── soft gaps ───────────────────────────────────────────────────────────────
ok('a stored translation wins over the English patterns', () => {
  const greek = 'Δεν εντοπίστηκε επίσημος ιστότοπος της επιχείρησης στα στοιχεία.';
  assert.equal(softGapText(greek, 'Офіційного сайту в даних не знайдено.'), 'Офіційного сайту в даних не знайдено.');
  // ...and without one, the Greek is shown as the agent wrote it
  assert.equal(softGapText(greek), greek);
  assert.equal(isSoftGapTranslated(greek), false);
  assert.equal(isSoftGapTranslated(greek, 'Офіційного сайту не знайдено.'), true);
});

ok('code-side gap keys never need an agent', () => {
  for (const key of Object.keys(SOFT_GAP_KEYS_UK)) {
    const text = softGapText(key);
    assert.ok(isCyrillic(text), `${key} rendered as "${text}"`);
    assert.equal(isSoftGapTranslated(key), true);
  }
});

ok('the English fallback patterns still fire', () => {
  assert.equal(softGapText('No email address present in the evidence.'), 'не знайшли email');
  assert.equal(isSoftGapTranslated('No email address present in the evidence.'), true);
});

ok('long text is shortened but never emptied', () => {
  const long = `Дуже довга нотатка. ${'слово '.repeat(60)}`;
  const out = softGapText('x', long);
  assert.ok(out.length <= 111, `too long: ${out.length}`);
  assert.ok(out.endsWith('…'));
});

// ── the Cyrillic gate that decides whether a model is called at all ─────────
ok('isCyrillic separates the three languages in play', () => {
  assert.equal(isCyrillic('Не знайшли email на сайті'), true);   // Latin word inside UA
  assert.equal(isCyrillic('Δεν βρέθηκε διεύθυνση email'), false);
  assert.equal(isCyrillic('No email address found'), false);
  assert.equal(isCyrillic('logo_missing'), false);
  assert.equal(isCyrillic('12:00-18:00'), false);                 // no letters at all
});

console.log(`\n${passed} note-rendering checks passed`);
