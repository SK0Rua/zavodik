/**
 * Unit checks for the agent-led social finder (no network, no DB, no agent).
 *
 * What is actually being tested here is the BOUNDARY: the agent is an untrusted
 * source of URLs, and `parseFinderCandidates` is the code that decides which of
 * its suggestions the pipeline will spend a page capture on. So the cases are
 * the ways an agent goes wrong — a post URL instead of a profile, a directory
 * listing, a mislabelled platform, the same page under two Facebook URL forms,
 * more leads than the cap allows — plus the real Laser Royal case it should get
 * right.
 *
 * Run: pnpm tsx scripts/test-social-finder.ts
 */
import {
  parseFinderCandidates, renderFinderBrief, SocialFinderResultSchema,
  type SocialFinderResult,
} from '../src/enrichment/socialFinderAgent.js';
import type { SocialTargetBusiness } from '../src/enrichment/socialDiscovery.js';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`, extra ?? ''); }
}

/** A candidate as the agent writes it, with the boilerplate filled in. */
function cand(url: string, confidence = 0.8, platform = 'instagram') {
  return {
    platform, url, confidence, why: 'test',
    signalsSeen: { phone: null, address: null, nameMatch: null },
  };
}

const LASER_ROYAL: SocialTargetBusiness = {
  id: 'e2e-laser-royal',
  name: 'Laser Royal Beauty PATRAS',
  city: 'Πάτρα',
  phone: '+30 261 027 2921',
  normalizedPhone: '302610272921',
  address: 'Κανακάρη 169Α, Πάτρα',
  domain: null,
  websiteUrl: null,
  category: 'Beauty salon',
};

console.log('# result schema');
{
  const ok = SocialFinderResultSchema.safeParse({
    candidates: [cand('https://www.instagram.com/laser_royal_patras')],
    notes: ['searched in Greek and Latin'],
  });
  check('a well-formed agent result validates', ok.success, ok.success ? '' : ok.error.message);

  // The schema is the only thing standing between a creative agent and the rest
  // of the pipeline, so the fields that carry meaning must be required.
  check('confidence above 1 is rejected',
    !SocialFinderResultSchema.safeParse({ candidates: [cand('https://www.instagram.com/x', 1.4)], notes: [] }).success);
  check('missing signalsSeen is rejected',
    !SocialFinderResultSchema.safeParse({
      candidates: [{ platform: 'instagram', url: 'https://www.instagram.com/x', confidence: 0.5, why: 'y' }],
      notes: [],
    }).success);
  check('a flood of candidates is rejected (max 12)',
    !SocialFinderResultSchema.safeParse({
      candidates: Array.from({ length: 13 }, (_, i) => cand(`https://www.instagram.com/h${i}`)),
      notes: [],
    }).success);
}

console.log('\n# parsing: what the agent suggests vs what code accepts');
{
  const result: SocialFinderResult = {
    candidates: [
      cand('https://www.instagram.com/laser_royal_patras/?hl=el', 0.9),
      // A post by someone else who tagged the salon — the exact false positive
      // the SERP path already learned to reject.
      cand('https://www.instagram.com/p/DbvxZI-MCaK/', 0.7),
      // A directory listing, not the business's own profile.
      cand('https://www.treatwell.gr/salon/laser-royal/', 0.6),
      cand('https://www.facebook.com/p/Laser-Royal-Beauty-100063552791835', 0.85, 'facebook'),
    ],
    notes: ['tried the phone number as a query'],
  };
  const { candidates, notes } = parseFinderCandidates(result, { maxCandidates: 8 });
  const urls = candidates.map((c) => c.url);

  check('the real profile survives', urls.includes('https://www.instagram.com/laser_royal_patras'), urls);
  check('query string is stripped (canonical URL)',
    urls.every((u) => !u.includes('?')), urls);
  check('an instagram POST is dropped', !urls.some((u) => u.includes('/p/Dbvx')), urls);
  check('a directory listing is dropped', !urls.some((u) => u.includes('treatwell')), urls);
  check('the facebook page survives', urls.some((u) => u.includes('facebook.com/p/Laser-Royal')), urls);
  check('drops are explained in notes', notes.some((n) => n.includes('treatwell')), notes);
  check('the agent never decides anything: no verdict field on a candidate',
    candidates.every((c) => !('verdict' in c) && !('confidence' in c)), candidates[0]);
  check('provenance records it came from the agent',
    candidates.every((c) => c.foundVia.every((v) => v.startsWith('agent'))), candidates.map((c) => c.foundVia));
}

