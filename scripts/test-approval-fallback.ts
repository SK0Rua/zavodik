/**
 * The approval TEMPLATE fallback (`src/workers/approval.ts`).
 *
 * P0-1 in the 2026-08-20 audit: the factory's only finished demo could never be
 * approved or sent, because `outreach-writer` threw and took the whole
 * `request-approval` handler down with it. No `approvals` row was written, so
 * the inbox had nothing to show and the card's «Підтвердити відправку →» led to
 * «Для цього бізнесу нічого не чекає.»
 *
 * The fix is that a COPYWRITING failure can no longer cost Roman the decision:
 * the row is written anyway, with a template body and `needsEdit: true`.
 *
 * This test forces the failure rather than waiting for one, by pointing the
 * agent runtime at a model id that cannot resolve. That exercises the real
 * catch path in `prepareApproval` — not a mock of it.
 *
 *   pnpm tsx scripts/test-approval-fallback.ts
 *
 * Read-only with respect to `approvals`: it calls `prepareApproval`, which
 * builds the payload, and never `requestApprovalHandler`, which would write.
 */
import 'dotenv/config';
import { pool } from '../src/db/client.js';
import { writeSetting, initSettings, reloadSettings } from '../src/lib/settingsStore.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const BUSINESS = process.argv[2] ?? 'gr-patras-pagoulatos-luxury-hair-salon';

// Force every agent call to fail fast: a model id that does not exist makes the
// runtime throw on each of its 3 attempts, which is exactly the shape of the
// original AgentSchemaError. Written through `writeSetting` because settings
// resolve DB -> env -> default, so an env var alone would be shadowed by a
// value Roman saved in the UI.
const BAD_MODEL = 'no-such-model-for-this-test';
const PREV = { model: '', heavy: '' };
await initSettings({ poll: false });
{
  const { config } = await import('../src/config.js');
  PREV.model = config.agents.model;
  PREV.heavy = config.agents.modelHeavy;
}
await writeSetting('AGENT_MODEL', BAD_MODEL, 'test-approval-fallback');
await writeSetting('AGENT_MODEL_HEAVY', BAD_MODEL, 'test-approval-fallback');
await reloadSettings();

const { prepareApproval } = await import('../src/workers/approval.js');

try {
  const { payload } = await prepareApproval(BUSINESS);

  check('prepareApproval did NOT throw when the writer failed', true);
  check('needsEdit is set', payload.needsEdit === true, String(payload.needsEdit));
  check('needsEditReason is Ukrainian and actionable',
    Boolean(payload.needsEditReason?.includes('Перепиши')), payload.needsEditReason ?? 'null');
  check('a non-empty body exists to edit', payload.draft.body.trim().length > 0,
    `${payload.draft.body.length} chars`);
  check('the demo link is in the body', payload.demoUrl
    ? payload.draft.body.includes(payload.demoUrl) : true);
  check('channel still chosen deterministically', payload.draft.channel !== null,
    payload.draft.channel ?? 'null');
  check('address still present', payload.draft.toAddress !== null,
    payload.draft.toAddress ?? 'null');

  // The invariant: a template must not smuggle in a claim about the business.
  // It may name the business and link its demo, and nothing else.
  const body = payload.draft.body;
  const inventedMarkers = ['★', 'reviews say', 'κριτικές', 'your customers love', '5.0'];
  check('template invents no facts about the business',
    !inventedMarkers.some((m) => body.includes(m)), body.slice(0, 120));

  console.log('\n--- template body ---\n' + body + '\n---------------------');
} catch (err) {
  check('prepareApproval did NOT throw when the writer failed', false,
    String((err as Error)?.message ?? err).slice(0, 200));
} finally {
  // Put the real models back, whatever happened. An empty value DELETES the
  // override row, which is what restores the previous resolution.
  await writeSetting('AGENT_MODEL', '', 'test-approval-fallback').catch(() => {});
  await writeSetting('AGENT_MODEL_HEAVY', '', 'test-approval-fallback').catch(() => {});
  await reloadSettings().catch(() => {});
  const { config } = await import('../src/config.js');
  console.log(`models restored: ${config.agents.model} / ${config.agents.modelHeavy} `
    + `(were ${PREV.model} / ${PREV.heavy})`);
}

console.log(failures === 0 ? '\n✉️  APPROVAL FALLBACK TESTS PASSED' : `\n❌ ${failures} failed`);
await pool.end();
process.exit(failures === 0 ? 0 : 1);
