/**
 * Reading a pasted Google Maps link.
 *
 * Pure parsing only — no network. The short-link branch is covered by the
 * host-validation checks, since the one thing that must never regress there is
 * that a URL from a text box cannot make the server fetch an arbitrary host.
 */
import assert from 'node:assert/strict';
import { looksLikeMapsLink, parseMapsLink, MapsLinkError } from '../src/discovery/mapsLink.js';

let passed = 0;

async function check(label: string, run: () => Promise<void> | void): Promise<void> {
  await run();
  passed++;
  console.log(`✅ ${label}`);
}

await check('recognises the link shapes Google actually hands out', () => {
  for (const url of [
    'https://www.google.com/maps/place/Kavarnya/@50.9077,34.7981,17z/data=!3m1',
    'https://google.com.ua/maps/place/Some+Cafe/@50.9,34.8,15z',
    'https://maps.app.goo.gl/abc123',
    'https://goo.gl/maps/xyz',
  ]) {
    assert.equal(looksLikeMapsLink(url), true, url);
  }
});

await check('rejects anything that is not a Maps link', () => {
  for (const url of [
    'https://example.com/maps/place/Cafe',
    'https://not-google.com/maps',
    'facebook.com/somebusiness',
    'not a url at all',
    '',
  ]) {
    assert.equal(looksLikeMapsLink(url), false, url);
  }
});

await check('reads the place name and the map centre', async () => {
  const parsed = await parseMapsLink(
    'https://www.google.com/maps/place/Coffee+Room/@50.9077,34.7981,17z/data=!3m1!4b1',
  );
  assert.equal(parsed.name, 'Coffee Room');
  assert.equal(parsed.lat, 50.9077);
  assert.equal(parsed.lng, 34.7981);
});

await check('decodes a non-latin name', async () => {
  const parsed = await parseMapsLink(
    'https://www.google.com/maps/place/%D0%9A%D0%B0%D0%B2%27%D1%8F%D1%80%D0%BD%D1%8F/@50.9,34.8,17z',
  );
  assert.equal(parsed.name, "Кав'ярня");
});

await check('a name-only link is accepted, coordinates are optional', async () => {
  const parsed = await parseMapsLink('https://www.google.com/maps/place/Some+Bakery/');
  assert.equal(parsed.name, 'Some Bakery');
  assert.equal(parsed.lat, null);
});

await check('a coordinates-only link is accepted, the name is optional', async () => {
  const parsed = await parseMapsLink('https://www.google.com/maps/@50.9,34.8,17z');
  assert.equal(parsed.name, null);
  assert.equal(parsed.lat, 50.9);
  assert.equal(parsed.lng, 34.8);

  const shared = await parseMapsLink('https://www.google.com/maps?q=50.44,30.52');
  assert.equal(shared.lat, 50.44);
  assert.equal(shared.lng, 30.52);
});

await check('a plus-code or bare coordinate in /place/ is not mistaken for a name', async () => {
  const plusCode = await parseMapsLink('https://www.google.com/maps/place/9G4C%2BX8+Sumy/@50.9,34.8,17z');
  assert.equal(plusCode.name, null, 'a plus-code is not a business name');
  const coords = await parseMapsLink('https://www.google.com/maps/place/50.9,34.8/@50.9,34.8,17z');
  assert.equal(coords.name, null, 'a coordinate pair is not a business name');
});

await check('a link carrying neither a name nor coordinates is refused, with advice', async () => {
  await assert.rejects(
    () => parseMapsLink('https://www.google.com/maps/search/'),
    (err: unknown) => err instanceof MapsLinkError && /назву.*координати/i.test((err as Error).message),
  );
});

await check('a non-Maps URL is refused before any fetch happens', async () => {
  await assert.rejects(
    () => parseMapsLink('https://evil.example.com/maps/place/X'),
    MapsLinkError,
  );
});

console.log(`\n${passed} maps-link checks passed`);
