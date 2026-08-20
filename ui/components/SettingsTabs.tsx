'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Two halves of "how the factory is set up": what I configure, and how it is
 * doing. Jobs and errors used to be a top-level nav item; they are diagnostics
 * Roman opens when something looks wrong, not a place he works, so they live
 * here as the second tab.
 */
const TABS = [
  { href: '/settings', label: 'Налаштування' },
  { href: '/settings/system', label: 'Система' },
];

export function SettingsTabs({ problemCount }: { problemCount: number }) {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-line mb-6 -mt-1">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`px-3 py-2.5 text-sm no-underline border-b-2 -mb-px transition-colors ${
              active
                ? 'border-accent text-ink font-medium'
                : 'border-transparent text-ink-mute hover:text-ink'
            }`}
          >
            {t.label}
            {t.href === '/settings/system' && problemCount > 0 && (
              <span className="ml-1.5 tabular-nums text-dot-stop">{problemCount}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
