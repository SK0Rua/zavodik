'use client';

/**
 * The «Розширені» section, rebuilt as the settings body.
 *
 * It used to be one `<details>` containing seven group forms containing every
 * one of the ~51 registry keys, all of them open, all of them in edit mode, all
 * of them equally prominent — Roman's «всюди насрано в купу, особливо у
 * розширених» (2026-08-22).
 *
 * Three decisions fix that, in order of how much they remove:
 *
 *  1. **Most keys are not settings, they are constants that happen to be
 *     configurable.** A gosom job timeout, an IMAP poll size, a landing.gallery
 *     tolerance — nobody opens this page to change those. They are marked
 *     `advanced` in the registry and hidden behind one toggle per card, which
 *     takes the visible surface from ~51 fields to ~17.
 *  2. **Search beats structure once there are thirty of anything.** The box at
 *     the top matches label, key and hint across every group INCLUDING hidden
 *     advanced fields — because someone who types "timeout" has already told you
 *     they want the rare one.
 *  3. **Credentials live in one place, and it is not here.** «Підключені
 *     акаунти» above owns the tokens; what is left in these cards is the
 *     plumbing around them.
 */

import { useMemo, useState } from 'react';
import { SettingField } from '@/components/SettingField';
import type { SettingGroup, SettingView } from '@/lib/settings';

interface Group { id: SettingGroup; title: string; blurb: string }

/** Case-insensitive, accent-naive substring match over the three text fields. */
function matches(field: SettingView, needle: string): boolean {
  if (!needle) return true;
  const hay = `${field.label} ${field.key} ${field.hint ?? ''}`.toLowerCase();
  return needle.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function GroupCard({ group, fields, query, locked }: {
  group: Group;
  fields: SettingView[];
  query: string;
  locked: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  const common = fields.filter((f) => !f.advanced);
  const rare = fields.filter((f) => f.advanced);

  // A search result is not a browsing session: when Roman typed something, the
  // hidden fields are the whole point, so the toggle is bypassed rather than
  // silently hiding half the matches behind a control he cannot see the need for.
  const searching = query.trim() !== '';
  const visible = searching || showAll ? fields : common;

  if (visible.length === 0) return null;

  // Overrides are worth counting at the card level: it is the answer to "what
  // did I change in here", which is otherwise a scroll.
  const changed = fields.filter((f) => f.source === 'db').length;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-medium text-ink">{group.title}</h3>
        {changed > 0 && !searching && (
          <span className="inline-flex items-baseline gap-1.5 text-sm text-ink-soft">
            <span aria-hidden className="inline-block w-[6px] h-[6px] rounded-full bg-accent shrink-0 translate-y-[-2px]" />
            змінено: {changed}
          </span>
        )}
      </div>
      <p className="text-sm text-ink-mute mt-0.5 max-w-[70ch]">{group.blurb}</p>

      <div className="mt-3">
        {visible.map((f) => (
          <SettingField key={f.key} field={f} locked={locked} />
        ))}
      </div>

      {!searching && rare.length > 0 && (
        <button
          type="button"
          className="btn-quiet btn-sm mt-2 -ml-2.5"
          aria-expanded={showAll}
          onClick={() => setShowAll((s) => !s)}
        >
          {showAll ? 'Згорнути рідковживані' : `Показати всі параметри (+${rare.length})`}
        </button>
      )}
    </section>
  );
}

export function SettingsBody({ groups, fields, masterKeyConfigured }: {
  groups: Group[];
  fields: SettingView[];
  masterKeyConfigured: boolean;
}) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => fields.filter((f) => matches(f, query)),
    [fields, query],
  );

  const byGroup = useMemo(() => {
    const m = new Map<SettingGroup, SettingView[]>();
    for (const f of filtered) {
      const list = m.get(f.group);
      if (list) list.push(f); else m.set(f.group, [f]);
    }
    return m;
  }, [filtered]);

  const nothing = query.trim() !== '' && filtered.length === 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="h-section">Параметри</h2>
          <p className="text-sm text-ink-mute mt-1 max-w-[70ch]">
            Зміни діють наживо — фабрика перечитує їх протягом ~15 секунд, без перезапуску.
            Точка біля назви означає, що значення задав ти; решта працює на типових.
          </p>
        </div>
      </div>

      <label className="block">
        <span className="sr-only">Пошук параметра</span>
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Знайти параметр — напр. «ліміт», «модель», «timeout»"
          autoComplete="off" spellCheck={false}
          className="w-full"
        />
      </label>

      {nothing ? (
        <p className="card p-5 text-sm text-ink-mute">
          Нічого не знайшлося. Спробуй частину назви або сам ключ — напр. <code>SMTP</code>.
        </p>
      ) : (
        <div className="grid gap-4">
          {groups.map((g) => {
            const gf = byGroup.get(g.id) ?? [];
            if (gf.length === 0) return null;
            return (
              <GroupCard
                key={g.id} group={g} fields={gf} query={query}
                locked={!masterKeyConfigured}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
