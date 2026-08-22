'use server';

/**
 * Upload of the hand-generated hero wow-clip (SPEC §2.5, 2026-08-22).
 *
 * The mp4 lands in the assets bucket and is registered EXACTLY like the
 * factory's own generated media — `ai_generated=true`, `private_demo_only`,
 * `intended_usage='hero_clip'` — because `planHeroMedia` reuses the newest
 * `hero_clip` row before generating anything: the moment this row exists, the
 * next build or iteration uses the uploaded clip instead of the Ken Burns one.
 * No new pipeline branch, no flag; the DB row IS the mechanism.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { db, schema } from './db';
import type { ActionResult } from './types';

/** Big enough for an 8-10s 1080p clip with headroom; matches next.config's cap. */
const MAX_BYTES = 200 * 1024 * 1024;

/** Same write logic the object-store read path mirrors: S3 by default, fs for dev. */
async function putAssetObject(key: string, body: Buffer, contentType: string): Promise<void> {
  if ((process.env.STORAGE_MODE ?? 's3') === 'fs') {
    const root = path.resolve(process.env.STORAGE_DIR ?? 'storage');
    const target = path.resolve(root, 'assets', key);
    if (!target.startsWith(root)) throw new Error('bad key');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    return;
  }
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'factory',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'factorysecret',
    },
  });
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_ASSETS ?? 'factory-assets',
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

/** `ftyp` at offset 4 — the MP4/QuickTime container signature. */
function looksLikeMp4(buf: Buffer): boolean {
  return buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp';
}

export async function uploadHeroClip(businessId: string, formData: FormData): Promise<ActionResult> {
  const file = formData.get('clip');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Файл не вибрано.' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: `Файл завеликий (${Math.round(file.size / 1_048_576)}МБ). Ліміт — 200МБ.` };
  }

  const [biz] = await db.select({ id: schema.businesses.id })
    .from(schema.businesses).where(eq(schema.businesses.id, businessId));
  if (!biz) return { ok: false, message: 'Бізнес не знайдено.' };

  const buf = Buffer.from(await file.arrayBuffer());
  if (!looksLikeMp4(buf)) {
    return { ok: false, message: 'Це не mp4 — генератори зазвичай віддають .mp4; конвертни перед завантаженням.' };
  }

  const hash = createHash('sha256').update(buf).digest('hex');
  const existing = await db.select({ id: schema.assets.id }).from(schema.assets)
    .where(and(eq(schema.assets.businessId, businessId), eq(schema.assets.hash, hash)));
  if (existing.length > 0) {
    return { ok: false, message: 'Цей самий файл уже завантажений — новий запис не потрібен.' };
  }

  const objectKey = `${businessId}/generated/hero_clip-${hash.slice(0, 12)}.mp4`;
  await putAssetObject(objectKey, buf, 'video/mp4');

  await db.insert(schema.assets).values({
    businessId,
    objectKey,
    hash,
    sourceUrl: 'generated://manual-upload',
    sourceType: 'ai_generated',
    contentType: 'video/mp4',
    intendedUsage: 'hero_clip',
    // Invariants — the uploaded clip is AI media and never a real video of the business.
    rights: 'private_demo_only',
    aiGenerated: true,
    generator: 'manual-upload',
    generationMeta: { uploadedBy: 'roman', originalName: file.name, bytes: buf.length },
  });

  revalidatePath(`/businesses/${businessId}`);
  return {
    ok: true,
    message: 'Відео збережено. Наступна збірка чи ітерація використає його замість Ken Burns.',
  };
}
