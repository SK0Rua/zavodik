const TONES = {
  ok: 'text-dot-go border-dot-go/30 bg-dot-go/8',
  warn: 'text-dot-wait border-dot-wait/30 bg-dot-wait/8',
  bad: 'text-dot-stop border-dot-stop/30 bg-dot-stop/8',
  info: 'text-accent border-accent/25 bg-accent-soft',
  idle: 'text-ink-mute border-line bg-paper-sunk',
} as const;

export type Tone = keyof typeof TONES;

/**
 * A small bordered tag, kept for the SETTINGS surfaces only.
 *
 * Everywhere Roman works day to day, a status is a word with a dot
 * (`components/Status.tsx`) — a row of filled pills is what made the old console
 * unreadable. Settings is the exception: it shows machine-level facts (a service
 * is up or down, a value came from the DB or from env) where a compact tag next
 * to a technical label genuinely is the clearest form.
 */
export function Badge({ children, tone = 'idle', title }: {
  children: React.ReactNode; tone?: Tone; title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
