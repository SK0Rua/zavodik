/**
 * Pure-function tests for stages 3, 5 and 8 (no DB, no network, no agent).
 * These lock the RULES, so a later refactor cannot quietly change who gets
 * rejected or what counts as production-ready.
 */
import { decideFastQualification } from '../src/workers/fastQualify.js';
import {
  autoStageAllows, discoveryFilterReasons, normalizeAutoStage,
  normalizeDiscoveryFilter,
} from '../src/orchestrator/campaignFlow.js';
import { extractDomain } from '../src/workers/normalize.js';
import { cityVerdict, noSiteShare } from '../src/lib/cityAssessment.js';
import { evaluateReadiness } from '../src/workers/readiness.js';
import { dimsFromBuffer, upsizeGoogleImage } from '../src/workers/assets.js';
import { parseGosomCsv, findRecord } from '../src/enrichment/gosomEvidence.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const t = (label: string, cond: boolean, extra?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`, extra ?? ''); }
};
const base = {
  name: 'Nice Nails', category: 'Ινστιτούτο αισθητικής', businessStatus: 'OPERATIONAL',
  normalizedPhone: '302610223344', hasContact: true, rating: 4.8, reviewCount: 100, blockedByDnc: false,
};

console.log('# stage 3: fast qualification');
t('healthy salon prequalifies', decideFastQualification(base).verdict === 'prequalified');
t('do_not_contact rejects', decideFastQualification({ ...base, blockedByDnc: true }).verdict === 'rejected');
t('permanently closed rejects', decideFastQualification({ ...base, businessStatus: 'CLOSED_PERMANENTLY' }).verdict === 'rejected');
t('known chain rejects', decideFastQualification({ ...base, name: 'Hondos Center Patras' }).verdict === 'rejected');
t('pharmacy category rejects', decideFastQualification({ ...base, category: 'Φαρμακείο' }).verdict === 'rejected');
t('restaurant category rejects', decideFastQualification({ ...base, category: 'Εστιατόριο' }).verdict === 'rejected');
t('no phone AND no contact rejects', decideFastQualification({ ...base, normalizedPhone: null, hasContact: false }).verdict === 'rejected');
t('no phone but has contact -> needs_review', decideFastQualification({ ...base, normalizedPhone: null }).verdict === 'needs_review');
t('franchise marker -> needs_review', decideFastQualification({ ...base, name: 'Beauty franchise Patras' }).verdict === 'needs_review');
t('very few reviews -> needs_review', decideFastQualification({ ...base, reviewCount: 1 }).verdict === 'needs_review');
t('poor rating with volume -> needs_review', decideFastQualification({ ...base, rating: 2.9, reviewCount: 50 }).verdict === 'needs_review');
t('rejection beats needs_review', decideFastQualification({ ...base, reviewCount: 1, blockedByDnc: true }).verdict === 'rejected');
t('reason is always recorded', decideFastQualification({ ...base, blockedByDnc: true }).reasons.includes('do_not_contact'));

console.log('\n# discovery filter (campaign-level, applied in stage 3)');
const noSite = { websiteNone: true, minRating: null, minReviews: null, requireContact: false };
t('empty filter passes a healthy salon', decideFastQualification({ ...base }).verdict === 'prequalified');
t('websiteNone rejects a business WITH its own site',
  decideFastQualification({ ...base, hasOwnSite: true, filter: normalizeDiscoveryFilter(noSite) }).verdict === 'rejected');
t('websiteNone passes a business without a site',
  decideFastQualification({ ...base, hasOwnSite: false, filter: normalizeDiscoveryFilter(noSite) }).verdict === 'prequalified');
t('has_own_site reason is recorded',
  decideFastQualification({ ...base, hasOwnSite: true, filter: normalizeDiscoveryFilter(noSite) }).reasons.includes('filter:has_own_site'));
t('minReviews rejects below threshold',
  decideFastQualification({ ...base, reviewCount: 2, filter: normalizeDiscoveryFilter({ minReviews: 5 }) }).verdict === 'rejected');
t('minRating rejects only with enough reviews behind it',
  decideFastQualification({ ...base, rating: 3.0, reviewCount: 10, filter: normalizeDiscoveryFilter({ minRating: 4 }) }).verdict === 'rejected');
