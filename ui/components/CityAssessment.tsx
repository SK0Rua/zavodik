'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm } from './ActionForm';
import { Status } from './Status';
import { assessCity } from '@/lib/actions';
import { NICHES } from '@/lib/niches';
import { fmtDate } from '@/lib/format';
import type { DotTone } from '@/lib/humanStatus';
import { COUNTRIES, LANGUAGES } from '@factory/regions';

export interface AssessmentRow {
  id: number;
  city: string;
  niche: string;
  country: string;
  status: string; // running | done | failed
  found: number | null;
  noSite: number | null;
  hasSite: number | null;
  socialOnly: number | null;
  avgRating: number | null;
  verdict: string | null; // go | maybe | skip
  sample: Array<{ name: string; rating: number | null; reviewCount: number | null; hasSite: boolean }> | null;
  error: string | null;
  createdAt: string;
}

/** verdict / status → the word and dot colour Roman reads. */
function verdictView(row: AssessmentRow): { tone: DotTone; text: string } {
  if (row.status === 'running') return { tone: 'idle', text: 'Оцінюю…' };
  if (row.status === 'failed') return { tone: 'stop', text: 'Помилка' };
  switch (row.verdict) {
    case 'go': return { tone: 'go', text: 'Варто запускати' };
    case 'maybe': return { tone: 'wait', text: 'Так собі' };
    case 'skip': return { tone: 'stop', text: 'Не варто' };
    default: return { tone: 'idle', text: '—' };
  }
}

/**
 * «Оцінити місто» — a quick gosom probe before committing to a campaign.
 *
 * The probe runs in the background (a few minutes), so this keeps a live list of
 * recent assessments and polls while any is still running: nothing to watch, no
 * page to babysit. Each result says the one thing Roman wants — how many leads,
 * how many with no site, and a plain verdict.
 */
