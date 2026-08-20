/**
 * Live check of the write-time translation path (one real subscription call).
 *
 *   pnpm tsx scripts/test-translate-live.ts
 *
 * `scripts/test-notes-uk.ts` covers the pure rendering with no agent. This one
 * covers the half that only a real call can prove: that `translateToUkrainian`
 * and `translateQaNotes` actually come back Ukrainian, aligned by index, with
 * the structural `risk=` / `CONTRADICTION:` prefixes intact — the property that
 * `parseCriticNotes` depends on and that a mocked test cannot establish.
 *
 * Touches no table and enqueues no job: it calls the two functions directly on
 * literal strings taken from the real Patras rows.
 */
import assert from 'node:assert/strict';
import { translateToUkrainian, translateQaNotes, isCyrillic } from '../src/lib/translateNotes.js';
import { parseCriticNotes } from '../ui/lib/criticNotes.js';

let passed = 0;
async function ok(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`✅ ${name}`); } catch (err) {
    console.error(`❌ ${name}\n   ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

await ok('Greek + English gaps come back Ukrainian, in order, keys handled locally', async () => {
  const input = [
    'Δεν βρέθηκε διεύθυνση email σε καμία πηγή.',            // Greek
    'No prices are listed anywhere in the evidence.',        // English
    'logo_missing',                                          // our key: no agent
    'Не знайшли жодного відгуку.',                           // already Ukrainian: skipped
  ];
  const out = await translateToUkrainian(input, 'evidence gaps for "Test Salon", a beauty salon');

  assert.equal(out.length, input.length, 'length must be preserved');
  assert.ok(out[0] && isCyrillic(out[0]), `Greek untranslated: ${out[0]}`);
  assert.match(out[0]!, /електрон|email|пошт/i, `lost the subject: ${out[0]}`);
  assert.ok(out[1] && isCyrillic(out[1]), `English untranslated: ${out[1]}`);
  assert.match(out[1]!, /цін/i, `lost the subject: ${out[1]}`);
  assert.ok(out[2] && isCyrillic(out[2]), 'key gap should use the code dictionary');
  assert.equal(out[3], null, 'already-Ukrainian text must not be sent to a model');
});

await ok('critic notes keep their structure through translation', async () => {
  const raw = 'risk=low | provenanceOk=true | Every fact carries a source id and the '
    + 'reviews read as authentic. | CONTRADICTION: the audit says no website but enrichment '
    + 'captured one | SUSPICIOUS: the price 50.00 is suspiciously round — why: no source prints it';

  const uk = await translateQaNotes(raw, 'fact-check findings about "Test Salon", a beauty salon');
  assert.ok(uk, 'expected a translation');

  // The machine-readable prefixes must survive byte-identical.
  assert.match(uk!, /^risk=low \| provenanceOk=true \|/, `structure lost: ${uk!.slice(0, 60)}`);
  assert.match(uk!, /CONTRADICTION:/, 'CONTRADICTION label lost');
  assert.match(uk!, /SUSPICIOUS:/, 'SUSPICIOUS label lost');

  // ...and the UI parser must still read it the same way.
  const parsed = parseCriticNotes(uk);
  assert.ok(parsed, 'parser returned nothing');
  assert.equal(parsed!.findings.length, 2, `expected 2 findings, got ${parsed!.findings.length}`);
  assert.equal(parsed!.findings[0]!.kind, 'CONTRADICTION');
  assert.equal(parsed!.findings[1]!.kind, 'SUSPICIOUS');
  for (const f of parsed!.findings) {
    assert.ok(isCyrillic(f.text, 0.3), `finding left in English: ${f.text}`);
  }
  assert.match(parsed!.summary, /низький ризик/, `summary not Ukrainian: ${parsed!.summary}`);
});

await ok('a failure is non-fatal and returns nulls, never throws', async () => {
  // Empty input exercises the "nothing to do" path without spending a call.
  const out = await translateToUkrainian(['', '   '], 'noop');
  assert.deepEqual(out, [null, null]);
  assert.equal(await translateQaNotes(null, 'noop'), null);
  assert.equal(await translateQaNotes('   ', 'noop'), null);
});

console.log(`\n${passed} live translation checks passed`);
