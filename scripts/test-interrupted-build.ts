/**
 * Offline tests for "was this build interrupted, or is it just slow?"
 *
 * The question the live build panel gets wrong in exactly one direction that
 * matters. Roman's report (BEAUTIFY Laser, 2026-08-22): a git-pull redeploy
 * killed a build mid-session, and the card went on saying «Фабрика будує
 * демосайт. Це займає 10–30 хвилин» over a log frozen hours earlier, with no
 * restart button anywhere. The panel had no way to tell a dead build from a
 * quiet one.
 *
 * Both mistakes are expensive and they are not symmetric:
 *  - calling a LIVE build interrupted tells him to restart something that is
 *    already 35 minutes into a 40-minute agent session, and pressing the button
 *    would throw that work away;
 *  - calling a DEAD build live is the bug being fixed, and it costs hours of
 *    waiting for something that will never finish.
 *
 * So the running and queued cases are asserted as hard as the stale one.
 *
 * Run with the e2e tsconfig, like `pnpm e2e` does: `ui/lib/buildPolicy.ts`
 * resolves `@factory/*`, which are Next path aliases the root config does not
 * carry.
 *
 *   pnpm test:interrupted-build
 */
import { isInterruptedBuild } from '../ui/lib/buildPolicy.js';

let failures = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nA live build is never interrupted');
{
  check('running', !isInterruptedBuild({
    active: true, jobStatus: 'running', projectState: 'building',
  }));

  // The subscription-pause case: parked on purpose, resumes by itself
  // (SPEC §2.3b). The API reports it as `active`, and a banner telling Roman to
  // restart it would undo a deliberate wait.
  check('paused on the subscription limit', !isInterruptedBuild({
    active: true, jobStatus: 'retry_wait', projectState: 'building',
  }));

  // The one non-live status that must NOT draw the banner. A build waiting its
  // turn behind another has not started, so it cannot have stopped.
  check('queued behind another build', !isInterruptedBuild({
    active: false, jobStatus: 'queued', projectState: 'pending',
  }));
}

console.log('\nA build the reconciler closed IS interrupted');
{
  // The exact shape the endpoint returns after the reconciler has run: the job
  // mirror row is `stale` (bookkeeping, deliberately not `failed`) and the
  // orphaned project has been failed.
  check('stale job, failed project', isInterruptedBuild({
    active: false, jobStatus: 'stale', projectState: 'failed',
  }));

  // Reconciler reached the job but the project row is still mid-flight —
  // possible between the two passes, and the stale job alone is enough.
  check('stale job, project not yet failed', isInterruptedBuild({
    active: false, jobStatus: 'stale', projectState: 'building',
  }));

  // pg-boss retention eventually PURGES the job, so an old interruption has no
  // job row left at all. The frozen project is then the only evidence.
  check('no job row survives, project failed', isInterruptedBuild({
    active: false, jobStatus: null, projectState: 'failed',
  }));

  check('no job row and no project state', isInterruptedBuild({
    active: false, jobStatus: undefined, projectState: null,
  }));
}

console.log('\nA build that finished is not interrupted either');
{
  check('succeeded and deployed', !isInterruptedBuild({
    active: false, jobStatus: 'succeeded', projectState: 'deployed',
  }));

  // A genuine failure has a `failed` job and its own error to show; it is a job
  // problem, not an interruption. The project state alone would have been
  // enough to misfile it, which is why jobStatus is checked first.
  check('the job failed for a real reason', !isInterruptedBuild({
    active: false, jobStatus: 'failed', projectState: 'building',
  }));

  // The critic refused it after three passes: a decision, with its own card.
  check('parked for human review', !isInterruptedBuild({
    active: false, jobStatus: 'succeeded', projectState: 'needs_human_review',
  }));
}

console.log('\nBefore the first poll answers');
{
  // `active` unknown means "we have not heard from the factory yet". Guessing
  // interrupted here would flash the banner on every page load.
  check('undefined active is not a verdict', !isInterruptedBuild({
    active: undefined, jobStatus: null, projectState: 'building',
  }));
  check('null active is not a verdict', !isInterruptedBuild({
    active: null, jobStatus: 'stale', projectState: 'failed',
  }));
}

console.log(failures === 0 ? '\nAll interrupted-build tests passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures > 0 ? 1 : 0);
