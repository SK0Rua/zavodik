'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@/components/Badge';
import { setFactoryMode } from '@/lib/settingsActions';

/**
 * The one setting that decides whether real businesses get messaged.
 *
 * It gets its own control with a typed confirmation rather than living in a
 * group form, because a stray click here is not a misconfiguration — it is an
 * outbound message to a stranger. Switching back to dry_run needs no
 * confirmation: the safe direction should never have friction.
 */
export function FactoryModeSwitch({ current }: { current: 'dry_run' | 'live' }) {
  const [mode, setMode] = useState(current);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function apply(next: 'dry_run' | 'live') {
    startTransition(async () => {
      const res = await setFactoryMode(next);
      setMsg(res.message);
      if (res.ok) { setMode(next); setConfirming(false); setTyped(''); }
    });
  }

  const live = mode === 'live';

  return (
    <section className={`card p-4 ${live ? 'border-dot-wait/50' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-ink">Режим фабрики</h2>
        {/* The raw enum `dry_run` was showing next to its own translation
            (sweep P1-14). The machine value stays as the tooltip. */}
        <Badge tone={live ? 'warn' : 'ok'}>
          <span title={mode}>{live ? 'Бойовий — реальні відправки' : 'Тестовий — лише симуляція'}</span>
        </Badge>
        {live ? (
          <button type="button" className="btn-ghost text-xs" disabled={pending} onClick={() => apply('dry_run')}>
            Повернути в тестовий
          </button>
        ) : confirming ? null : (
          <button type="button" className="btn-ghost text-xs" onClick={() => setConfirming(true)}>
            Перемкнути в бойовий
          </button>
        )}
      </div>

      {confirming && !live && (
        <div className="mt-3 rounded-md border border-dot-wait/40 bg-dot-wait/10 p-3 space-y-2">
          <p className="text-sm text-dot-wait">
            У режимі live кожен схвалений approve надсилає <strong>реальне повідомлення реальному бізнесу</strong>.
            Відкликати надіслане неможливо. Впиши <code>live</code> для підтвердження.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={typed} onChange={(e) => setTyped(e.target.value)}
              placeholder="live" className="font-mono text-sm w-32"
            />
            <button
              type="button" className="btn-danger text-xs"
              disabled={typed.trim() !== 'live' || pending}
              onClick={() => apply('live')}
            >
              Увімкнути live
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => { setConfirming(false); setTyped(''); }}>
              Скасувати
            </button>
          </div>
        </div>
      )}

      {msg && <p className="text-sm text-ink-soft mt-2">{msg}</p>}
    </section>
  );
}
