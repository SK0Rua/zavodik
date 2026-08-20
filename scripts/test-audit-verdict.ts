/**
 * Audit verdict unit checks (`decideVerdict`, pure — no browser, no DB).
 *
 * These exist because of one real misclassification: TRENDY HAIR (2026-08-20).
 * https://trendyhair.gr/ is a live WordPress shop that paints its text with JS
 * after ~3s. The audit measured it at `domcontentloaded` + 2.5s, saw 54
 * characters, and returned `broken`. `broken` counts as "no site" for the build
 * policy, so a business WITH a good site landed under «Без сайту» and a demo
 * build was started for it — subscription hours spent on a lead that was never
 * a lead.
 *
 * The rule the tests pin down: **thin text alone can never be `broken`.**
 */
import assert from 'node:assert/strict';
import { decideVerdict } from '../src/workers/audit.js';

let passed = 0;
function ok(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`✅ ${label}`);
}

/** A healthy modern page; each test overrides only what it is about. */
const base = {
  reachable: true,
  httpsWorks: true,
  textLength: 4_000,
  imageCount: 12,
  hardConsoleErrors: 0,
  datedSignals: [] as string[],
};

// ── the regression itself ───────────────────────────────────────────────────
ok('TRENDY case: a 200 page with thin text is NOT broken', () => {
  // Exactly what the old code saw before the settle loop existed: 54 chars.
  // It has images and its own JS is not throwing, so the site is alive.
  const { verdict } = decideVerdict({ ...base, textLength: 54, imageCount: 6 });
  assert.notEqual(verdict, 'broken', 'thin text must never alone produce broken');
  assert.equal(verdict, 'outdated', 'thin content is a weak site, decided by Roman not the router');
});

ok('thin text on a page with no images is still not broken while its JS is fine', () => {
  const { verdict } = decideVerdict({ ...base, textLength: 40, imageCount: 0, hardConsoleErrors: 0 });
  assert.equal(verdict, 'outdated');
});

// ── when broken IS correct ──────────────────────────────────────────────────
ok('no reachable endpoint is broken', () => {
  assert.equal(decideVerdict({ ...base, reachable: false }).verdict, 'broken');
});

ok('broken needs all three: almost no text AND no images AND hard js errors', () => {
  assert.equal(
    decideVerdict({ ...base, textLength: 20, imageCount: 0, hardConsoleErrors: 3 }).verdict,
    'broken',
  );
  // Any one of the three failing to hold saves the page from `broken`.
  assert.notEqual(
    decideVerdict({ ...base, textLength: 20, imageCount: 1, hardConsoleErrors: 3 }).verdict,
    'broken',
  );
  assert.notEqual(
    decideVerdict({ ...base, textLength: 120, imageCount: 0, hardConsoleErrors: 3 }).verdict,
    'broken',
  );
});

// ── the rest of the ladder is unchanged ─────────────────────────────────────
ok('no https endpoint → working_with_https_issue, ahead of dated signals', () => {
  const { verdict } = decideVerdict({ ...base, httpsWorks: false, datedSignals: ['no viewport meta'] });
  assert.equal(verdict, 'working_with_https_issue');
});

ok('dated signals → outdated, clean modern page → working_good', () => {
  assert.equal(decideVerdict({ ...base, datedSignals: ['flash object'] }).verdict, 'outdated');
  assert.equal(decideVerdict(base).verdict, 'working_good');
});

ok('an empty-ish page is reported with its numbers, so the note is checkable', () => {
  const { note } = decideVerdict({ ...base, textLength: 20, imageCount: 0, hardConsoleErrors: 2 });
  assert.match(String(note), /20 chars/);
  assert.match(String(note), /0 images/);
});

console.log(`\n${passed} audit-verdict checks passed`);
