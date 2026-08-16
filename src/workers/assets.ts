/**
 * Asset collector: downloads images referenced by enrichment, stores them in
 * object storage with hash/provenance/rights caution. Skips tiny images.
 */
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { putAsset, sha256 } from '../lib/storage.js';
import type { JobPayload } from '../orchestrator/queue.js';
import { log } from '../lib/logger.js';

interface ImageRef { url: string; kind: 'hero' | 'logo' | 'gallery' | 'menu'; sourceRef?: string }

function dimsFromBuffer(buf: Buffer): { width: number | null; height: number | null } {
  // minimal PNG/JPEG header parsing; good enough for filtering
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return { width: null, height: null };
}

export async function collectAssetsHandler(payload: JobPayload): Promise<void> {
  const businessId = payload.businessId!;
  const imageUrls = (payload.imageUrls ?? []) as unknown as ImageRef[];
  let saved = 0;

  for (const img of imageUrls.slice(0, 20)) {
    try {
      const res = await fetch(img.url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      if (!contentType.startsWith('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8_000) continue; // skip icons/tracking pixels
      const { width, height } = dimsFromBuffer(buf);
      if (width !== null && (width < 400 || (height ?? 0) < 300) && img.kind !== 'logo') continue;

      const hash = sha256(buf);
      const existing = await db.select().from(schema.assets)
        .where(and(eq(schema.assets.businessId, businessId), eq(schema.assets.hash, hash)));
      if (existing.length) continue; // idempotent

      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const objectKey = `${businessId}/${img.kind}-${hash.slice(0, 12)}.${ext}`;
      await putAsset(objectKey, buf, contentType);
      await db.insert(schema.assets).values({
        businessId, objectKey, hash, sourceUrl: img.url, sourceType: 'enrichment',
        contentType, width, height, intendedUsage: img.kind, rights: 'private_demo_only',
      });
      saved++;
    } catch (err) {
      log.warn('asset download failed', { businessId, url: img.url.slice(0, 120), err: String(err).slice(0, 120) });
    }
  }
  log.info('assets collected', { businessId, saved, offered: imageUrls.length });
}
