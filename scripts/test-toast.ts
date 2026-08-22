/**
 * Offline tests for the console's feedback layer.
 *
 * No docker, no database, no browser: both things tested here are pure
 * functions that decide what Roman is told after a click, and the whole point
 * of extracting them was that "did the toast say the right thing?" should be
 * answerable with the stack down.
 *
 * What is worth pinning, and why each of these is here rather than left to a
 * manual click:
 *
 *  1. **The reducer's cap and ordering.** A bulk action plus three quick clicks
 *     is how the column overflows, and an off-by-one in `slice(-MAX)` drops the
 *     NEWEST toast instead of the oldest — the one failure mode that would make
 *     the feature actively worse than the inline messages it replaced.
 *  2. **The empty-message drop.** Several server actions return
 *     `{ok: true, message: ''}` on a no-op path. A blank toast says "something
 *     happened" and nothing else, which is the exact complaint being fixed.
 *  3. **Tone follows `ok`, never the words.** A failure whose message happens
 *     to read cheerfully must still be red.
 *
 *   pnpm test:toast
 */
import {
  dismissToast, getToasts, reduceToasts, resetToasts, toast, toastResult,
  runWithToast, TOAST_MS, type Toast,
} from '../ui/lib/toast.js';

let failures = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const t = (id: number, message = `m${id}`): Toast => ({ id, tone: 'success', message });

// ─── the reducer ─────────────────────────────────────────────────────────────

console.log('\nReducer');
{
  const one = reduceToasts([], { type: 'push', toast: t(1) });
  check('push adds a toast', one.length === 1 && one[0]!.id === 1);

  const two = reduceToasts(one, { type: 'push', toast: t(2) });
  check('newest goes last', two.map((x) => x.id).join(',') === '1,2');

  // Five pushes against a cap of four: the OLDEST must be the one that goes.
  let many: Toast[] = [];
  for (let i = 1; i <= 6; i++) many = reduceToasts(many, { type: 'push', toast: t(i) });
  check('cap holds at four', many.length === 4, `got ${many.length}`);
  check(
    'the oldest fall off, not the newest',
    many.map((x) => x.id).join(',') === '3,4,5,6',
    many.map((x) => x.id).join(','),
  );

  const dismissed = reduceToasts(many, { type: 'dismiss', id: 4 });
  check('dismiss removes exactly one', dismissed.map((x) => x.id).join(',') === '3,5,6');

  const missing = reduceToasts(many, { type: 'dismiss', id: 999 });
  check('dismissing an unknown id changes nothing', missing.length === many.length);

  check('clear empties', reduceToasts(many, { type: 'clear' }).length === 0);
}

// ─── the module surface ──────────────────────────────────────────────────────

console.log('\nPushing toasts');
{
  resetToasts();
  toast('success', 'Стан змінено');
  check('a toast lands in the store', getToasts().length === 1);
  check('the message is kept verbatim', getToasts()[0]!.message === 'Стан змінено');

  resetToasts();
  check('an empty message is dropped', toast('success', '') === null && getToasts().length === 0);
  check('whitespace counts as empty', toast('error', '   \n ') === null && getToasts().length === 0);

  resetToasts();
  const id = toast('error', 'Не вдалося');
  check('ids are handed back', typeof id === 'number');
  dismissToast(id!);
  check('dismiss by the returned id works', getToasts().length === 0);
}

console.log('\ntoastResult: tone follows `ok`');
{
  resetToasts();
  toastResult({ ok: false, message: 'Все чудово, але ні' });
  check('a failure is an error toast whatever it says', getToasts()[0]!.tone === 'error');

  resetToasts();
  toastResult({ ok: true, message: 'Помилок немає' });
  check('a success is a success toast whatever it says', getToasts()[0]!.tone === 'success');

  resetToasts();
  toastResult({ ok: true, message: '' }, 'Збережено');
  check('the fallback fills an empty message', getToasts()[0]!.message === 'Збережено');

  resetToasts();
  toastResult({ ok: true, message: 'Своє' }, 'Запасне');
  check('the action’s own message wins over the fallback', getToasts()[0]!.message === 'Своє');

  check('a failure stays on screen longer than a success', TOAST_MS.error > TOAST_MS.success);
}

console.log('\nrunWithToast');
{
  resetToasts();
  const ok = await runWithToast(async () => ({ ok: true, message: 'Готово' }));
  check('the result is passed through', ok?.message === 'Готово');
  check('and toasted', getToasts().length === 1 && getToasts()[0]!.tone === 'success');

  resetToasts();
  let sawResult = false;
  await runWithToast(async () => ({ ok: false, message: 'Ні' }), {
    onResult: () => { sawResult = true; },
  });
  check('onResult fires for a failure too', sawResult);
  check('a refusal is an error toast', getToasts()[0]!.tone === 'error');

  // The case that produced NOTHING before: an action that throws left the
  // button un-disabling with no message anywhere, which looks exactly like a
  // click that never happened.
  resetToasts();
  const thrown = await runWithToast(async () => { throw new Error('ECONNREFUSED'); });
  check('a thrown action returns null rather than rejecting', thrown === null);
  check('and still produces an error toast', getToasts().length === 1);
  check(
    'whose message names the cause',
    getToasts()[0]!.message.includes('ECONNREFUSED'),
    getToasts()[0]!.message,
  );
}

console.log(failures === 0 ? '\nAll toast tests passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures > 0 ? 1 : 0);
