/**
 * Evidence/asset storage. Two drivers:
 *  - s3 (default): MinIO/R2/any S3-compatible (docker-compose ships MinIO)
 *  - fs: local ./storage directory (zero-dependency mode, small runs / tests)
 * Raw objects are immutable: keys embed a content hash; re-capture => new key.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

const MODE = (process.env.STORAGE_MODE ?? 's3') as 's3' | 'fs';
const FS_ROOT = path.resolve(process.env.STORAGE_DIR ?? 'storage');

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
});

export function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

export async function ensureBuckets(): Promise<void> {
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

async function fsPut(bucket: 'raw' | 'assets', key: string, body: Buffer): Promise<void> {
  const target = path.join(FS_ROOT, bucket, key);
  if (!target.startsWith(FS_ROOT)) throw new Error(`bad key: ${key}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}

/** Immutable raw evidence. Key includes content hash: re-capture => new version, never overwrite. */
export async function putRaw(prefix: string, body: Buffer | string, contentType = 'application/octet-stream'): Promise<string> {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  const key = `${prefix}/${Date.now()}-${sha256(buf).slice(0, 12)}`;
  if (MODE === 'fs') {
    await fsPut('raw', key, buf);
  } else {
    await s3.send(new PutObjectCommand({ Bucket: config.s3.bucketRaw, Key: key, Body: buf, ContentType: contentType }));
  }
  return key;
}

export async function putAsset(key: string, body: Buffer, contentType: string): Promise<void> {
  if (MODE === 'fs') {
    await fsPut('assets', key, body);
  } else {
    await s3.send(new PutObjectCommand({ Bucket: config.s3.bucketAssets, Key: key, Body: body, ContentType: contentType }));
  }
}

export async function getObject(bucket: 'raw' | 'assets', key: string): Promise<Buffer> {
  if (MODE === 'fs') {
    return readFile(path.join(FS_ROOT, bucket, key));
  }
  const res = await s3.send(new GetObjectCommand({
    Bucket: bucket === 'raw' ? config.s3.bucketRaw : config.s3.bucketAssets,
    Key: key,
  }));
  return Buffer.from(await res.Body!.transformToByteArray());
}
