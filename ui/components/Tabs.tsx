'use client';

import { useState } from 'react';

export interface TabDef {
  id: string;
  label: string;
  /** Shown next to the label when there is something to count. */
  count?: number;
  content: React.ReactNode;
}

/**
 * Client-side tabs for the business card.
 *
 * The card used to be twelve stacked sections — facts, contacts, audit,
 * screenshots, assets, gaps, history, the demo project, messages and three
 * manual-action forms — about four screens of scrolling before anything useful.
 * Tabs mean the answer to "what is this business" is on the first screen and
 * everything else is one tap away.
 *
 * Deliberately NOT URL-driven: which tab is open is a glance, not a view worth
 * sending to yourself, and putting it in the URL would make every tap a server
 * round-trip on a page that already has all its data.
 */
export function Tabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id ?? '');
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div
        role="tablist"
        // `relative z-10` so the tabs stay above the sticky action band that
        // scrolls past them on a phone. Without a stacking position of their
        // own the band covered the strip and every tab tap hit the band.
        className="relative z-10 flex gap-1 border-b border-line bg-paper overflow-x-auto
                   [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t) => {
          const on = t.id === current?.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => setActive(t.id)}
              className={`px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                on
                  ? 'border-accent text-ink font-medium'
                  : 'border-transparent text-ink-mute hover:text-ink'
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1.5 tabular-nums opacity-60">{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="pt-6">{current?.content}</div>
    </div>
  );
}
