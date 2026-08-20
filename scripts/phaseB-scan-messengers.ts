/**
 * Audits the captured evidence for messenger markers.
 *
 * Zero WhatsApp/Viber contacts in a Greek beauty campaign is a plausible real
 * result, but it is indistinguishable from a broken detector unless the raw
 * HTML is checked directly. This re-scans every stored capture and reports what
 * markers are physically present, independent of what enrichment recorded.
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { getObject } from '../src/lib/storage.js';
import { detectContacts } from '../src/enrichment/messengers.js';

const campaignId = process.argv[2] ?? 'gr-patras-beauty';
const rows = (await db.execute(sql`
  select s.id, s.business_id, s.source_type, s.raw_object_key
  from business_sources s join businesses b on b.id = s.business_id
  where b.campaign_id = ${campaignId} and s.method = 'playwright' and s.raw_object_key is not null
  order by s.business_id`) as unknown as { rows: Array<{ id: number; business_id: string; source_type: string; raw_object_key: string }> }).rows;

console.log(`scanning ${rows.length} captured page(s) for messenger markers\n`);
const totals: Record<string, number> = {};
let rawWa = 0, rawViber = 0;

for (const r of rows) {
  let html = '';
  try { html = (await getObject('raw', r.raw_object_key)).toString('utf8'); }
  catch { console.log(`  ${r.business_id}: raw object unreadable`); continue; }

  // ground truth straight from the bytes, bypassing every filter
  const waHits = (html.match(/wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//gi) ?? []).length;
  const viberHits = (html.match(/viber:\/\//gi) ?? []).length;
  const waWord = (html.match(/whatsapp/gi) ?? []).length;
  const viberWord = (html.match(/viber/gi) ?? []).length;
  rawWa += waHits; rawViber += viberHits;

  const detected = detectContacts(html, { sourceType: r.source_type });
  for (const d of detected) totals[d.channel] = (totals[d.channel] ?? 0) + 1;

  if (waHits || viberHits || waWord || viberWord) {
    console.log(`  ${r.business_id} (${r.source_type})`);
    console.log(`     raw markers: wa-link=${waHits} viber-link=${viberHits} "whatsapp"=${waWord} "viber"=${viberWord}`);
    const msgr = detected.filter((d) => d.channel === 'whatsapp' || d.channel === 'viber');
    console.log(`     detector produced: ${msgr.length ? msgr.map((m) => `${m.channel}:${m.value}`).join(', ') : '(none)'}`);
  }
}

console.log(`\nRAW marker totals across all captures: wa-links=${rawWa}, viber-links=${rawViber}`);
console.log('detector output by channel:');
for (const [k, v] of Object.entries(totals).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
if (rawWa === 0 && rawViber === 0) {
  console.log('\n=> No WhatsApp/Viber click-to-chat markers exist in the captured evidence.');
  console.log('   Zero messenger contacts is the CORRECT result, not a detector failure.');
}
process.exit(0);