t('minRating spares a low-rated place with too few reviews',
  decideFastQualification({ ...base, rating: 3.0, reviewCount: 2, filter: normalizeDiscoveryFilter({ minRating: 4, minReviews: null }) }).reasons.every((r) => !r.startsWith('filter:below_min_rating')));
t('requireContact rejects a business with no way to reach it',
  decideFastQualification({ ...base, normalizedPhone: null, hasContact: false, filter: normalizeDiscoveryFilter({ requireContact: true }) }).reasons.includes('filter:no_contact'));
t('discoveryFilterReasons is pure and returns tokens',
  discoveryFilterReasons(normalizeDiscoveryFilter(noSite), { hasOwnSite: true, hasContact: true, rating: 5, reviewCount: 9 }).includes('filter:has_own_site'));

console.log('\n# extractDomain skip-list (msg.me / choiceqr etc.)');
t('owned domain is kept', extractDomain('https://nicenails.gr/book') === 'nicenails.gr');
t('built-in directory returns null', extractDomain('https://instagram.com/nicenails') === null);
t('extra skip domain -> not an owned site', extractDomain('https://msg.me/nicenails', ['msg.me', 'choiceqr.com']) === null);
t('subdomain of a skip domain -> null', extractDomain('https://x.choiceqr.com/menu', ['msg.me', 'choiceqr.com']) === null);
t('a domain merely CONTAINING a skip token is kept', extractDomain('https://notchoiceqr.com', ['choiceqr.com']) === 'notchoiceqr.com');

console.log('\n# stop-point ladder (auto_stage)');
t('discover blocks enrich', autoStageAllows('discover', 'enrich') === false);
t('discover allows fast-qualify', autoStageAllows('discover', 'fast-qualify') === true);
t('enrich allows enrich', autoStageAllows('enrich', 'enrich') === true);
t('enrich blocks the build', autoStageAllows('enrich', 'content-and-design') === false);
t('build allows the build', autoStageAllows('build', 'content-and-design') === true);
t('build allows enrich', autoStageAllows('build', 'enrich') === true);
t('approval is never gated by stop-point', autoStageAllows('discover', 'request-approval') === true);
t('unknown auto_stage falls back to build', normalizeAutoStage('nonsense') === 'build');

console.log('\n# city assessment verdict');
t('nothing found -> skip', cityVerdict({ found: 0, noSite: 0 }) === 'skip');
t('many leads, mostly no site -> go', cityVerdict({ found: 30, noSite: 18 }) === 'go');
t('many leads but almost all have sites -> skip', cityVerdict({ found: 30, noSite: 3 }) === 'skip');
t('too few leads -> skip', cityVerdict({ found: 4, noSite: 4 }) === 'skip');
t('middling -> maybe', cityVerdict({ found: 10, noSite: 3 }) === 'maybe');
t('no-site share is a ratio', Math.abs(noSiteShare({ found: 20, noSite: 5 }) - 0.25) < 1e-9);
t('share of nothing is zero, not NaN', noSiteShare({ found: 0, noSite: 0 }) === 0);

console.log('\n# stage 8: readiness gate');
const sourced = (key: string, n: number) => Array.from({ length: n }, () => ({ key, verified: true, sourceId: 1 }));
const fullPackage = {
  facts: [...sourced('service', 4), ...sourced('review', 3), { key: 'identity.description', verified: true, sourceId: 1 }],
  contacts: [{ channel: 'phone', verified: true }],
  assets: [
    { intendedUsage: 'hero', width: 1600, height: 1000, aiGenerated: false },
    { intendedUsage: 'gallery', width: 900, height: 1200, aiGenerated: false },
    { intendedUsage: 'gallery', width: 1200, height: 900, aiGenerated: false },
  ],
};
t('complete package has no gaps', evaluateReadiness(fullPackage).gaps.length === 0, evaluateReadiness(fullPackage).gaps);
t('2 services -> services_min3', evaluateReadiness({ ...fullPackage, facts: [...sourced('service', 2), ...sourced('review', 3), { key: 'identity.description', verified: true, sourceId: 1 }] }).gaps.includes('services_min3'));
t('unsourced facts do not count', evaluateReadiness({ ...fullPackage, facts: [
  ...Array.from({ length: 5 }, () => ({ key: 'service', verified: true, sourceId: null })),
  ...sourced('review', 3), { key: 'identity.description', verified: true, sourceId: 1 }] }).gaps.includes('services_min3'));
