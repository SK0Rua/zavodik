/**
 * Content-addressed evidence upload for the legacy import.
 *
 * Why not `putRaw` from src/lib/storage.ts: that helper embeds `Date.now()` in
 * the key, so importing the same legacy file twice would produce two objects.
 * The import must be idempotent, so keys here are derived purely from the
 * content hash + original relative path. Re-importing an unchanged file yields
 * the same key and re-uploads nothing new (same key, same bytes = same object).
 *
 * Immutability still holds: an edited legacy file hashes differently and lands
 * under a new key, never overwriting the previous evidence version.
 */
import { S3Client, PutObjectCommand, HeadObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { sha256 } from '../lib/storage.js';

const MODE = (process.env.STORAGE_MODE ?? 's3') as 's3' | 'fs';
const FS_ROOT = path.resolve(process.env.STORAGE_DIR ?? 'storage');

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
});

/**
 * Make one path segment safe for S3/MinIO object names.
 *
 * Legacy filenames contain Greek text, spaces and brackets (e.g.
 * `place-μαστροκαλου-ελπιδα-...html`), which MinIO rejects outright. Each
 * segment is reduced to a conservative ASCII subset; anything else collapses
 * to `_`. Length is bounded per segment so no single Greek filename (which
 * expands ~6x when escaped) can blow past the key limit.
 */
function safeKeyPart(relPath: string): string {
  return relPath
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..')
    .map((seg) => seg.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 80))
    .join('/');
}

/** Hard cap well under the S3 1024-byte key limit, leaving room for the prefix. */
const MAX_KEY_LENGTH = 700;

/**
 * Deterministic key for a legacy file:
 *   legacy/<sha256[..16]>/<sanitized/relative/path>
 *
 * The hash prefix makes the key immutable-by-content (and is what guarantees
 * idempotent re-import); the readable suffix keeps legacy provenance visible
 * when browsing the bucket. The full original path is preserved losslessly in
 * object metadata (`legacy_path`) and in `business_sources.url`, so sanitizing
 * here never loses information.
 */
export function legacyObjectKey(relPath: string, hash: string): string {
  const prefix = `legacy/${hash.slice(0, 16)}/`;
  const safe = safeKeyPart(relPath);
  // Truncate from the LEFT so the filename (the distinguishing part) survives.
  const budget = MAX_KEY_LENGTH - prefix.length;
  return prefix + (safe.length > budget ? safe.slice(safe.length - budget) : safe);
}

export async function ensureImportBuckets(): Promise<void> {
  if (MODE === 'fs') {
    await mkdir(path.join(FS_ROOT, 'raw'), { recursive: true });
    await mkdir(path.join(FS_ROOT, 'assets'), { recursive: true });
    return;
  }
  for (const bucket of [config.s3.bucketRaw, config.s3.bucketAssets]) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }
}

async function objectExists(bucket: 'raw' | 'assets', key: string): Promise<boolean> {
  if (MODE === 'fs') {
    try { await stat(path.join(FS_ROOT, bucket, key)); return true; } catch { return false; }
  }
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: bucket === 'raw' ? config.s3.bucketRaw : config.s3.bucketAssets,
      Key: key,
    }));
    return true;
  } catch { return false; }
}

export interface UploadResult {
  objectKey: string;
  hash: string;
  /** false when the object was already present (idempotent re-run). */
  uploaded: boolean;
}

/**
 * Upload legacy bytes under a content-addressed key. Existing objects are left
 * untouched (raw evidence is immutable and identical by construction).
 */
export async function putLegacyObject(
  bucket: 'raw' | 'assets',
  relPath: string,
  body: Buffer,
  contentType: string,
  metadata: Record<string, string> = {},
): Promise<UploadResult> {
  const hash = sha256(body);
  const objectKey = legacyObjectKey(relPath, hash);

  if (await objectExists(bucket, objectKey)) return { objectKey, hash, uploaded: false };

  if (MODE === 'fs') {
    const target = path.join(FS_ROOT, bucket, objectKey);
    if (!target.startsWith(FS_ROOT)) throw new Error(`bad key: ${objectKey}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  } else {
    await s3.send(new PutObjectCommand({
      Bucket: bucket === 'raw' ? config.s3.bucketRaw : config.s3.bucketAssets,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    }));
  }
  return { objectKey, hash, uploaded: true };
}

export function guessContentType(relPath: string): string {
  const ext = path.extname(relPath).toLowerCase();
  const map: Record<string, string> = {
    '.html': 'text/html', '.htm': 'text/html', '.json': 'application/json',
    '.yaml': 'application/yaml', '.yml': 'application/yaml', '.md': 'text/markdown',
    '.txt': 'text/plain', '.csv': 'text/csv', '.jsonl': 'application/x-ndjson',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.avif': 'image/avif', '.pdf': 'application/pdf',
  };
  return map[ext] ?? 'application/octet-stream';
}
