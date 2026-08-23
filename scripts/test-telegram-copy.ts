/** Regression checks for provider-specific subscription-pause notifications. */
import { subscriptionPauseText } from '../src/telegram/notify.js';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`✅ ${label}`);
  else { failures++; console.error(`❌ ${label}`, detail ?? ''); }
}

const resumesAt = new Date('2026-08-23T17:43:00.000Z');
const codex = subscriptionPauseText({
  jobType: 'content-and-design', resumesAt, runtime: 'codex',
});
const claude = subscriptionPauseText({
  jobType: 'content-and-design', resumesAt, runtime: 'claude-code',
});

check('Codex limit names Codex', codex.includes('ліміт підписки Codex'), codex);
check('Codex limit does not claim Claude', !codex.includes('Claude'), codex);
check('Claude limit names Claude Code', claude.includes('ліміт підписки Claude Code'), claude);
check('stage remains human-readable', codex.includes('Підготовка дизайну'), codex);

console.log(failures === 0 ? '\n🧪 TELEGRAM COPY TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
