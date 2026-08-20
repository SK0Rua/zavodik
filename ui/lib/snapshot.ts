/**
 * Shape of a build snapshot JSON ("Факти збірки") — the frozen facts a demo was
 * built from (SPEC §4 stage 10). Written once per project at build time; never
 * mutated afterward, which is the whole point of freezing it.
 */

export interface EvidenceValue<T> {
  value: T;
  sourceIds: number[];
  confidence: number;
}

export interface SnapshotSource {
  id: number;
  type: string;
  url: string;
  capturedAt: string;
  method: string;
}

export interface SnapshotContact {
  channel: string;
  value: string;
  verified: boolean;
  sourceIds: number[];
}

export interface SnapshotAsset {
  file: string;
  objectKey: string;
  kind: string;
  width?: number;
  height?: number;
  contentType?: string;
  aiGenerated: boolean;
  generator?: string | null;
  sourceUrl?: string;
}

export interface BuildSnapshot {
  snapshotVersion: number;
  capturedAt: string;
  businessId: string;
  campaignId: string;
  name: string;
  category?: string | null;
  address?: string | null;
  city?: string | null;
  language: string;
  languageName?: string;
  description?: string | null;
  hours?: EvidenceValue<string> | null;
  rating?: number | null;
  reviewCount?: number | null;
  services: EvidenceValue<{ name: string; price: string | null; description: string | null }>[];
  reviews: EvidenceValue<{ text: string; rating?: number; author?: string }>[];
  socials?: Record<string, unknown>;
  contacts: SnapshotContact[];
  otherFacts: EvidenceValue<unknown>[];
  assets: SnapshotAsset[];
  website?: { url: string; verdict: string; meaningfulContent: boolean; notes?: string } | null;
  openGaps: string[];
  /**
   * `openGaps` in Ukrainian, aligned by index. Optional because snapshots
   * frozen before 2026-08-20 have no such field, and a build snapshot is
   * immutable — the page falls back to rendering `openGaps` instead.
   */
  openGapsUk?: Array<string | null>;
  sources: SnapshotSource[];
}

export const ASSET_KIND_LABELS: Record<string, string> = {
  hero: 'головне фото',
  gallery: 'галерея',
  logo: 'логотип',
  avatar: 'аватар',
};

export const CHANNEL_LABELS: Record<string, string> = {
  phone: 'телефон',
  email: 'пошта',
  website: 'сайт',
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  viber: 'Viber',
  telegram: 'Telegram',
};
