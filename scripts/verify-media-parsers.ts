/**
 * Unit check for the FlowKit polling parsers (SPEC §2.5).
 *
 * The Chrome bridge cannot run on the factory host, so the two response shapes
 * are replayed from the FlowKit source instead of a live call:
 *   - Veo:  operation entries with `operation.metadata.video.fifeUrl`
 *           (agent/sdk/services/operations.py:653)
 *   - Omni: `{done, status, workflows: [{done, status, media:{url, media_id}}]}`
 *           (agent/services/omni_flash.py:520-546)
 *
 *   pnpm tsx scripts/verify-media-parsers.ts
 */
import { __testing } from '../src/media/video.js';

const { extractVideoUrl, extractOperations, extractWorkflows } = __testing;

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
  }
}

console.log('\nVeo (operations) shape');
const veoPending = { operations: [{ status: 'MEDIA_GENERATION_STATUS_PENDING', operation: { name: 'op/1' } }] };
check('pending -> not done, no url', extractVideoUrl(veoPending), { url: null, mediaId: null, done: false, failed: false });

const veoDone = {
  operations: [{
    status: 'MEDIA_GENERATION_STATUS_SUCCESSFUL',
    operation: { name: 'op/1', metadata: { video: { fifeUrl: 'https://flow/v.mp4', mediaId: 'm-1' } } },
  }],
};
check('successful -> url + mediaId', extractVideoUrl(veoDone), { url: 'https://flow/v.mp4', mediaId: 'm-1', done: true, failed: false });

const veoFailed = { operations: [{ status: 'MEDIA_GENERATION_STATUS_FAILED', operation: { name: 'op/1' } }] };
check('failed -> failed flag', extractVideoUrl(veoFailed), { url: null, mediaId: null, done: true, failed: true });

check('extractOperations finds list', extractOperations(veoDone) !== null, true);

console.log('\nOmni Flash (workflows) shape');
const omniPending = { project_id: 'p1', done: false, status: 'PENDING', workflows: [{ name: 'w1', primary_media_id: 'm1', done: false, status: 'PENDING' }] };
check('pending -> not done', extractVideoUrl(omniPending), { url: null, mediaId: null, done: false, failed: false });

const omniDone = {
  project_id: 'p1', done: true, status: 'COMPLETED',
  workflows: [{
    name: 'w1', primary_media_id: 'm1', done: true, status: 'MEDIA_GENERATION_STATUS_SUCCESSFUL',
    media: { media_id: 'm1', url: 'https://flow-content.google/clip.mp4', encoded_video_available: false },
  }],
};
check('successful -> url + mediaId', extractVideoUrl(omniDone), { url: 'https://flow-content.google/clip.mp4', mediaId: 'm1', done: true, failed: false });

const omniFailed = { project_id: 'p1', done: true, status: 'FAILED', workflows: [{ name: 'w1', primary_media_id: 'm1', done: true, status: 'FAILED', error: 'X_FAILED' }] };
check('failed -> failed flag', extractVideoUrl(omniFailed), { url: null, mediaId: null, done: true, failed: true });

const submitOmni = { some: 'payload', flowkitPolling: { mode: 'project_media', project_id: 'p1', workflows: [{ name: 'w1', primary_media_id: 'm1' }] } };
check('extractWorkflows reads flowkitPolling', extractWorkflows(submitOmni)?.length, 1);
check('extractOperations ignores omni submit', extractOperations(submitOmni), null);

console.log(failures === 0 ? '\nverify-media-parsers: OK\n' : `\nverify-media-parsers: ${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
