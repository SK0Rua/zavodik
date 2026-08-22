'use client';

/**
 * One settings section: the fields of ONE registry group, plus a search box
 * that deliberately sees ALL of them.
 *
 * This replaced `SettingsBody`, which rendered all four groups on one page —
 * the «навала купи тексту» (Roman, 2026-08-22) that the sidebar split undoes.
 * Two of its decisions survive unchanged, because they were answers to the same
 * complaint:
 *
 *  1. **Most keys are constants that happen to be configurable.** Fields marked
 *     `advanced` in the registry hide behind one «Показати всі параметри»
 *     toggle per group.
 *  2. **Search beats structure once there are thirty of anything.** The box
 *     matches label, key and hint across EVERY group including hidden advanced
 *     fields — someone who types "timeout" has already said they want the rare
 *     one, and someone who types "SMTP" on the agents page must not be told
 *     "нічого немає" because the answer lives one sidebar item away. Results
 *     from other sections render right here, under their group's name.
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

function GroupCard({ group, fields, searching, showTitle, locked }: {
  group: Group;
  fields: SettingView[];
  searching: boolean;
  /** Search results name their group; the section's own card does not repeat the sidebar. */
  showTitle: boolean;
  locked: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  const common = fields.filter((f) => !f.advanced);
  const rare = fields.filter((f) => f.advanced);

  // A search result is not a browsing session: when Roman typed something, the
  // hidden fields are the whole point, so the toggle is bypassed rather than
  // silently hiding half the matches behind a control he cannot see the need for.
  const visible = searching ? fields : common;

  if (visible.length === 0 && !(showAll && rare.length > 0)) return null;

  // Overrides are worth counting at the card level: it is the answer to "what
  // did I change in here", which is otherwise a scroll.
  const changed = fields.filter((f) => f.source === 'db').length;

  return (
    <section className="card p-5">
      {(showTitle || changed > 0) && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
          {showTitle
            ? <h3 className="text-base font-medium text-ink">{group.title}</h3>
            : <span aria-hidden />}
          {changed > 0 && !searching && (
            <span className="inline-flex items-baseline gap-1.5 text-sm text-ink-soft">
              <span aria-hidden className="inline-block w-[6px] h-[6px] rounded-full bg-accent shrink-0 translate-y-[-2px]" />
              змінено: {changed}
            </span>
          )}
        </div>
      )}

      <div>
        {visible.map((f) => (
          <SettingField key={f.key} field={f} locked={locked} />
        ))}
      </div>

      {/* The rare fields expand BELOW this button, never interleaved into the
          list above in registry order — that was the first version, and it
          shoved every row Roman was looking at to a new place the moment he
          clicked (Roman, 2026-08-22: «розкривається і я гублюсь де я був»).
          Nothing above the button moves; the new rows only grow the page down. */}
      {!searching && rare.length > 0 && (
        <>
          <button
            type="button"
            className="btn-quiet btn-sm mt-2 -ml-2.5"
            aria-expanded={showAll}
            onClick={() => setShowAll((s) => !s)}
          >
            <span
              aria-hidden
              className={`text-ink-mute transition-transform duration-150 ${showAll ? 'rotate-90' : ''}`}
            >
              ▸
            </span>
            {showAll ? 'Рідковживані параметри' : `Показати всі параметри (+${rare.length})`}
          </button>
          {showAll && (
            <div className="mt-1 border-t border-line">
              {rare.map((f) => (
                <SettingField key={f.key} field={f} locked={locked} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function SettingsSection({ groups, fields, active, masterKeyConfigured }: {
  groups: Group[];
  /** ALL registry fields, every group — search needs them; browsing shows one. */
  fields: SettingView[];
  active: SettingGroup;
  masterKeyConfigured: boolean;
}) {
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';

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

  const activeGroup = groups.find((g) => g.id === active);
  const shownGroups = searching ? groups : groups.filter((g) => g.id === active);
  const nothing = searching && filtered.length === 0;

  return (
    <section className="space-y-4">
      {activeGroup && (
        <p className="text-sm text-ink-mute max-w-[70ch]">{activeGroup.blurb}</p>
      )}

      <label className="block">
        <span className="sr-only">Пошук параметра</span>
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Знайти параметр у всіх розділах — напр. «ліміт», «модель», «timeout»"
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
          {shownGroups.map((g) => {
            const gf = byGroup.get(g.id) ?? [];
            if (gf.length === 0) return null;
            return (
              <GroupCard
                key={g.id} group={g} fields={gf}
                searching={searching} showTitle={searching}
                locked={!masterKeyConfigured}
              />
            );
          })}
        </div>
      )}

      <p className="text-sm text-ink-mute max-w-[70ch]">
        Зміни діють наживо — фабрика перечитує їх протягом ~15 секунд, без перезапуску.
        Точка біля назви означає, що значення задав ти; решта працює на типових.
      </p>
    </section>
  );
}
