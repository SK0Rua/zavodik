'use client';

import { useState } from 'react';
import { ActionForm } from './ActionForm';
import { createCampaign } from '@/lib/actions';
import {
  BUILD_POLICIES, BUILD_POLICY_HINTS, BUILD_POLICY_LABELS, DEFAULT_BUILD_POLICY,
} from '@/lib/buildPolicy';
import { COUNTRIES, LANGUAGES } from '@factory/regions';

/**
 * Creating a campaign, as two questions instead of eleven fields.
 *
 * City and niche are what Roman actually decides. Search queries, the map
 * centre, the radius and the business cap are things the factory has sane
 * defaults for and that he changes once a year — so they sit under
 * «Додаткові налаштування», pre-filled, not gone.
 *
 * Country and language are no longer typed by hand: they default to whatever
 * Roman set on /settings and are picked from a list, so a run never silently
 * comes out Greek just because that was the last hard-coded value.
 *
 * The whole form is collapsed until clicked: it is a monthly action on a page
 * he opens to check numbers.
 */
export function NewCampaignForm({
  defaultCountry = 'GR',
  defaultLanguage = 'el',
}: {
  defaultCountry?: string;
  defaultLanguage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [autoBuild, setAutoBuild] = useState(DEFAULT_BUILD_POLICY);
  const [city, setCity] = useState('');
  const [niche, setNiche] = useState('');
  // Lat/lng are controlled so the single "paste from Google" box can fill both.
  const [lat, setLat] = useState('38.2466');
  const [lng, setLng] = useState('21.7346');
  const [coordsError, setCoordsError] = useState('');

  if (!open) {
    return (
      <button type="button" className="btn-outline" onClick={() => setOpen(true)}>
        Нова кампанія
      </button>
    );
  }

  // Sensible starting queries so the required field is never an empty box: the
  // language pair matters (Greek businesses are listed in both), and typing
  // three Google queries by hand is exactly the kind of work the form should do.
  const suggestedQueries = city && niche
    ? `${niche} ${city}\n${niche} salon ${city}\n${city} ${niche}`
    : '';

  /**
   * Accept "50.906868, 34.788767" exactly as Google Maps copies it (right-click
   * → the first line of the context menu is «lat, lng»). Splits on comma or
   * whitespace, fills both boxes, and says so instead of silently doing nothing
   * when the paste is not a coordinate pair.
   */
  function applyCoords(raw: string) {
    const parts = raw.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 2) { setCoordsError('Очікую дві координати через кому'); return; }
    const [a, b] = parts.map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) { setCoordsError('Не схоже на координати'); return; }
    if (Math.abs(a) > 90 || Math.abs(b) > 180) { setCoordsError('Широта ≤ 90, довгота ≤ 180'); return; }
    setLat(String(a));
    setLng(String(b));
    setCoordsError('');
  }

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="h-section mb-5">Нова кампанія</h2>

      {/* Collapses itself once the campaign exists: the form has done its job,
          and leaving it open next to the campaign it just created invites a
          second one. The toast is what says it worked. */}
      <ActionForm
        action={createCampaign}
        className="space-y-5"
        onDone={() => { setOpen(false); setCity(''); setNiche(''); }}
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="city">Місто</label>
            <input
              id="city" name="city" required placeholder="Patras"
              value={city} onChange={(e) => setCity(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="niche">Ніша</label>
            <input
              id="niche" name="niche" required placeholder="beauty"
              value={niche} onChange={(e) => setNiche(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="autoBuild">Кому фабрика сама будує демо</label>
          <select id="autoBuild" name="autoBuild" value={autoBuild} onChange={(e) => setAutoBuild(e.target.value as typeof autoBuild)}>
            {BUILD_POLICIES.map((p) => (
              <option key={p} value={p}>{BUILD_POLICY_LABELS[p]}</option>
            ))}
          </select>
          <p className="text-sm text-ink-mute mt-1.5">{BUILD_POLICY_HINTS[autoBuild]}</p>
        </div>

        <details>
          <summary className="disclosure">Додаткові налаштування</summary>
          <div className="mt-4 space-y-4 pl-4 border-l-2 border-line">
            <div>
              <label className="label" htmlFor="queries">Пошукові запити, по одному в рядок</label>
              <textarea
                id="queries" name="queries" required rows={4}
                key={suggestedQueries}
                defaultValue={suggestedQueries}
                placeholder={'nail salon Patras\nκομμωτήριο Πάτρα'}
                className="font-mono"
              />
              <p className="text-sm text-ink-mute mt-1.5">
                Додай варіант місцевою мовою — так знаходиться вдвічі більше.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="label" htmlFor="country">Країна</label>
                <select id="country" name="country" defaultValue={defaultCountry}>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="language">Мова</label>
                <select id="language" name="language" defaultValue={defaultLanguage}>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>{l.name} ({l.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="radiusKm">Радіус, км</label>
                <input id="radiusKm" name="radiusKm" type="number" defaultValue="10" />
              </div>
              <div>
                <label className="label" htmlFor="targetCount">Ліміт бізнесів</label>
                <input id="targetCount" name="targetCount" type="number" defaultValue="50" />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="coordsPaste">Координати центру з Google Maps</label>
              <input
                id="coordsPaste"
                inputMode="decimal"
                placeholder="50.906868, 34.788767"
                onChange={(e) => applyCoords(e.target.value)}
                onPaste={(e) => applyCoords(e.clipboardData.getData('text'))}
              />
              <p className={`text-sm mt-1.5 ${coordsError ? 'text-dot-stop' : 'text-ink-mute'}`}>
                {coordsError
                  || 'Правий клік на точці в Google Maps → перший рядок меню, встав сюди — широта й довгота заповняться самі.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="lat">Широта</label>
                <input
                  id="lat" name="lat" type="number" step="any"
                  value={lat} onChange={(e) => setLat(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="lng">Довгота</label>
                <input
                  id="lng" name="lng" type="number" step="any"
                  value={lng} onChange={(e) => setLng(e.target.value)}
                />
              </div>
            </div>
          </div>
        </details>

        <div className="flex gap-2">
          <button type="submit" className="btn-primary">Створити і почати пошук</button>
          <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>Скасувати</button>
        </div>
      </ActionForm>
    </section>
  );
}
