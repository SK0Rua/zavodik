'use client';

/**
 * «Збірка наживо» — what the agent is doing right now.
 *
 * The problem this solves, in Roman's words: a build had been running for over
 * an hour and the card said «Виконується» and nothing else — "я хз шо там". A
 * status word cannot distinguish a build on its fourth QA iteration from a
 * process that died an hour ago, and those need opposite reactions.
 *
 * So: the pipeline milestones as a timeline with real durations, the agent's
 * own actions as a tail below it, and — the point of the whole panel — an
 * explicit warning when nothing has happened for a while, because silence is
 * the signal a person actually needs and it is the one thing a spinner hides.
 *
 * The list itself is strictly read-only: no control here starts or stops
 * anything. What it now also carries is a link to the build's REAL terminal —
 * Roman asked for «можливість підключення до термінальної сесії», because a
 * summary is not the same as watching the agent work. That link is read-only
 * too unless BUILD_TERMINAL_WRITABLE is on, which the panel says out loud.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface BuildLogLine {
  t: string;
  type: 'stage' | 'text' | 'tool' | 'result' | 'error';
  summary: string;
  tool?: string;
  status?: 'ok' | 'error';
  agent?: string;
}

/**
 * A live terminal session for this build, when the tmux runtime is in use.
 * `url` is null when nothing is published to attach to — in that case the
 * session name is still shown, because it is what an SSH attach needs.
 */
interface TerminalInfo {
  session: string;
  url: string | null;
  writable: boolean;
  startedAt: string;
}

interface Poll {
  ok: boolean;
  lines?: BuildLogLine[];
  nextOffset?: number;
  lastEventAgoSec?: number | null;
  active?: boolean;
  jobStatus?: string | null;
  jobType?: string | null;
  runningForSec?: number | null;
  projectState?: string | null;
  terminal?: TerminalInfo | null;
  message?: string;
}

/** How long an agent may be silent before the panel says so, in seconds. */
const QUIET_WARN_SEC = 300;
/** Events kept in the browser. The tail is what matters; older lines fall off. */
const MAX_KEPT = 300;
const POLL_MS = 4000;

