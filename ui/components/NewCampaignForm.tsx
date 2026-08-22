'use client';

import { useState } from 'react';
import { ActionForm } from './ActionForm';
import { createCampaign } from '@/lib/actions';
import {
  BUILD_POLICIES, BUILD_POLICY_HINTS, BUILD_POLICY_LABELS, DEFAULT_BUILD_POLICY,
} from '@/lib/buildPolicy';

/**
 * Creating a campaign, as two questions instead of eleven fields.
 *
 * City and niche are what Roman actually decides. Search queries, the map
 * centre, the radius and the business cap are things the factory has sane
 * defaults for and that he changes once a year — so they sit under
 * «Додаткові налаштування», pre-filled, not gone.
 *
 * The whole form is collapsed until clicked: it is a monthly action on a page
 * he opens to check numbers.
 */
export function NewCampaignForm() {
  const [open, setOpen] = useState(false);
  const [autoBuild, setAutoBuild] = useState(DEFAULT_BUILD_POLICY);
  const [city, setCity] = useState('');
  const [niche, setNiche] = useState('');

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
                <input id="country" name="country" defaultValue="GR" />
              </div>
              <div>
                <label className="label" htmlFor="language">Мова</label>
                <input id="language" name="language" defaultValue="el" />
              </div>
              <div>
                <label className="label" htmlFor="radiusKm">Радіус, км</label>
                <input id="radiusKm" name="radiusKm" type="number" defaultValue="10" />
              </div>
              <div>
                <label className="label" htmlFor="targetCount">Ліміт бізнесів</label>
                <input id="targetCount" name="targetCount" type="number" defaultValue="50" />
              </div>
              <div>
                <label className="label" htmlFor="lat">Широта</label>
                <input id="lat" name="lat" type="number" step="any" defaultValue="38.2466" />
              </div>
              <div>
                <label className="label" htmlFor="lng">Довгота</label>
                <input id="lng" name="lng" type="number" step="any" defaultValue="21.7346" />
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
