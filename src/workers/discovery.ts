/**
 * Discovery worker: Google Maps search via Playwright.
 * Port of the GoogleMapsEngine approach (Madi-S/Lead-Generation): open Maps search,
 * scroll the results feed to the end, walk each place card, extract minimal fields.
 * Raw card HTML is stored immutably in object storage; only then is data normalized.
 */
import { chromium, type Page } from 'playwright';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { putRaw } from '../lib/storage.js';
import { enqueue, type JobPayload } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';

export interface RawCandidate {
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  websiteUrl: string | null;
  listingUrl: string;
  placeId: string | null;
  rating: number | null;
  reviewCount: number | null;
  lat: number | null;
  lng: number | null;
  rawObjectKey: string;
  query: string;
}

const FEED_SELECTOR = 'div[role="feed"]';

async function acceptConsent(page: Page): Promise<void> {
  for (const sel of ['button[aria-label*="Accept"]', 'button[aria-label*="Reject"]', 'form[action*="consent"] button']) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) { await btn.click().catch(() => {}); break; }
  }
}

async function scrollFeedToEnd(page: Page, maxScrolls = 40): Promise<void> {
  for (let i = 0; i < maxScrolls; i++) {
    const done = await page.evaluate((sel) => {
      const feed = document.querySelector(sel);
      if (!feed) return true;
      feed.scrollBy(0, 2000);
      return feed.textContent?.includes('reached the end') || feed.textContent?.includes('кінець списку') || false;
    }, FEED_SELECTOR);
    await page.waitForTimeout(900 + Math.random() * 600);
    if (done) break;
  }
}

function parsePlaceIdFromUrl(url: string): string | null {
  const m = url.match(/!19s([^!?]+)/) ?? url.match(/place_id=([^&]+)/) ?? url.match(/0x[0-9a-f]+:0x[0-9a-f]+/);
  return m ? decodeURIComponent(m[1] ?? m[0]) : null;
}

function parseLatLng(url: string): { lat: number | null; lng: number | null } {
  const m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : { lat: null, lng: null };
}

async function extractCard(page: Page, listingUrl: string, query: string, campaignId: string): Promise<RawCandidate | null> {
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(1500);

  const html = await page.content();
  const rawObjectKey = await putRaw(`discovery/${campaignId}`, html, 'text/html');

  const name = await page.locator('h1').first().textContent().catch(() => null);
  if (!name?.trim()) return null;

  const category = await page.locator('button[jsaction*="category"]').first().textContent().catch(() => null);
  const address = await page.locator('button[data-item-id="address"]').first().getAttribute('aria-label').catch(() => null);
  const phoneAria = await page.locator('button[data-item-id^="phone"]').first().getAttribute('aria-label').catch(() => null);
  const websiteUrl = await page.locator('a[data-item-id="authority"]').first().getAttribute('href').catch(() => null);

  const ratingText = await page.locator('div[role="main"] span[aria-hidden="true"]').first().textContent().catch(() => null);
  const reviewAria = await page.locator('div[role="main"] button[jsaction*="reviewChart"], div[role="main"] span[aria-label*="review"]')
    .first().getAttribute('aria-label').catch(() => null);

  const finalUrl = page.url();
  const { lat, lng } = parseLatLng(finalUrl);

  return {
    name: name.trim(),
    category: category?.trim() ?? null,
    address: address?.replace(/^Address:\s*/i, '').trim() ?? null,
    phone: phoneAria?.replace(/^Phone:\s*/i, '').trim() ?? null,
    websiteUrl,
    listingUrl: finalUrl,
    placeId: parsePlaceIdFromUrl(finalUrl),
    rating: ratingText ? parseFloat(ratingText.replace(',', '.')) || null : null,
    reviewCount: reviewAria ? parseInt(reviewAria.replace(/[^\d]/g, ''), 10) || null : null,
    lat, lng,
    rawObjectKey,
    query,
  };
}

export async function discoverHandler(payload: JobPayload): Promise<void> {
  const campaignId = payload.campaignId!;
  const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId));
  if (!campaign) throw new Error(`campaign not found: ${campaignId}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: campaign.language === 'el' ? 'el-GR' : 'en-US',
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  });
  const page = await context.newPage();
  const found: RawCandidate[] = [];

  try {
    for (const query of campaign.queries) {
      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(`${query} ${campaign.city}`)}`;
      log.info('discovery query', { campaignId, query });
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await acceptConsent(page);
      await page.waitForSelector(FEED_SELECTOR, { timeout: 20_000 }).catch(() => {});
      await scrollFeedToEnd(page);

      const links: string[] = await page.evaluate((sel) => {
        const feed = document.querySelector(sel);
        if (!feed) return [];
        return Array.from(feed.querySelectorAll('a[href*="/maps/place/"]')).map((a) => (a as HTMLAnchorElement).href);
      }, FEED_SELECTOR);
      const unique = [...new Set(links)].slice(0, campaign.targetCount);
      log.info('discovery feed collected', { campaignId, query, count: unique.length });

      for (const url of unique) {
        if (found.length >= campaign.targetCount) break;
        try {
          const cand = await extractCard(page, url, query, campaignId);
          if (cand) found.push(cand);
        } catch (err) {
          log.warn('card extraction failed, continuing', { url, err: String(err).slice(0, 200) });
        }
        await page.waitForTimeout(700 + Math.random() * 800);
      }
      if (found.length >= campaign.targetCount) break;
    }
  } finally {
    await browser.close();
  }

  if (found.length === 0) throw new Error('discovery found 0 candidates (possible Maps layout change or block)');

  // hand off each candidate to normalization; payload travels via DB-free JSON (small fields only)
  for (const cand of found) {
    await enqueue('normalize', {
      campaignId,
      candidate: cand as unknown as Record<string, unknown>,
      idempotencyKey: `normalize:${campaignId}:${cand.placeId ?? cand.listingUrl}`,
    });
  }
  log.info('discovery done', { campaignId, candidates: found.length });
}