/** «1 год 12 хв» / «7 хв» / «40 с» — a duration a person reads, not h:mm:ss. */
function humanDuration(totalSec: number): string {
  if (totalSec < 60) return `${Math.round(totalSec)} с`;
  const min = Math.round(totalSec / 60);
  if (min < 60) return `${min} хв`;
  const h = Math.floor(min / 60);
  return `${h} год${min % 60 ? ` ${min % 60} хв` : ''}`;
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

/**
 * One agent action in words.
 *
 * Tool names are English and always will be — they are the SDK's. What changes
 * is the verb around them: «✎ app/page.tsx» says more at a glance than
 * «Edit(app/page.tsx)», and «$ pnpm build» is instantly recognisable as a
 * command. Anything unrecognised falls through to the tool's own name rather
 * than being dropped, so a new tool degrades to something readable.
 */
function renderLine(line: BuildLogLine): { glyph: string; text: string; tone: string } {
  if (line.type === 'stage') return { glyph: '●', text: line.summary, tone: 'text-ink font-medium' };
  if (line.type === 'error') return { glyph: '!', text: line.summary, tone: 'text-dot-stop' };
  if (line.type === 'result') {
    return line.status === 'error'
      ? { glyph: '↳', text: line.summary, tone: 'text-dot-wait' }
      // A successful tool result carries no information a person needs — the
      // action above it already said what was attempted. Kept as a faint tick
      // so the rhythm of work is visible without adding a line of noise.
      : { glyph: '↳', text: 'ok', tone: 'text-ink-mute/60' };
  }
  if (line.type === 'text') return { glyph: '', text: `агент: ${line.summary}`, tone: 'text-ink-soft' };

  switch (line.tool) {
    case 'Edit': return { glyph: '✎', text: line.summary || 'правка файлу', tone: 'text-ink-soft' };
    case 'Write': return { glyph: '✚', text: line.summary || 'новий файл', tone: 'text-ink-soft' };
    case 'Read': return { glyph: '👁', text: line.summary || 'читає файл', tone: 'text-ink-mute' };
    case 'Bash': return { glyph: '$', text: line.summary || 'команда', tone: 'text-ink-soft font-mono' };
    case 'Glob':
    case 'Grep': return { glyph: '⌕', text: line.summary || 'шукає', tone: 'text-ink-mute' };
    case 'WebSearch': return { glyph: '⌕', text: line.summary || 'шукає в мережі', tone: 'text-ink-mute' };
    default: return { glyph: '·', text: line.summary || line.tool || 'дія', tone: 'text-ink-mute' };
  }
}

export function LiveBuildPanel({ projectId, projectState }: {
  projectId: number;
  projectState: string;
}) {
  const [lines, setLines] = useState<BuildLogLine[]>([]);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const offset = useRef(0);
  // Kept in a ref rather than in state: the interval closure reads it, and
  // putting it in state would re-create the interval on every tick.
  const stopped = useRef(false);

  const tick = useCallback(async () => {
    try {
      const res = await fetch(`/api/build-log?projectId=${projectId}&after=${offset.current}`, {
        cache: 'no-store',
      });
      const body = await res.json() as Poll;
      if (!res.ok || body.ok === false) {
        setError(body.message || `Не вдалося прочитати лог (${res.status}).`);
        return;
      }
      setError(null);
      setPoll(body);
      if (typeof body.nextOffset === 'number') offset.current = body.nextOffset;
      if (body.lines?.length) {
        setLines((prev) => [...prev, ...body.lines!].slice(-MAX_KEPT));
      }
      // A finished job stops the polling loop, but the lines stay on screen:
      // this panel becomes the record of the run that just ended.
      if (body.active === false && body.jobStatus && body.jobStatus !== 'queued') {
        stopped.current = true;
      }
    } catch (err) {
      setError(`Немає звʼязку з фабрикою: ${String(err).slice(0, 120)}`);
    }
  }, [projectId]);

  useEffect(() => {
    void tick();
    const id = setInterval(() => {
      if (stopped.current) return;
      void tick();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [tick]);

  const stages = lines.filter((l) => l.type === 'stage');
  const visible = showAll ? lines : lines.slice(-40);
  const quietSec = poll?.lastEventAgoSec ?? null;
  const isQuiet = poll?.active === true && quietSec !== null && quietSec > QUIET_WARN_SEC;

  // The iteration number, read off the stage markers rather than passed in:
  // the log is the thing that knows, and a prop would go stale between polls.
  const iterationLine = [...stages].reverse().find((s) => /Ітерац/i.test(s.summary));
  // Only while the job is actually running: the marker can outlive the session
  // by a heartbeat, and a dead attach link reads as a broken feature.
  const terminal = poll?.active ? poll.terminal ?? null : null;

  return (
    <section className="card p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="label mb-0">Збірка наживо</h3>
        <span className="text-sm text-ink-mute">
          {poll?.active
            ? `йде ${poll.runningForSec ? humanDuration(poll.runningForSec) : '…'}`
            : poll?.jobStatus
              ? `завдання: ${poll.jobStatus}`
              : 'дивлюсь…'}
          {iterationLine && ` · ${iterationLine.summary.split(':')[0]}`}
        </span>
      </div>

      {/* The one row that answers "чи воно ще живе?". Shown only when it is
          genuinely worrying — a panel that always warns warns about nothing. */}
      {isQuiet && (
        <p className="mt-3 rounded-lg border border-dot-wait/40 bg-dot-wait/10 px-3 py-2 text-sm text-dot-wait">
          Агент мовчить уже {humanDuration(quietSec!)}. Це буває під час довгого
          {' '}<span className="font-mono">pnpm build</span> або поки чекаємо на вікно підписки.
          Завдання саме зупиниться через 90 хв і піде на повтор.
        </p>
      )}

      {error && (
        <p className="mt-3 text-sm text-dot-wait">{error}</p>
      )}

      {/* The real terminal. Everything else in this panel is a summary of what
          the agent did; this is the agent's actual session, scrollback and all.
          Shown only while it exists — a link to a finished session is a 404. */}
      {terminal && (
        <div className="mt-4 rounded-lg border border-line bg-paper-sunk/50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-ink-soft">
              Агент працює в живій термінальній сесії{' '}
              <span className="font-mono text-ink">{terminal.session}</span>.
            </p>
            {terminal.url && (
              <a
                className="btn-quiet btn-sm"
                href={terminal.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                Відкрити термінал збірки ↗
              </a>
            )}
          </div>
          {!terminal.url && (
            <p className="mt-1.5 text-sm text-ink-mute">
              Веб-термінал не налаштований. Підключитись можна по SSH:{' '}
              <span className="font-mono">tmux attach -r -t {terminal.session}</span>{' '}
              у контейнері <span className="font-mono">factory-build</span>.
            </p>
          )}
          {terminal.writable && (
            <p className="mt-1.5 text-sm text-dot-wait">
              Термінал у режимі втручання: те, що ви наберете, піде живому агенту
              і змінить демо без approval і без сліду в історії.
            </p>
          )}
        </div>
      )}

      {stages.length > 0 && (
        <ol className="mt-4 space-y-1.5">
          {stages.map((s, i) => {
            const next = stages[i + 1];
            const took = next
              ? (new Date(next.t).getTime() - new Date(s.t).getTime()) / 1000
              : null;
            return (
              <li key={`${s.t}-${i}`} className="flex gap-3 text-sm">
                <span className="text-ink-mute tabular-nums shrink-0 w-12">{clockTime(s.t)}</span>
                <span className="min-w-0 flex-1 text-ink">{s.summary}</span>
                {took !== null && took >= 30 && (
                  <span className="text-ink-mute tabular-nums shrink-0">{humanDuration(took)}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {lines.length === 0 && !error && (
        <p className="mt-3 text-sm text-ink-mute">
          Поки що нічого не записано. Якщо збірка щойно стала в чергу — перші рядки зʼявляться
          за хвилину.
        </p>
      )}

      {visible.length > 0 && (
        <>
          <div
            className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-line bg-paper-sunk/50 p-3 space-y-1"
            // Newest at the bottom, like a terminal; the box scrolls, the page never does.
            aria-live="polite"
          >
            {visible.map((l, i) => {
              const r = renderLine(l);
              return (
                <div key={`${l.t}-${i}`} className="flex gap-2 text-sm leading-snug">
                  <span className="text-ink-mute tabular-nums shrink-0 w-12">{clockTime(l.t)}</span>
                  <span className="shrink-0 w-4 text-ink-mute">{r.glyph}</span>
                  <span className={`min-w-0 flex-1 break-words ${r.tone}`}>{r.text}</span>
                </div>
              );
            })}
          </div>
          {lines.length > visible.length && (
            <button type="button" className="btn-quiet btn-sm mt-2" onClick={() => setShowAll(true)}>
              показати всі {lines.length} подій
            </button>
          )}
        </>
      )}

      <p className="mt-3 text-sm text-ink-mute">
        {/* This used to say «тільки перегляд» unconditionally. With a writable
            terminal that is simply untrue, and a false reassurance about what
            can change a client's site is worse than none. */}
        {terminal?.writable
          ? 'Цей список — тільки перегляд. Термінал вище відкритий на запис.'
          : 'Тільки перегляд — звідси нічого не запускається і не зупиняється.'}
        {projectState && ` Стан проєкту: ${projectState}.`}
      </p>
    </section>
  );
}
