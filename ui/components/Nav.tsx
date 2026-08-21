'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Four destinations, in the order Roman works: what needs me → who we found →
 * what we're running → how it's set up. Jobs and system health moved INSIDE
 * Налаштування as a sub-tab; they are diagnostics, not a daily destination, and
 * a fifth top-level item for them was part of the clutter.
 */
/**
 * `short` is what the item is called when four labels plus «Вийти» do not fit
 * a 390px row. «Налаштування» is 12 characters and was the one that overflowed,
 * clipping to «Налаштуванн» and colliding with «Вийти» (sweep P2-1). A shorter
 * real word beats a truncated long one: «Налашт…» is not a word, «Опції» is.
 */
const LINKS = [
  { href: '/inbox', label: 'Вхідні' },
  { href: '/businesses', label: 'Бізнеси' },
  { href: '/campaigns', label: 'Кампанії' },
  { href: '/settings', label: 'Налаштування', short: 'Опції' },
];

export function Nav({ pendingCount }: { pendingCount: number }) {
  const pathname = usePathname();
  return (
    <header className="border-b border-line bg-paper/85 backdrop-blur-md sticky top-0 z-20">
      <div className="mx-auto max-w-console px-4 sm:px-6">
        <div className="flex items-center gap-2 h-14">
          {/* Hidden below `sm`: at 390px the wordmark, four destinations and
              «Вийти» do not fit, and the result was «Налаштуванн» colliding with
              «Вийти» (sweep P2-1). The wordmark is the one item that carries no
              information a person needs — the nav itself says where they are —
              so it is what gives up its space. */}
          <Link
            href="/inbox"
            className="hidden sm:block font-semibold text-ink no-underline shrink-0 mr-2 tracking-tight"
          >
            Фабрика
          </Link>

          {/* Scrolls on a narrow phone instead of wrapping to a second row.
              `-ml-1 pl-1` only — the old `-mx-1` pulled the scroll box a step
              to the RIGHT as well, so its last item ran under «Вийти» and the
              two collided at 390px (sweep P2-1). The right edge now stops
              where the logout button begins. */}
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto -ml-1 pl-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? 'page' : undefined}
                  // `shrink-0` matters as much as `whitespace-nowrap`: without
                  // it flex compresses each item below its content width and the
                  // label is clipped rather than the row scrolling (sweep P2-1).
                  className={`shrink-0 rounded-lg px-2.5 sm:px-3 py-1.5 text-sm whitespace-nowrap no-underline transition-colors ${
                    active
                      ? 'bg-accent-soft text-accent font-medium'
                      : 'text-ink-soft hover:text-ink hover:bg-paper-sunk'
                  }`}
                >
                  {/* Same destination, two spellings — the short one only on
                      the screen that cannot fit the long one. */}
                  {l.short ? (
                    <>
                      <span className="sm:hidden">{l.short}</span>
                      <span className="hidden sm:inline">{l.label}</span>
                    </>
                  ) : l.label}
                  {l.href === '/inbox' && pendingCount > 0 && (
                    <span className="ml-1.5 tabular-nums text-ink-mute font-normal">{pendingCount}</span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* `bg-paper` + `pl-2`: the nav beside it is a scroll container, so an
              item scrolled to the edge would otherwise show THROUGH from under
              this button. */}
          <form action="/api/auth/logout" method="post" className="ml-1 pl-2 shrink-0 bg-paper">
            {/* Was bare text with a hover colour — the same "is this clickable?"
                as «Налаштування кампанії». `btn-quiet` is the lightest thing
                that still reads as a control, which is right for a logout
                sitting beside the four destinations. */}
            <button type="submit" className="btn-quiet btn-sm">Вийти</button>
          </form>
        </div>
      </div>
    </header>
  );
}
