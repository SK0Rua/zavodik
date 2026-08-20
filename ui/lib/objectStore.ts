/**
 * Server-side JSON reads from evidence storage, for pages that need to render a
 * QA report or a build snapshot rather than just link to the raw object.
 *
 * Deliberately duplicates the tiny fetch routine in `app/api/object/route.ts`
 * rather than importing it: that file is a Next route handler (exports `GET`),
 * not a library module, and the two callers want different things from a miss
 * (the route returns a 404 response; a page wants `null` to render an empty
 * state). The bucket/credentials logic is a few lines — not worth a shared
 * abstraction for two callers.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

async function fetchRawObject(key: string): Promise<Buffer | null> {
  try {
    if ((process.env.STORAGE_MODE ?? 's3') === 'fs') {
      const root = path.resolve(process.env.STORAGE_DIR ?? 'storage');
      const target = path.resolve(root, 'raw', key);
      if (!target.startsWith(root)) return null;
      return await readFile(target);
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
    const res = await s3.send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_RAW ?? 'factory-raw',
      Key: key,
    }));
    return Buffer.from(await res.Body!.transformToByteArray());
  } catch {
    return null;
  }
}

/** Parsed JSON from the `raw` bucket, or `null` when the object is missing/unparseable. */
export async function readRawJson<T = unknown>(key: string): Promise<T | null> {
  const buf = await fetchRawObject(key);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString('utf8')) as T;
  } catch {
    return null;
  }
}
