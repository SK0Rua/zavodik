/**
 * Verify the Greek-safe font lists against the font manifest Next actually uses.
 *
 * `next/font` fails the BUILD when a requested subset is missing, so an incorrect
 * entry in `GREEK_SAFE_DISPLAY` / `GREEK_SAFE_BODY` hands the design rubric a
 * poisoned pick — the site cannot be built at all. This script reads the same
 * `font-data.json` the Next compiler consults and asserts every listed font is
 * real and carries `greek`.
 *
 * Run after any Next upgrade in site-template:
 *   pnpm tsx scripts/phaseC-fonts.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { GREEK_SAFE_BODY, GREEK_SAFE_DISPLAY } from '../src/build/schemas.js';

const FONT_DATA = path.resolve(
  'site-template/node_modules/next/dist/compiled/@next/font/dist/google/font-data.json',
);

if (!existsSync(FONT_DATA)) {
  console.error(`font manifest not found at ${FONT_DATA}\n` +
    'run `cd site-template && pnpm install` first');
  process.exit(1);
}

interface FontEntry { weights?: string[]; styles?: string[]; subsets?: string[] }
const data = JSON.parse(readFileSync(FONT_DATA, 'utf8')) as Record<string, FontEntry>;

/** next/font import names use underscores; the manifest uses spaces. */
const toManifestName = (importName: string): string => importName.replace(/_/g, ' ');

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? '✅' : '❌'} ${name.padEnd(22)} ${detail}`);
  if (!ok) failures++;
}

console.log('Greek-capable DISPLAY faces offered to the art director:\n');
for (const importName of GREEK_SAFE_DISPLAY) {
  const entry = data[toManifestName(importName)];
  if (!entry) { check(importName, false, 'NOT in the next/font manifest'); continue; }
  const greek = (entry.subsets ?? []).includes('greek');
  const italic = (entry.styles ?? []).includes('italic');
  check(importName, greek,
    `${greek ? 'greek ok' : 'NO GREEK SUBSET — would fail the build'}; ` +
    `${italic ? 'italic' : 'NO italic'}; weights ${(entry.weights ?? []).join('/')}`);
}

console.log('\nGreek-capable BODY faces:\n');
for (const importName of GREEK_SAFE_BODY) {
  const entry = data[toManifestName(importName)];
  if (!entry) { check(importName, false, 'NOT in the next/font manifest'); continue; }
  const greek = (entry.subsets ?? []).includes('greek');
  const italic = (entry.styles ?? []).includes('italic');
  check(importName, greek,
    `${greek ? 'greek ok' : 'NO GREEK SUBSET — would fail the build'}; ` +
    `${italic ? 'italic' : 'NO italic'}; weights ${(entry.weights ?? []).join('/')}`);
}

// The faces DESIGN.md and the rubric warn about must genuinely lack greek —
// if upstream adds the subset, the warnings become wrong and should be relaxed.
console.log('\nFaces documented as Greek-UNSAFE (must stay unsafe):\n');
for (const name of ['Cormorant', 'Cormorant Garamond', 'Playfair Display', 'Fraunces', 'Outfit',
  'Instrument Serif', 'Marcellus', 'Jost']) {
  const entry = data[name];
  if (!entry) { console.log(`⚪ ${name.padEnd(22)} not in manifest`); continue; }
  const greek = (entry.subsets ?? []).includes('greek');
  check(name, !greek, greek
    ? 'NOW HAS greek — the ban note in schemas.ts/DESIGN.md is stale'
    : 'still no greek subset, warning is correct');
}

console.log(`\n${failures === 0 ? '✅ font lists agree with the Next font manifest' : `❌ ${failures} problem(s)`}`);
process.exit(failures === 0 ? 0 : 1);
