import type { DotTone } from '@/lib/humanStatus';

const DOT: Record<DotTone, string> = {
  go: 'bg-dot-go',
  wait: 'bg-dot-wait',
  stop: 'bg-dot-stop',
  idle: 'bg-dot-idle',
};

/**
 * A status is a WORD with a small dot — never a filled pill.
 *
 * Six coloured pills on one row is the "badge salad" Roman was looking at. A
 * sentence with a 6px dot reads at a glance, survives being next to five other
 * statuses, and prints the same in a list row and in a card header. `title`
 * carries the raw enum value so the machine state is still recoverable.
 */
export function Status({ tone, children, title, className = '' }: {
  tone: DotTone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 text-sm text-ink-soft ${className}`} title={title}>
      <span className={`inline-block w-[6px] h-[6px] rounded-full shrink-0 translate-y-[-2px] ${DOT[tone]}`} />
      <span>{children}</span>
    </span>
  );
}

/** A count with its label under it. Used in the empty state and on campaign cards. */
export function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <div className="text-xl font-semibold tabular-nums text-ink">{value}</div>
      <div className="text-label uppercase font-semibold text-ink-mute mt-0.5">{label}</div>
    </div>
  );
}
