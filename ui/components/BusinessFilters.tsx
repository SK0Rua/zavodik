'use client';

/**
 * Filters for the businesses list.
 *
 * Three chips are visible, and they are the three questions Roman actually asks:
 * who has no site, who is ready for a demo, who is waiting on me. Everything
 * else — campaign, individual statuses, audit verdicts, contact channels, a
 * score floor — is real and kept, but folded into «ще фільтри», because a
 * twenty-chip wall was the single biggest source of "натикано всього".
 *
 * State stays in the URL, not in the component: the view Roman is looking at has
 * to survive being sent to himself and reopened on the phone.
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { BUSINESS_STATUSES } from '@/lib/format';
import { humanStatus } from '@/lib/humanStatus';
import { AUDIT_VERDICTS, NO_SITE_VERDICT_LIST } from '@/lib/buildPolicy';
import { humanVerdict } from '@/lib/humanStatus';
import { NO_VERDICT, SORT_FIELDS, SORT_LABELS, type SortField } from '@/lib/sort';

const CONTACT_FILTERS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
];

function Chip({ active, children, onClick, title }: {
  active: boolean; children: React.ReactNode; onClick: () => void; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-accent text-white border-accent'
          : 'bg-paper-card text-ink-soft border-line hover:border-line-strong hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

export function BusinessFilters({ campaigns }: { campaigns: Array<{ id: string }> }) {
  const router = useRouter();
  const params = useSearchParams();

  const statuses = useMemo(() => params.getAll('status'), [params]);
  const verdicts = useMemo(() => params.getAll('verdict'), [params]);
  const contacts = useMemo(() => params.getAll('contact'), [params]);

  const push = useCallback((mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    router.push(`/businesses?${next.toString()}`);
  }, [params, router]);

  const toggle = useCallback((key: string, value: string) => {
    push((p) => {
      if (key === 'status') p.delete('attention');
      const current = p.getAll(key);
      p.delete(key);
      for (const v of current.includes(value) ? current.filter((x) => x !== value) : [...current, value]) {
        p.append(key, v);
      }
    });
  }, [push]);

  const setOne = useCallback((key: string, value: string) => {
    push((p) => { if (value) p.set(key, value); else p.delete(key); });
  }, [push]);

  /** Replace a whole multi-value key at once (used by the three preset chips). */
  const setMany = useCallback((key: string, values: string[]) => {
    push((p) => {
      if (key === 'status') p.delete('attention');
      p.delete(key);
      for (const v of values) p.append(key, v);
    });
  }, [push]);

  const noSiteOn = verdicts.length === NO_SITE_VERDICT_LIST.length
    && NO_SITE_VERDICT_LIST.every((v) => verdicts.includes(v));
  const readyOn = statuses.length === 1 && statuses[0] === 'production_ready';
  const waitingOn = params.get('attention') === '1';

  const extrasActive = Boolean(params.get('campaign')) || Boolean(params.get('minScore'))
    || contacts.length > 0
    || (statuses.length > 0 && !readyOn && !waitingOn)
    || (verdicts.length > 0 && !noSiteOn);

  return (
    <div className="space-y-3">
      {/* ── search ── */}
      <input
        defaultValue={params.get('q') ?? ''}
        placeholder="Пошук за назвою"
        aria-label="Пошук за назвою"
        onBlur={(e) => setOne('q', e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') setOne('q', e.currentTarget.value); }}
      />

      {/* ── three questions + sort ── */}
      <div className="flex gap-2 flex-wrap items-center">
        <Chip
          active={noSiteOn}
          onClick={() => setMany('verdict', noSiteOn ? [] : NO_SITE_VERDICT_LIST)}
          title="Аудит не знайшов у них робочого сайту"
        >
          Без сайту
        </Chip>
        <Chip
          active={readyOn}
          onClick={() => setMany('status', readyOn ? [] : ['production_ready'])}
        >
          Готові до демо
        </Chip>
        <Chip
          active={waitingOn}
          onClick={() => push((p) => {
            p.delete('status');
            if (waitingOn) p.delete('attention');
            else p.set('attention', '1');
          })}
        >
          Чекають мене
        </Chip>

        <div className="ml-auto flex items-center gap-1">
          <label className="sr-only" htmlFor="f-sort">Сортувати</label>
          <select
            id="f-sort"
            value={(params.get('sort') as SortField) ?? 'score'}
            onChange={(e) => setOne('sort', e.target.value)}
            className="w-auto text-sm"
          >
            {SORT_FIELDS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
          </select>
          <button
            type="button"
            className="btn-quiet btn-sm"
            title="Напрямок сортування"
            onClick={() => setOne('dir', params.get('dir') === 'asc' ? 'desc' : 'asc')}
          >
            {params.get('dir') === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      {/* ── everything else ── */}
      <details open={extrasActive}>
        <summary className="disclosure">
          ще фільтри{extrasActive && ' · застосовані'}
        </summary>

        <div className="mt-4 space-y-4 pl-4 border-l-2 border-line">
          <div>
            <span className="label">Стан</span>
            <div className="flex gap-1.5 flex-wrap">
              {BUSINESS_STATUSES.map((s) => (
                <Chip key={s} active={statuses.includes(s)} onClick={() => toggle('status', s)} title={s}>
                  {humanStatus(s).text}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <span className="label">Їхній нинішній сайт</span>
            <div className="flex gap-1.5 flex-wrap">
              {AUDIT_VERDICTS.map((v) => (
                <Chip key={v} active={verdicts.includes(v)} onClick={() => toggle('verdict', v)} title={v}>
                  {humanVerdict(v).text}
                </Chip>
              ))}
              <Chip active={verdicts.includes(NO_VERDICT)} onClick={() => toggle('verdict', NO_VERDICT)}>
                Не перевіряли
              </Chip>
            </div>
          </div>

          <div>
            <span className="label">Є контакт</span>
            <div className="flex gap-1.5 flex-wrap">
              {CONTACT_FILTERS.map((c) => (
                <Chip key={c.value} active={contacts.includes(c.value)} onClick={() => toggle('contact', c.value)}>
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex gap-3 flex-wrap items-end">
            <div className="min-w-[180px]">
              <label className="label" htmlFor="f-campaign">Кампанія</label>
              <select
                id="f-campaign"
                value={params.get('campaign') ?? ''}
                onChange={(e) => setOne('campaign', e.target.value)}
              >
                <option value="">усі</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
              </select>
            </div>
            <div className="w-28">
              <label className="label" htmlFor="f-score">Бал від</label>
              <input
                id="f-score"
                type="number"
                min={0}
                max={100}
                defaultValue={params.get('minScore') ?? ''}
                placeholder="0"
                onBlur={(e) => setOne('minScore', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') setOne('minScore', e.currentTarget.value); }}
              />
            </div>
            <a href="/businesses?all=1" className="btn-quiet btn-sm no-underline">Скинути все</a>
          </div>
        </div>
      </details>
    </div>
  );
}