console.log('\n# dedupe');
{
  // Facebook publishes one page as both `/p/<Slug>-<id>` and `/<id>`; an agent
  // reading two search results will hand back both. One page must yield one
  // candidate, or the business gets two contacts for the same Facebook page.
  const result: SocialFinderResult = {
    candidates: [
      cand('https://www.facebook.com/p/Laser-Royal-Beauty-100063552791835', 0.8, 'facebook'),
      cand('https://www.facebook.com/100063552791835', 0.6, 'facebook'),
      cand('https://www.instagram.com/laser_royal_patras', 0.9),
      cand('https://instagram.com/laser_royal_patras/', 0.5),
    ],
    notes: [],
  };
  const { candidates } = parseFinderCandidates(result, { maxCandidates: 8 });
  check('two facebook URL forms collapse to one candidate',
    candidates.filter((c) => c.platform === 'facebook').length === 1,
    candidates.map((c) => c.url));
  check('the same instagram handle collapses to one candidate',
    candidates.filter((c) => c.platform === 'instagram').length === 1,
    candidates.map((c) => c.url));
  check('both sightings are recorded on the surviving candidate',
    candidates.some((c) => c.foundVia.length === 2), candidates.map((c) => c.foundVia));
}

console.log('\n# ordering and the cap');
{
  // The cap exists because each kept lead costs a real page capture. When it
  // bites, the agent's own confidence decides who gets the budget.
  const result: SocialFinderResult = {
    candidates: [
      cand('https://www.instagram.com/low_one', 0.2),
      cand('https://www.instagram.com/high_one', 0.95),
      cand('https://www.instagram.com/mid_one', 0.6),
    ],
    notes: [],
  };
  const { candidates, notes } = parseFinderCandidates(result, { maxCandidates: 2 });
  check('the cap is honoured', candidates.length === 2, candidates.length);
  check('the most confident lead is kept',
    candidates[0].url.includes('high_one'), candidates.map((c) => c.url));
  check('the least confident lead is the one dropped',
    !candidates.some((c) => c.url.includes('low_one')), candidates.map((c) => c.url));
  check('the drop is on the record', notes.some((n) => n.includes('over the cap')), notes);
}

console.log('\n# platform label vs URL');
{
  // The URL is authoritative; a mislabel is worth a note but must not change
  // which capture path the candidate takes.
  const { candidates, notes } = parseFinderCandidates({
    candidates: [cand('https://www.tiktok.com/@laser_royal_patras', 0.7, 'instagram')],
    notes: [],
  }, { maxCandidates: 8 });
  check('the URL wins over the agent\'s label',
    candidates[0]?.platform === 'tiktok', candidates[0]);
  check('the mismatch is noted', notes.some((n) => n.includes('but the URL is')), notes);
}

console.log('\n# skipPlatforms');
{
  const { candidates } = parseFinderCandidates({
    candidates: [
      cand('https://www.instagram.com/laser_royal_patras', 0.9),
      cand('https://www.facebook.com/laserroyal', 0.8, 'facebook'),
    ],
    notes: [],
  }, { maxCandidates: 8, skipPlatforms: ['instagram'] });
  check('an already-verified platform is skipped',
    candidates.length === 1 && candidates[0].platform === 'facebook', candidates.map((c) => c.url));
}

console.log('\n# the brief the agent reads');
{
  const brief = renderFinderBrief(LASER_ROYAL, ['https://www.facebook.com/laserroyal']);
  check('carries the name', brief.includes('Laser Royal Beauty PATRAS'));
  check('carries the phone (the strongest query available)', brief.includes('+30 261 027 2921'));
  check('carries the address', brief.includes('Κανακάρη 169Α'));
  check('tells the agent what is already known', brief.includes('facebook.com/laserroyal'));
  check('does not leak the internal business id', !brief.includes(LASER_ROYAL.id), brief.slice(0, 200));

  const empty = renderFinderBrief({ ...LASER_ROYAL, address: null, phone: null }, []);
  check('missing fields are omitted, not rendered as null',
    !empty.toLowerCase().includes('null'), empty);
  check('says plainly when nothing is known yet',
    empty.includes('No profile is known yet'), empty);
}

console.log('\n# empty / degenerate agent output');
{
  const { candidates, notes } = parseFinderCandidates({ candidates: [], notes: ['found nothing'] }, { maxCandidates: 8 });
  check('an empty answer is handled, not thrown', candidates.length === 0 && notes.length === 0);

  const junk = parseFinderCandidates({
    candidates: [cand('not a url at all', 0.9), cand('https://instagram.com', 0.8)],
    notes: [],
  }, { maxCandidates: 8 });
  check('garbage URLs are dropped without throwing', junk.candidates.length === 0, junk.candidates);
  check('every drop is explained', junk.notes.length === 2, junk.notes);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