t('website-only contact -> verified_contact gap', evaluateReadiness({ ...fullPackage, contacts: [{ channel: 'website', verified: true }] }).gaps.includes('verified_contact'));
t('AI assets do NOT satisfy assets_min3', evaluateReadiness({ ...fullPackage, assets: fullPackage.assets.map((a) => ({ ...a, aiGenerated: true })) }).gaps.includes('assets_min3'));
t('AI assets do NOT satisfy hero_or_logo', evaluateReadiness({ ...fullPackage, assets: fullPackage.assets.map((a) => ({ ...a, aiGenerated: true })) }).gaps.includes('hero_or_logo'));
t('tiny images -> hero_or_logo gap', evaluateReadiness({ ...fullPackage, assets: [
  { intendedUsage: 'gallery', width: 300, height: 200, aiGenerated: false },
  { intendedUsage: 'gallery', width: 320, height: 240, aiGenerated: false },
  { intendedUsage: 'gallery', width: 300, height: 300, aiGenerated: false }] }).gaps.includes('hero_or_logo'));
t('a small logo still satisfies hero_or_logo', !evaluateReadiness({ ...fullPackage, assets: [
  { intendedUsage: 'logo', width: 200, height: 120, aiGenerated: false },
  { intendedUsage: 'gallery', width: 300, height: 200, aiGenerated: false },
  { intendedUsage: 'gallery', width: 320, height: 240, aiGenerated: false }] }).gaps.includes('hero_or_logo'));
t('no reviews -> review_context gap', evaluateReadiness({ ...fullPackage, facts: [...sourced('service', 4), { key: 'identity.description', verified: true, sourceId: 1 }] }).gaps.includes('review_context'));
t('no identity -> identity gap', evaluateReadiness({ ...fullPackage, facts: [...sourced('service', 4), ...sourced('review', 3)] }).gaps.includes('identity'));

console.log('\n# stage 5: image header parsing');
// 1x1 PNG and a JPEG SOF0 header, byte-exact
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000004d2000003520806000000', 'hex');
t('PNG dimensions', dimsFromBuffer(png).width === 1234 && dimsFromBuffer(png).height === 850, dimsFromBuffer(png));
const jpeg = Buffer.concat([Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'), Buffer.from('ffc000110800f0014003012200021101031101', 'hex')]);
t('JPEG dimensions', dimsFromBuffer(jpeg).width === 320 && dimsFromBuffer(jpeg).height === 240, dimsFromBuffer(jpeg));
const gif = Buffer.from('474946383961' + '4001' + 'f000' + '0000000000', 'hex');
t('GIF dimensions', dimsFromBuffer(gif).width === 320 && dimsFromBuffer(gif).height === 240, dimsFromBuffer(gif));
t('unknown format -> nulls (asset kept)', dimsFromBuffer(Buffer.from('not an image at all padding padding')).width === null);
t('google thumbnail upsized', upsizeGoogleImage('https://lh3.googleusercontent.com/x=w408-h272-k-no') === 'https://lh3.googleusercontent.com/x=s1600');
t('non-google url untouched', upsizeGoogleImage('https://salon.gr/hero.jpg') === 'https://salon.gr/hero.jpg');

const csvPath = process.argv[2];
if (csvPath) {
  console.log('\n# gosom evidence parsing (real campaign CSV)');
  const recs = parseGosomCsv(readFileSync(csvPath, 'utf8'));
  t(`parsed ${recs.length} records`, recs.length >= 30);
  t('every record has a title', recs.every((r) => r.title.length > 0));
  t('hours parsed for most', recs.filter((r) => r.hours).length >= recs.length * 0.9);
  t('reviews parsed', recs.reduce((a, r) => a + r.reviews.length, 0) > 200);
  t('images parsed', recs.reduce((a, r) => a + r.images.length, 0) > 100);
  t('street view filtered out of images', !recs.some((r) => r.images.some((i) => /streetviewpixels/.test(i.url))));
  t('about attributes parsed', recs.filter((r) => r.about.length).length >= recs.length * 0.9);
  const found = findRecord(recs, { placeId: null, listingUrl: null, normalizedPhone: null, name: recs[0].title });
  t('findRecord matches by name', found?.title === recs[0].title);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
