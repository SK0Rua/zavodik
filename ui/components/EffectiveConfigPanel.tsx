'use client';

import { useState, useTransition } from 'react';
import { fetchEffectiveConfig } from '@/lib/settingsActions';

/**
 * Answers "я змінив значення в UI — чи бачить його фабрика?" without reading
 * container logs. It asks the RUNNING factory process what it currently
 * believes the configuration to be, so a value that has not propagated yet
 * (TTL is 15 seconds) is visibly different here from what the form shows.
 *
 * Secrets are reported as booleans by the factory; nothing sensitive is echoed.
 */
export function EffectiveConfigPanel() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      const res = await fetchEffectiveConfig();
      if (res.ok && res.config) { setData(res.config); setError(null); }
      else { setData(null); setError(res.message ?? 'невідома помилка'); }
    });
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-ink">Що бачить фабрика зараз</h2>
        <button type="button" className="btn-ghost text-xs" onClick={load} disabled={pending}>
          {pending ? 'Питаю…' : 'Запитати процес factory'}
        </button>
      </div>
      <p className="text-xs text-ink-mute">
        Значення читаються з живого процесу. Після збереження нове значення з’являється тут протягом ~15 секунд —
        це і є доказ, що перезапуск не потрібен.
      </p>
      {error && <p className="text-sm text-dot-stop">{error}</p>}
      {data && (
        <dl className="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-4 gap-y-1 text-xs">
          {Object.entries(data).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-mute truncate">{k}</dt>
              <dd className="text-ink break-all font-mono">{JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
