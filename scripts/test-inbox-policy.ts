/**
 * Pure regression checks for what belongs in Roman's inbox.
 *
 * A confident machine verdict is useful history, not automatically a human
 * task. Only states where the factory genuinely needs a decision may produce
 * an inbox card.
 */
import { buildButtonState } from '../ui/lib/buildPolicy.js';
import { cardActionBar } from '../ui/lib/cardActions.js';
import { reviewAsk } from '../ui/lib/humanStatus.js';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`✅ ${label}`);
  else { failures++; console.error(`❌ ${label}`, detail ?? ''); }
}

check(
  'a good existing site is a completed no-action verdict, not an inbox task',
  reviewAsk('not qualified: already_has_a_good_modern_site_no_opportunity') === 'no_action',
  reviewAsk('not qualified: already_has_a_good_modern_site_no_opportunity'),
);
check(
  'a good-site verdict stays no-action when the scorer records another reason too',
  reviewAsk(
    'not qualified: already_has_a_good_modern_site_no_opportunity,no_reachable_contact_channel',
  ) === 'no_action',
);
check('failed fact QA still needs a decision', reviewAsk('QA failed: unsupported claim') === 'fact_check');
check('material gaps stay out of individual decision cards', reviewAsk('gaps: hero_or_logo') === 'materials');
check('an ambiguous qualifier verdict still needs a decision', reviewAsk('contradiction: phone mismatch') === 'verdict');

const pausedBuild = buildButtonState({
  status: 'production_ready',
  openGaps: [],
  activeProjectState: 'failed',
  activeJobStatus: 'retry_wait',
  hasEvidence: true,
});
check(
  'retry_wait says the build is paused by the subscription limit, not merely queued',
  pausedBuild.availability === 'busy'
    && pausedBuild.hint === 'Збірка на паузі через ліміт підписки',
  pausedBuild,
);

const recoveringBuild = cardActionBar({
  businessId: 'fixture-business',
  status: 'production_ready',
  projectState: 'failed',
  projectId: 1,
  deployUrl: null,
  build: {
    enabled: false,
    needsConfirm: false,
    availability: 'busy',
    hint: 'Збірка вже стоїть у черзі',
  },
  socials: { enabled: true, hint: 'Дошукати соцмережі' },
  openGaps: [],
  socialsGap: false,
  hasPendingApproval: false,
  statusReason: null,
});
check(
  'a failed old project with an active replacement asks for no human action',
  recoveringBuild.actions.length === 0 && Boolean(recoveringBuild.waiting),
  recoveringBuild,
);

console.log(failures === 0 ? '\n🧪 INBOX POLICY TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
