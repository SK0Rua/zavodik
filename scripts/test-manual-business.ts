/**
 * Picking the right place out of a gosom lookup, and what a manual add is
 * still allowed to reject.
 *
 * Pure functions only — no gosom, no database. The risk this covers is a quiet
 * one: a search near a pin returns the neighbours too, and confidently adding
 * the wrong business is far worse than admitting we could not tell.
 */
import assert from 'node:assert/strict';
import { pickMatch, manualQualifyReasons } from '../src/orchestrator/manualBusinessService.js';
import type { RawCandidate } from '../src/discovery/candidate.js';

let passed = 0;

function check(label: string, run: () => void): void {
  run();
  passed++;
  console.log(`✅ ${label}`);
}

function candidate(name: string, lat: number | null, lng: number | null): RawCandidate {
  return {
    name,
    category: null,
    address: null,
    phone: null,
    email: null,
    websiteUrl: null,
    listingUrl: `https://maps.google.com/?q=${encodeURIComponent(name)}`,
    placeId: null,
    rating: null,
    reviewCount: null,
    lat,
    lng,
    rawObjectKey: 'raw/test',
    query: 'test',
  };
}

check('an exact name match wins over a closer neighbour', () => {
  const picked = pickMatch(
    [candidate('Susidnya Kavarnya', 50.9001, 34.8001), candidate('Coffee Room', 50.9100, 34.8100)],
    { name: 'Coffee Room', lat: 50.9000, lng: 34.8000 },
  );
  assert.equal(picked?.name, 'Coffee Room');
});

check('among same-name results the nearest to the pin wins', () => {
  const picked = pickMatch(
    [candidate('Coffee Room', 50.9500, 34.8500), candidate('Coffee Room', 50.9002, 34.8002)],
    { name: 'Coffee Room', lat: 50.9000, lng: 34.8000 },
  );
  assert.equal(picked?.lat, 50.9002);
});

check('an exact name on the other side of the world is NOT the place meant', () => {
  // Observed on the very first real link: searching "Coffeeman" near Sumy
  // returned the Coffeeman in Singapore — an exact name match, 8000km away,
  // which the matcher accepted because the name won before distance was ever
  // considered. A shared name is a coincidence, not an identity.
  const picked = pickMatch(
    [candidate('Coffeeman', 1.3521, 103.8198)],
    { name: 'Coffeeman', lat: 50.9077, lng: 34.7981 },
  );
  assert.equal(picked, null, 'a far-away namesake must be refused');
});

check('a named search refuses the neighbours rather than guessing', () => {
  // Nothing near the pin carries the name: adding the shop next door under the
  // name Roman typed is the one outcome worth failing for.
  const picked = pickMatch(
    [candidate('Some Other Cafe', 50.9001, 34.7982)],
    { name: 'Coffee Room', lat: 50.9, lng: 34.798 },
  );
  assert.equal(picked, null);
});

check('a candidate with no coordinates is not accepted against a known pin', () => {
  // We cannot verify it is the right place, and the name alone has already
  // proved insufficient.
  const picked = pickMatch(
    [candidate('Coffee Room', null, null)],
    { name: 'Coffee Room', lat: 50.9, lng: 34.8 },
  );
  assert.equal(picked, null);
});

check('a partial name still matches — Google decorates names', () => {
  const picked = pickMatch(
    [candidate('Coffee Room Sumy', 50.9, 34.8)],
    { name: 'Coffee Room', lat: 50.9, lng: 34.8 },
  );
  assert.equal(picked?.name, 'Coffee Room Sumy');
});

check('with no name, only a genuinely close result is accepted', () => {
  const near = pickMatch(
    [candidate('Something', 50.90005, 34.80005)],
    { name: null, lat: 50.9, lng: 34.8 },
  );
  assert.ok(near, 'a result on top of the pin is the place meant');

  // ~5km away: the search found SOMETHING, but nothing says it is the pin.
  const far = pickMatch(
    [candidate('Something Else', 50.95, 34.85)],
    { name: null, lat: 50.9, lng: 34.8 },
  );
  assert.equal(far, null, 'a distant result must not be guessed at');
});

check('no candidates, or no way to choose, returns null rather than a guess', () => {
  assert.equal(pickMatch([], { name: 'Coffee Room', lat: 50.9, lng: 34.8 }), null);
  // A name that matches nothing, and no coordinates to fall back on.
  assert.equal(
    pickMatch([candidate('Totally Different', null, null)], { name: 'Coffee Room', lat: null, lng: null }),
    null,
  );
});

check('a name match is accepted even when neither side has coordinates', () => {
  const picked = pickMatch(
    [candidate('Coffee Room', null, null)],
    { name: 'Coffee Room', lat: null, lng: null },
  );
  assert.equal(picked?.name, 'Coffee Room');
});

check('a manual add keeps only the stops no operator intent can override', () => {
  assert.deepEqual(manualQualifyReasons({ businessStatus: null, blockedByDnc: false }), []);
  assert.deepEqual(
    manualQualifyReasons({ businessStatus: 'OPERATIONAL', blockedByDnc: true }),
    ['do_not_contact'],
  );
  assert.deepEqual(
    manualQualifyReasons({ businessStatus: 'CLOSED_PERMANENTLY', blockedByDnc: false }),
    ['closed:closed_permanently'],
  );
});

check('the taste filters do NOT reject a hand-picked business', () => {
  // A chain name and an off-target category are exactly what the automatic
  // filter drops. Chosen deliberately, they must survive.
  assert.deepEqual(
    manualQualifyReasons({ businessStatus: 'OPERATIONAL', blockedByDnc: false }),
    [],
  );
});

console.log(`\n${passed} manual-business checks passed`);
