'use client';

/**
 * The three answers to "the critic refused this build", as header buttons.
 *
 * The same three server actions the inbox card calls — one implementation of the
 * behaviour, two places it can be reached from. On the business card these live
 * in the header band, because Roman's complaint was exactly this: the decision
 * sat at the bottom of a tab full of screenshots, so acting on it meant scrolling
 * past everything he had already read.
 *
 * The two answers that need a sentence from him (another iteration, rejecting the
 * business) open a small form in place. The third publishes, and asks first.
 */

import { useState, useTransition } from 'react';
import type { ActionResult } from '@/lib/types';
import { runWithToast } from '@/lib/toast';
import { deployBuildAsIs, rejectBuild, requestAnotherIteration } from '@/lib/buildReviewActions';

export function BuildDecisionActions({ projectId, name, onModeChange }: {
  projectId: number;
  name: string;
  /** Lets the band drop its general explanation while a form is open. */
  onModeChange?: (open: boolean) => void;
}) {
  const [mode, setModeState] = useState<'idle' | 'iterate' | 'reject'>('idle');
  const setMode = (m: 'idle' | 'iterate' | 'reject') => {
    setModeState(m);
    onModeChange?.(m !== 'idle');
  };
  const [note, setNote] = useState('');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const done = result?.ok === true;

  const ship = () => {
    if (!window.confirm(
      `Опублікувати демо для «${name}» як є?\n\n`
      + 'Критик його не прийняв. Після публікації воно потрапить у Вхідні '
      + 'на підтвердження відправки — саме собою нікому не надішлеться.',
    )) return;
    startTransition(() => {
      void runWithToast(() => deployBuildAsIs(projectId), { onResult: setResult });
    });
  };

  const iterate = () => startTransition(() => {
    void runWithToast(() => requestAnotherIteration({ projectId, note }), {
      onResult: (res) => { setResult(res); if (res.ok) { setMode('idle'); setNote(''); } },
    });
  });

  const drop = () => startTransition(() => {
    void runWithToast(() => rejectBuild({ projectId, reason: note }), {
      onResult: (res) => { setResult(res); if (res.ok) setMode('idle'); },
    });
  });

  if (done) {
    return <p role="status" className="text-sm text-accent py-2">{result?.message}</p>;
  }

  return (
    <div className="w-full">
      {mode === 'idle' && (
        <div className="flex items-center gap-2.5 flex-wrap">
          <button type="button" className="btn-primary" onClick={ship} disabled={pending}>
            Опублікувати як є
          </button>
          <button
            type="button"
            className="btn-outline"
            onClick={() => setMode('iterate')}
            disabled={pending}
          >
            Ще спроба
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => setMode('reject')}
            disabled={pending}
          >
            Відхилити
          </button>
        </div>
      )}

      {mode === 'iterate' && (
        <div className="space-y-2.5 max-w-[62ch]">
          <label className="label" htmlFor={`hdr-note-${projectId}`}>Що поправити</label>
          <textarea
            id={`hdr-note-${projectId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Наприклад: прибрати фото у масці, зробити всі фото в одному теплому тоні, додати рух при скролі."
          />
          <p className="text-sm text-ink-mute">
            Це піде агентові як головне завдання — важливіше за зауваження критика.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={iterate}
              disabled={pending || !note.trim()}
            >
              {pending ? 'Ставлю в чергу…' : 'Запустити спробу'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setMode('idle')}>
              Скасувати
            </button>
          </div>
        </div>
      )}

      {mode === 'reject' && (
        <div className="space-y-2.5 max-w-[62ch]">
          <label className="label" htmlFor={`hdr-rej-${projectId}`}>Чому відхиляєш</label>
          <input
            id={`hdr-rej-${projectId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
            placeholder="причина — запишеться в історію"
          />
          <p className="text-sm text-ink-mute">
            Бізнес піде у «Відхилено». Зібрані дані і докази лишаються в базі.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-danger" onClick={drop} disabled={pending}>
              {pending ? 'Відхиляю…' : 'Відхилити бізнес'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setMode('idle')}>
              Скасувати
            </button>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <p role="status" className="text-sm text-dot-stop mt-2.5">{result.message}</p>
      )}
    </div>
  );
}
