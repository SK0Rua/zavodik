'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The settings sidebar — one section per screenful, replacing the single page
 * that stacked accounts, mode, four parameter cards and a JSON panel into one
 * scroll (Roman, 2026-08-22: «суцільний хаос і навала купи тексту»).
 *
 * Six sections, in the order Roman sets the factory up: connect the accounts,
 * tune the agents, decide what outreach is allowed to do, then the rarer ones.
 * «Діагностика» sits after a divider because it is a different kind of page —
 * reading, not configuring — and it carries the problem count so a failure is
 * visible from any section.
 *
 * On a phone the same list turns into one horizontally-scrollable row of chips:
 * a second vertical nav under the top nav would spend half the viewport on
 * navigation.
 */
export const SETTINGS_SECTIONS = [
  { href: '/settings/accounts', label: 'Акаунти' },
  { href: '/settings/agents', label: 'Агенти' },
  { href: '/settings/outreach', label: 'Outreach' },
  { href: '/settings/media', label: 'Медіа' },
  { href: '/settings/general', label: 'Система' },
] as const;

const DIAGNOSTICS = { href: '/settings/system', label: 'Діагностика' };

function Item({ href, label, active, badge }: {
  href: string; label: string; active: boolean; badge?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`shrink-0 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap no-underline transition-colors md:block ${
        active
          ? 'bg-accent-soft text-accent font-medium'
          : 'text-ink-soft hover:text-ink hover:bg-paper-sunk'
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="ml-1.5 tabular-nums text-dot-stop font-normal">{badge}</span>
      )}
    </Link>
  );
}

export function SettingsNav({ problemCount }: { problemCount: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Розділи налаштувань"
      className="flex md:flex-col gap-1 md:w-44 md:shrink-0 md:sticky md:top-20
                 overflow-x-auto md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0
                 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {SETTINGS_SECTIONS.map((s) => (
        <Item key={s.href} href={s.href} label={s.label} active={pathname === s.href} />
      ))}
      {/* Reading, not configuring — hence the divider. On the phone row the
          divider has no room, so it becomes a small gap instead. */}
      <div aria-hidden className="md:border-t md:border-line md:my-2 md:mx-3 ml-2 md:ml-3" />
      <Item
        href={DIAGNOSTICS.href}
        label={DIAGNOSTICS.label}
        active={pathname === DIAGNOSTICS.href}
        badge={problemCount}
      />
    </nav>
  );
}
