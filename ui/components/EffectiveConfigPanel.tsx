'use client';

import { useState, useTransition } from 'react';
import { fetchEffectiveConfig } from '@/lib/settingsActions';

/**
 * "Я змінив значення — чи бачить його фабрика?", for the case where the answer
 * matters more than the page's own word for it.
 *
 * Collapsed by default, and small. Each field row above now carries its own
 * provenance mark («змінено» / «з .env» / nothing), which answers that question
 * for the one key Roman is actually looking at — so the full dump stopped being
 * a panel and became what it always was: a debugging escape hatch for the day
 * the per-field marks and the running process disagree.
 *
 * Secrets are reported as booleans by the factory; nothing sensitive is echoed.
 */
export function EffectiveConfigPanel({ agentsOnly = false }: { agentsOnly?: boolean }) {
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

  const visibleData = data && agentsOnly
    ? Object.fromEntries(Object.entries(data).filter(([key]) => key.startsWith('agent')))
    : data;

  return (
    <details className="card p-5 group">
      {/* globals.css hides the native marker, so the triangle is explicit —
          otherwise this is a heading that happens to be clickable. */}
      <summary className="flex items-baseline gap-2 text-sm font-medium text-ink">
        <span aria-hidden className="text-ink-mute transition-transform group-open:rotate-90">›</span>
        {agentsOnly ? 'Фактичний runtime і моделі' : 'Ефективна конфігурація (JSON)'}
        <span className="text-ink-mute font-normal">що бачить процес factory просто зараз</span>
      </summary>

      <div className="mt-4 space-y-3">
        <p className="text-sm text-ink-mute max-w-[70ch]">
          Читається з живого процесу, а не з цієї сторінки. Якщо збережене значення тут ще старе —
          зачекай ~15 секунд і запитай ще раз: саме стільки живе кеш налаштувань.
        </p>
        <button type="button" className="btn-outline btn-sm w-full sm:w-auto" onClick={load} disabled={pending}>
          {pending ? 'Питаю…' : 'Запитати процес factory'}
        </button>
        {error && <p className="text-sm text-dot-stop">{error}</p>}
        {visibleData && (
          <div className="overflow-x-auto">
            <dl className="grid grid-cols-[minmax(0,14rem)_1fr] gap-x-4 gap-y-1 text-sm">
              {Object.entries(visibleData).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-mute truncate">{k}</dt>
                  <dd className="text-ink break-all font-mono">{JSON.stringify(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </details>
  );
}
