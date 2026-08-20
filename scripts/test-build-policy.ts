/**
 * Build-policy unit checks (Roman's rule: build for businesses WITHOUT a site first).
 *
 * Pure decision logic, so this runs with no DB and no queue. It covers the two
 * things that would silently waste subscription hours if they broke: who the
 * factory auto-builds for, and in what order the build queue drains.
 */
import assert from 'node:assert/strict';
import {
  buildJobPriority, isAutoBuildEligible, normalizeBuildPolicy, NO_SITE_VERDICTS,
} from '../src/orchestrator/buildPolicy.js';

let passed = 0;
function ok(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`✅ ${label}`);
}

// ── policy normalisation ────────────────────────────────────────────────────
ok('unknown / null policy falls back to no_site_only', () => {
  assert.equal(normalizeBuildPolicy(null), 'no_site_only');
  assert.equal(normalizeBuildPolicy(undefined), 'no_site_only');
  assert.equal(normalizeBuildPolicy('nonsense'), 'no_site_only');
  assert.equal(normalizeBuildPolicy('all'), 'all');
  assert.equal(normalizeBuildPolicy('manual'), 'manual');
});

// ── no_site_only ────────────────────────────────────────────────────────────
ok('no_site_only builds for no_website / broken', () => {
  for (const verdict of NO_SITE_VERDICTS) {
    assert.equal(
      isAutoBuildEligible({ policy: 'no_site_only', latestVerdict: verdict }).eligible,
      true,
      `${verdict} should be eligible`,
    );
  }
});

ok('no_site_only refuses businesses that already have a site', () => {
  for (const verdict of ['working_good', 'outdated', 'working_with_https_issue']) {
    assert.equal(
      isAutoBuildEligible({ policy: 'no_site_only', latestVerdict: verdict }).eligible,
      false,
      `${verdict} should NOT be eligible`,
    );
  }
});

ok('no audit is NOT eligible — "we never looked" is not "there is no site"', () => {
  assert.equal(isAutoBuildEligible({ policy: 'no_site_only', latestVerdict: null }).eligible, false);
  assert.equal(isAutoBuildEligible({ policy: 'no_site_only', latestVerdict: undefined }).eligible, false);
});

// ── all / manual ────────────────────────────────────────────────────────────
ok('policy "all" ignores the verdict entirely', () => {
  assert.equal(isAutoBuildEligible({ policy: 'all', latestVerdict: 'working_good' }).eligible, true);
  assert.equal(isAutoBuildEligible({ policy: 'all', latestVerdict: null }).eligible, true);
});

ok('policy "manual" never auto-builds', () => {
  assert.equal(isAutoBuildEligible({ policy: 'manual', latestVerdict: 'no_website' }).eligible, false);
});

// ── priority ────────────────────────────────────────────────────────────────
ok('verdict dominates score: a weak no_website beats a strong working_good', () => {
  const weakNoSite = buildJobPriority({ latestVerdict: 'no_website', score: 40 });
  const strongHasSite = buildJobPriority({ latestVerdict: 'working_good', score: 100 });
  assert.ok(weakNoSite > strongHasSite, `${weakNoSite} should beat ${strongHasSite}`);
});

ok('verdict tiers order no_website > broken > other', () => {
  const p = (v: string) => buildJobPriority({ latestVerdict: v, score: 50 });
  assert.ok(p('no_website') > p('broken'));
  assert.ok(p('broken') > p('outdated'));
});

// `social_only` was merged into `no_website` (Roman, 2026-08-19). A stale row
// carrying the retired value must not be treated as a top-tier lead by accident.
ok('the retired social_only verdict has no tier of its own', () => {
  assert.equal(
    buildJobPriority({ latestVerdict: 'social_only', score: 50 }),
    buildJobPriority({ latestVerdict: 'working_good', score: 50 }),
  );
  assert.equal(isAutoBuildEligible({ policy: 'no_site_only', latestVerdict: 'social_only' }).eligible, false);
});

ok('within one tier, higher score runs first', () => {
  assert.ok(
    buildJobPriority({ latestVerdict: 'no_website', score: 83 })
    > buildJobPriority({ latestVerdict: 'no_website', score: 70 }),
  );
});

ok('a null score does not throw and sorts last in its tier', () => {
  assert.equal(
    buildJobPriority({ latestVerdict: 'no_website', score: null }),
    buildJobPriority({ latestVerdict: 'no_website', score: 0 }),
  );
});

ok('score is clamped, so a rogue value cannot jump a tier', () => {
  const rogue = buildJobPriority({ latestVerdict: 'broken', score: 9999 });
  const above = buildJobPriority({ latestVerdict: 'no_website', score: 0 });
  assert.ok(rogue < above, `${rogue} must stay below the no_website tier floor ${above}`);
});

console.log(`\n🏭 BUILD POLICY TESTS PASSED (${passed})`);
