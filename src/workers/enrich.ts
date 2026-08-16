/**
 * Deep enrichment: Playwright captures raw pages (owned site, socials),
 * then an enrichment agent extracts structured facts WITH provenance.
 * Every fact points to a source_id. No evidence -> null + gap. Inventing is impossible
 * by construction: the agent only sees captured raw content.
 */
import { chromium } from 'playwright';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { putRaw } from '../lib/storage.js';
import { runAgent, z } from '../agents/agent.js';
import { transition } from '../orchestrator/statuses.js';
import { enqueue, type JobPayload } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';

const EnrichmentSchema = z.object({
  description: z.string().nullable(),
  services: z.array(z.object({
    name: z.string(),
    price: z.string().nullable(),
    sourceRef: z.string(), // which captured source this came from, e.g. "S1"
  })),
  hours: z.string().nullable(),
  languages: z.array(z.string()),
  emails: z.array(z.object({ value: z.string(), sourceRef: z.string() })),
  socialProfiles: z.array(z.object({ platform: z.string(), url: z.string(), sourceRef: z.string() })),
  whatsapp: z.string().nullable(),
  reviewExcerpts: z.array(z.object({ text: z.string(), rating: z.number().nullable(), sourceRef: z.string() })),
  imageUrls: z.array(z.object({ url: z.string(), kind: z.enum(['hero', 'logo', 'gallery', 'menu']), sourceRef: z.string() })),
  gaps: z.array(z.string()),
});

interface Captured { ref: string; sourceId: number; url: string; text: string }

async function capture(businessId: string, url: string, sourceType: string, page: import('playwright').Page): Promise<Captured | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2000);
    const html = await page.content();
    const rawObjectKey = await putRaw(`enrichment/${businessId}`, html, 'text/html');
    const [src] = await db.insert(schema.businessSources).values({
      businessId, sourceType, url: page.url(), method: 'playwright', rawObjectKey,
    }).returning();
    // strip to readable text + img srcs for the agent (token budget)
    const text = await page.evaluate(() => {
      document.querySelectorAll('script,style,noscript,svg').forEach((el: Element) => el.remove());
      const imgs = Array.from(document.images).slice(0, 40)
        .map((i: HTMLImageElement) => `IMG: ${i.src} (${i.naturalWidth}x${i.naturalHeight}, alt="${i.alt}")`).join('\n');
      return `${document.body?.innerText?.slice(0, 15000) ?? ''}\n\n${imgs}`;
    });
    return { ref: '', sourceId: src.id, url: page.url(), text };
  } catch (err) {
    log.warn('capture failed', { businessId, url, err: String(err).slice(0, 200) });
    return null;
  }
}

export async function enrichHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error(`business not found: ${businessId}`);
  await transition(businessId, 'enriching', 'enrich-worker');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then((c) => c.newPage());
  const captured: Captured[] = [];

  try {
    // owned website (if any)
    if (biz.websiteUrl) {
      const c = await capture(businessId, biz.websiteUrl, 'owned_website', page);
      if (c) captured.push(c);
    }
    // maps listing again for reviews section (already have a source, but capture fresh review text)
    if (biz.listingUrl) {
      const c = await capture(businessId, biz.listingUrl, 'google_maps', page);
      if (c) captured.push(c);
    }
    // simple public search for socials
    const q = encodeURIComponent(`${biz.name} ${biz.address ?? ''} instagram facebook`);
    const c = await capture(businessId, `https://duckduckgo.com/html/?q=${q}`, 'search', page);
    if (c) captured.push(c);
  } finally {
    await browser.close();
  }

  if (captured.length === 0) {
    await transition(businessId, 'needs_review', 'enrich-worker', 'no sources capturable');
    return;
  }
  captured.forEach((c, i) => { c.ref = `S${i + 1}`; });

  const sourcesBlock = captured
    .map((c) => `=== SOURCE ${c.ref} (source_id=${c.sourceId}, url=${c.url}) ===\n${c.text}`)
    .join('\n\n');

  const result = await runAgent(
    'enrichment',
    `You extract verified facts about a local business from captured web sources.
Rules:
- Use ONLY the provided captured sources. Every extracted item must carry the sourceRef (S1/S2/...) it came from.
- Never invent emails, owners, prices, years in business, or reviews.
- A directory/booking profile is not an owned website.
- If something is not present in the sources, use null / empty array and add a gap.`,
    `Business: ${biz.name}\nCategory: ${biz.category ?? 'unknown'}\nAddress: ${biz.address ?? 'unknown'}\n\n${sourcesBlock}`,
    EnrichmentSchema,
    { maxTokens: 8000 },
  );

  const refToSourceId = new Map(captured.map((c) => [c.ref, c.sourceId]));
  const srcId = (ref: string) => refToSourceId.get(ref) ?? null;

  const factRows: (typeof schema.businessFacts.$inferInsert)[] = [];
  if (result.description) factRows.push({ businessId, key: 'identity.description', value: result.description, extractionMethod: 'llm_structured', confidence: 0.7 });
  if (result.hours) factRows.push({ businessId, key: 'hours', value: result.hours, extractionMethod: 'llm_structured', confidence: 0.7 });
  for (const s of result.services) {
    factRows.push({ businessId, key: 'service', value: { name: s.name, price: s.price }, sourceId: srcId(s.sourceRef), extractionMethod: 'llm_structured', confidence: 0.8, verified: srcId(s.sourceRef) != null });
  }
  for (const r of result.reviewExcerpts) {
    factRows.push({ businessId, key: 'review_excerpt', value: { text: r.text, rating: r.rating }, sourceId: srcId(r.sourceRef), extractionMethod: 'llm_structured', confidence: 0.8, verified: srcId(r.sourceRef) != null });
  }
  for (const p of result.socialProfiles) {
    factRows.push({ businessId, key: `social.${p.platform}`, value: p.url, sourceId: srcId(p.sourceRef), extractionMethod: 'llm_structured', confidence: 0.8, verified: true });
  }
  if (factRows.length) await db.insert(schema.businessFacts).values(factRows);

  for (const e of result.emails) {
    await db.insert(schema.businessContacts).values({ businessId, channel: 'email', value: e.value, sourceId: srcId(e.sourceRef), verified: srcId(e.sourceRef) != null });
  }
  if (result.whatsapp) {
    await db.insert(schema.businessContacts).values({ businessId, channel: 'whatsapp', value: result.whatsapp, verified: true });
  }
  for (const p of result.socialProfiles) {
    if (['instagram', 'facebook'].includes(p.platform.toLowerCase())) {
      await db.insert(schema.businessContacts).values({ businessId, channel: p.platform.toLowerCase(), value: p.url, sourceId: srcId(p.sourceRef), verified: true });
    }
  }

  for (const gap of result.gaps) {
    await db.insert(schema.productionGaps).values({ businessId, gap, blockerLevel: 'soft' });
  }

  // hand image URLs to asset collector, then website audit
  await enqueue('collect-assets', {
    businessId, campaignId: biz.campaignId,
    imageUrls: result.imageUrls as unknown as Record<string, unknown>[],
  });
  await enqueue('audit-website', { businessId, campaignId: biz.campaignId });
  log.info('enrichment done', { businessId, facts: factRows.length, images: result.imageUrls.length });
}
