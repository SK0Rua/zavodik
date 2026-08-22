/**
 * Registration of generated media as `assets` rows.
 *
 * Single choke point for the CLAUDE.md invariant: AI-generated media is marked
 * `ai_generated=true` and `rights='private_demo_only'`, so it can never be
 * silently passed off as a real photo/video of the business. Both flags are
 * hard-coded here rather than accepted as parameters — a caller cannot opt out.
 */
import { and, eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { db, schema } from '../db/client.js';
import { putAsset, sha256 } from '../lib/storage.js';
import { log } from '../lib/logger.js';

/** Where a generated file is meant to be used on the demo site. */
export type GeneratedAssetKind = 'background' | 'pattern' | 'og' | 'texture' | 'decor' | 'hero_clip';

export interface GeneratedAssetMeta {
  /** gen-image:gpt-image-2 | ken-burns | manual-upload */
  generator: string;
  prompt?: string;
  /** For hero clips: the real business photo the motion was derived from. */
  sourceImagePath?: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number;
  contentType?: string;
  [key: string]: unknown;
}

export interface RegisteredAsset {
  id: number;
  objectKey: string;
  hash: string;
  bytes: number;
  /** False when an identical file was already registered for this business. */
  inserted: boolean;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * Upload a generated file to object storage and record it as an asset with
 * `ai_generated=true` + `rights='private_demo_only'`.
 *
 * Idempotent per (businessId, content hash): re-registering the same bytes
 * returns the existing row instead of inserting a duplicate.
 */
export async function registerGeneratedAsset(
  businessId: string,
  filePath: string,
  kind: GeneratedAssetKind,
  meta: GeneratedAssetMeta,
): Promise<RegisteredAsset> {
  const buf = await readFile(filePath);
  if (buf.length === 0) throw new Error(`registerGeneratedAsset: empty file ${filePath}`);

  const hash = sha256(buf);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = meta.contentType ?? CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream';

  const existing = await db.select().from(schema.assets)
    .where(and(eq(schema.assets.businessId, businessId), eq(schema.assets.hash, hash)));
  if (existing.length > 0) {
    return {
      id: existing[0]!.id,
      objectKey: existing[0]!.objectKey,
      hash,
      bytes: buf.length,
      inserted: false,
    };
  }

  const objectKey = `${businessId}/generated/${kind}-${hash.slice(0, 12)}${ext || ''}`;
  await putAsset(objectKey, buf, contentType);

  const [row] = await db.insert(schema.assets).values({
    businessId,
    objectKey,
    hash,
    // Not a fetched URL: record the generator so provenance stays explicit.
    sourceUrl: `generated://${meta.generator}`,
    sourceType: 'ai_generated',
    contentType,
    width: meta.width ?? null,
    height: meta.height ?? null,
    intendedUsage: kind,
    // Invariants — never parameterised.
    rights: 'private_demo_only',
    aiGenerated: true,
    generator: meta.generator,
    generationMeta: meta,
  }).returning();

  log.info('generated asset registered', {
    businessId, objectKey, kind, generator: meta.generator, bytes: buf.length,
  });

  return { id: row!.id, objectKey, hash, bytes: buf.length, inserted: true };
}
