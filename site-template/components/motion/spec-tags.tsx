'use client';

import { cn } from '@/lib/utils';

export interface SpecItem {
  /** The fact itself, e.g. 'Ανταύγειες' or 'OPEN-PLAN KITCHEN'. */
  label: string;
  /** Optional right-hand value — a price, a duration, a size. `list` variant only. */
  value?: string;
  /** Optional third line revealed on hover/focus. `list` variant only. */
  note?: string;
}

export interface SpecTagsProps {
  /**
   * The facts. Feed this straight from snapshot facts — every entry must trace
   * to evidence. A padded list is exactly what this component makes obvious.
   */
  items: SpecItem[];
  /**
   * 'pills' — wrapped row of hairline-bordered uppercase tags (son-daven's
   *           amenity block). Best for 4-10 short facts with no values.
   * 'list'  — hairline-divided rows, label left / value right, with an index
   *           column (son-daven's timeline block). Best when facts have values
   *           (services + prices) or when there are more than ~8.
   * Default 'pills'.
   */
  variant?: 'pills' | 'list';
  /** Show a zero-padded index (01, 02…) per row. `list` variant. Default true. */
  showIndex?: boolean;
  /** Optional small uppercase caption above the block. */
  caption?: string;
  className?: string;
}

/**
 * Facts as an art-directed spec block, not a bullet list.
 *
 * The highest payoff-per-line item in GAPS.md, and the one that helps a LOCAL
 * BUSINESS specifically: a services or amenities list rendered as hairline
 * uppercase micro-type reads art-directed, where the same words as `<li>`s read
 * like a template.
 *
 * Typography is taken from son-daven directly: ~11px, `0.12em` tracking,
 * uppercase, 1px hairline border, fully rounded, padding 6px 14px. The layout
 * is deliberately RAGGED — each pill is only as wide as its content and rows
 * hold 2-3 pills. Do not equalise the widths; a tidy grid of equal pills is the
 * three-identical-cards cliché in a different costume.
 *
 * No motion of its own — it is typography, and it composes inside `BlurFade` or
 * `MaskWipe` when an entrance is wanted. That also means it is inert under
 * reduced motion with nothing to disable.
 *
 *   <SpecTags caption="Υπηρεσίες" items={services.map(s => ({ label: s.name, value: s.price }))} variant="list" />
 */
export function SpecTags({
  items,
  variant = 'pills',
  showIndex = true,
  caption,
  className,
}: SpecTagsProps) {
  if (items.length === 0) return null;

  return (
    <div className={cn('w-full', className)}>
      {caption && (
        <p className="mb-6 font-body text-[0.6875rem] uppercase tracking-[0.2em] text-muted">
          {caption}
        </p>
      )}

      {variant === 'pills' ? (
        <ul className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item.label}
              className={cn(
                'rounded-full border border-border px-3.5 py-1.5',
                'font-body text-[0.6875rem] uppercase leading-snug tracking-[0.12em] text-muted',
                'transition-colors duration-300 hover:border-accent hover:text-foreground',
              )}
            >
              {item.label}
              {item.value && <span className="ml-2 text-foreground">{item.value}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <dl className="border-t border-border">
          {items.map((item, i) => (
            <div
              key={item.label}
              className={cn(
                'group grid grid-cols-[auto_1fr_auto] items-baseline gap-x-4 gap-y-1',
                'border-b border-border py-4 md:gap-x-8 md:py-5',
                'transition-colors duration-300 hover:border-accent',
              )}
            >
              {showIndex && (
                <span
                  aria-hidden="true"
                  className="font-body text-[0.625rem] tabular-nums tracking-[0.15em] text-muted"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
              )}
              <dt
                className={cn(
                  'font-body text-xs uppercase tracking-[0.14em] text-foreground md:text-[0.8125rem]',
                  !showIndex && 'col-start-2',
                )}
              >
                {item.label}
              </dt>
              {item.value && (
                <dd className="justify-self-end font-body text-xs tabular-nums text-muted md:text-[0.8125rem]">
                  {item.value}
                </dd>
              )}
              {item.note && (
                // Revealed on hover AND on keyboard focus within the row, and
                // always rendered so it is never hidden from a screen reader or
                // from a touch visitor who cannot hover.
                <dd
                  className={cn(
                    'col-span-3 max-w-prose font-body text-xs leading-relaxed text-muted',
                    'opacity-60 transition-opacity duration-300',
                    'group-hover:opacity-100 group-focus-within:opacity-100',
                    showIndex && 'md:col-start-2 md:col-span-2',
                  )}
                >
                  {item.note}
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default SpecTags;