export function CityAssessment({
  recent,
  defaultCountry = 'GR',
  defaultLanguage = 'el',
}: {
  recent: AssessmentRow[];
  defaultCountry?: string;
  defaultLanguage?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [niche, setNiche] = useState('');
  const [lat, setLat] = useState('38.2466');
  const [lng, setLng] = useState('21.7346');
  const [coordsError, setCoordsError] = useState('');

  // While a probe is running, refresh the server data so its result appears on
  // its own. Stops polling the moment nothing is running.
  const anyRunning = recent.some((r) => r.status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [anyRunning, router]);

  function applyCoords(raw: string) {
    const parts = raw.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 2) { setCoordsError('Очікую дві координати через кому'); return; }
    const [a, b] = parts.map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) { setCoordsError('Не схоже на координати'); return; }
    if (Math.abs(a) > 90 || Math.abs(b) > 180) { setCoordsError('Широта ≤ 90, довгота ≤ 180'); return; }
    setLat(String(a)); setLng(String(b)); setCoordsError('');
  }

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="h-section">Оцінити місто</h2>
          <p className="text-sm text-ink-mute mt-1 max-w-prose">
            Швидка проба перед кампанією: скільки бізнесів у ніші й скільки з них без свого сайту.
            Триває кілька хвилин, результат зʼявиться нижче сам.
          </p>
        </div>
        {!open && (
          <button type="button" className="btn-outline btn-sm" onClick={() => setOpen(true)}>
            Нова оцінка
          </button>
        )}
      </div>

      {open && (
        <ActionForm
          action={assessCity}
          className="mt-4 space-y-4"
          onDone={() => { setOpen(false); setNiche(''); }}
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="assess-city">Місто</label>
              <input id="assess-city" name="city" required placeholder="Patras" />
            </div>
            <div>
              <label className="label" htmlFor="assess-niche">Ніша</label>
              <input
                id="assess-niche" name="niche" required placeholder="обери або впиши свою"
                list="niche-options" autoComplete="off"
                value={niche} onChange={(e) => setNiche(e.target.value)}
              />
              <datalist id="niche-options">
                {NICHES.map((n) => <option key={n.value} value={n.value} label={n.label} />)}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="label" htmlFor="assess-country">Країна</label>
              <select id="assess-country" name="country" defaultValue={defaultCountry}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="assess-language">Мова</label>
              <select id="assess-language" name="language" defaultValue={defaultLanguage}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name} ({l.code})</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="assess-radius">Радіус, км</label>
              <input id="assess-radius" name="radiusKm" type="number" defaultValue="10" />
            </div>
            <div>
              <label className="label" htmlFor="assess-depth">Глибина</label>
              <input id="assess-depth" name="depth" type="number" min="1" max="3" defaultValue="2" />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="assess-coords">Координати центру з Google Maps</label>
            <input
              id="assess-coords" inputMode="decimal" placeholder="50.906868, 34.788767"
              onChange={(e) => applyCoords(e.target.value)}
              onPaste={(e) => applyCoords(e.clipboardData.getData('text'))}
            />
            <p className={`text-sm mt-1.5 ${coordsError ? 'text-dot-stop' : 'text-ink-mute'}`}>
              {coordsError || 'Правий клік на точці в Google Maps → перший рядок меню, встав сюди.'}
            </p>
            <input type="hidden" name="lat" value={lat} />
            <input type="hidden" name="lng" value={lng} />
          </div>

          <div className="flex gap-2">
            <button type="submit" className="btn-primary">Оцінити</button>
            <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>Скасувати</button>
          </div>
        </ActionForm>
      )}

      {recent.length > 0 && (
        <ul className="mt-5 space-y-3">
          {recent.map((r) => {
            const v = verdictView(r);
            const share = r.found && r.found > 0 && r.noSite !== null
              ? Math.round((r.noSite / r.found) * 100) : null;
            return (
              <li key={r.id} className="border border-line rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="font-medium">{r.city} · {r.niche}</div>
                    <div className="mt-0.5">
                      <Status tone={v.tone} title={r.verdict ?? r.status}>{v.text}</Status>
                    </div>
                  </div>
                  <span className="text-sm text-ink-mute">{fmtDate(r.createdAt)}</span>
                </div>

                {r.status === 'done' && (
                  <div className="mt-3 flex gap-6 sm:gap-8 flex-wrap text-sm">
                    <span><span className="text-lg font-semibold tabular-nums text-ink">{r.found ?? 0}</span> знайдено</span>
                    <span>
                      <span className="text-lg font-semibold tabular-nums text-ink">{r.noSite ?? 0}</span> без сайту
                      {share !== null && <span className="text-ink-mute"> ({share}%)</span>}
                    </span>
                    {r.socialOnly ? <span><span className="text-lg font-semibold tabular-nums text-ink">{r.socialOnly}</span> лише соцмережі/каталог</span> : null}
                    {r.avgRating !== null && <span>рейтинг ~<span className="font-semibold tabular-nums text-ink">{r.avgRating}</span></span>}
                  </div>
                )}

                {r.status === 'failed' && (
                  <p className="mt-2 text-sm text-dot-stop">{r.error || 'проба не вдалася — спробуй ще раз'}</p>
                )}

                {r.status === 'done' && r.sample && r.sample.length > 0 && (
                  <details className="mt-3">
                    <summary className="disclosure text-sm">Приклади бізнесів ({r.sample.length})</summary>
                    <ul className="mt-2 pl-4 border-l-2 border-line space-y-1 text-sm text-ink-soft">
                      {r.sample.map((s, i) => (
                        <li key={i}>
                          {s.name}
                          <span className="text-ink-mute">
                            {s.rating !== null ? ` · ${s.rating}★` : ''}
                            {s.reviewCount !== null ? ` · ${s.reviewCount} відг.` : ''}
                            {s.hasSite ? ' · має сайт' : ' · без сайту'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
