'use client';

import { useState, useTransition } from 'react';
import { Status } from '@/components/Status';
import { setFactoryMode } from '@/lib/settingsActions';
import { runWithToast } from '@/lib/toast';

/**
 * The one setting that decides whether real businesses get messaged, and
 * therefore the one that leads the page rather than sitting in a list.
 *
 * It gets a typed confirmation instead of a plain button because a stray click
 * here is not a misconfiguration — it is an outbound message to a stranger that
 * cannot be recalled. The confirmation spells out what changes rather than
 * asking «впевнений?», which is a question nobody has ever answered "no" to.
 *
 * Switching BACK to dry_run needs no confirmation at all: the safe direction
 * should never have friction, and a person reaching for it usually wants it to
 * have happened already.
 */
export function FactoryModeSwitch({ current }: { current: 'dry_run' | 'live' }) {
  const [mode, setMode] = useState(current);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function apply(next: 'dry_run' | 'live') {
    startTransition(() => {
      void runWithToast(() => setFactoryMode(next), {
        onResult: (res) => {
          setMsg(res.message);
          if (res.ok) { setMode(next); setConfirming(false); setTyped(''); }
        },
      });
    });
  }

  const live = mode === 'live';

  return (
    <section className={`card p-5 ${live ? 'border-dot-wait/50' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="h-section">Режим фабрики</h2>
            <Status tone={live ? 'wait' : 'go'} title={mode}>
              {live ? 'бойовий' : 'тестовий'}
            </Status>
          </div>
          <p className="text-sm text-ink-mute mt-1 max-w-[70ch]">
            {live
              ? 'Кожен approve надсилає справжнє повідомлення справжньому бізнесу.'
              : 'Approve створює запис про відправку, але нікому нічого не йде. Усе інше — пошук, збір даних, збірка демо — працює по-справжньому в обох режимах.'}
          </p>
        </div>

        {live ? (
          <button
            type="button" className="btn-outline btn-sm w-full sm:w-auto shrink-0"
            disabled={pending} onClick={() => apply('dry_run')}
          >
            {pending ? 'Перемикаю…' : 'Повернути в тестовий'}
          </button>
        ) : confirming ? null : (
          <button
            type="button" className="btn-outline btn-sm w-full sm:w-auto shrink-0"
            onClick={() => setConfirming(true)}
          >
            Перейти в бойовий
          </button>
        )}
      </div>

      {confirming && !live && (
        <div className="mt-4 rounded-lg border border-dot-wait/40 bg-dot-wait/8 p-4 space-y-3">
          <p className="text-sm text-ink">У бойовому режимі, з моменту перемикання:</p>
          <ul className="text-sm text-ink-soft space-y-1 list-disc pl-5 max-w-[70ch]">
            <li>кожен approve надсилає повідомлення в WhatsApp або лист на пошту бізнесу;</li>
            <li>нагадування йдуть за розкладом самі, без окремого підтвердження;</li>
            <li>надіслане відкликати неможливо.</li>
          </ul>
          <label className="block">
            <span className="label">Впиши <code>live</code>, щоб підтвердити</span>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={typed} onChange={(e) => setTyped(e.target.value)}
                placeholder="live" autoComplete="off" spellCheck={false}
                className="font-mono text-sm w-full sm:w-32"
              />
              <button
                type="button" className="btn-primary btn-sm w-full sm:w-auto"
                disabled={typed.trim() !== 'live' || pending}
                onClick={() => apply('live')}
              >
                {pending ? 'Перемикаю…' : 'Увімкнути бойовий'}
              </button>
              <button
                type="button" className="btn-outline btn-sm w-full sm:w-auto"
                onClick={() => { setConfirming(false); setTyped(''); }}
              >
                Скасувати
              </button>
            </div>
          </label>
        </div>
      )}

      {msg && <p className="text-sm text-ink-soft mt-3">{msg}</p>}
    </section>
  );
}
