/** Debug helper: dump a raw evidence object from storage to stdout. */
import { getObject } from '../src/lib/storage.js';

const bucket = (process.argv[2] as 'raw' | 'assets') ?? 'raw';
const key = process.argv[3];
if (!key) { console.error('usage: tsx scripts/phaseB-fetch-raw.ts <raw|assets> <key>'); process.exit(1); }
const buf = await getObject(bucket, key);
process.stdout.write(buf);
