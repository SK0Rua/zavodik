/**
 * Immutable client snapshot: the ONLY thing the builder agent ever sees.
 * Built from verified DB facts. The builder cannot search the internet.
 */
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db/client.js';

export interface ClientSnapshot {
  businessId: string;
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  language: string;
  description: string | null;
  hours: string | null;
  services: Array<{ name: string; price: string | null }>;
  reviews: Array<{ text: string; rating: number | null }>;
  socials: Record<string, string>;
  websiteVerdict: string;
  rating: number | null;
  reviewCount: number | null;
  assets: Array<{ file: string; kind: string; width: number | null; height: number | null }>;
}

export async function buildClientSnapshot(businessId: string): Promise<ClientSnapshot> {
  const [biz] = await db.select().from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) throw new Error(`business not found: ${businessId}`);
  const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, biz.campaignId));
  const facts = await db.select().from(schema.businessFacts).where(eq(schema.businessFacts.businessId, businessId));
  const assetRows = await db.select().from(schema.assets).where(eq(schema.assets.businessId, businessId));
  const [audit] = await db.select().from(schema.websiteAudits)
    .where(eq(schema.websiteAudits.businessId, businessId))
    .orderBy(desc(schema.websiteAudits.auditedAt)).limit(1);

  const socials: Record<string, string> = {};
  for (const f of facts) {
    if (f.key.startsWith('social.')) socials[f.key.slice(7)] = String(f.value);
  }

  return {
    businessId,
    name: biz.name,
    category: biz.category,
    address: biz.address,
    phone: biz.phone,
    language: campaign?.language ?? 'en',
    description: (facts.find((f) => f.key === 'identity.description')?.value as string) ?? null,
    hours: (facts.find((f) => f.key === 'hours')?.value as string) ?? null,
    services: facts.filter((f) => f.key === 'service' && f.verified).map((f) => f.value as { name: string; price: string | null }),
    reviews: facts.filter((f) => f.key === 'review_excerpt' && f.verified).map((f) => f.value as { text: string; rating: number | null }),
    socials,
    websiteVerdict: audit?.verdict ?? 'none',
    rating: biz.rating,
    reviewCount: biz.reviewCount,
    assets: assetRows.map((a) => ({
      file: `assets/${a.objectKey.split('/').pop()}`,
      kind: a.intendedUsage, width: a.width, height: a.height,
    })),
  };
}
