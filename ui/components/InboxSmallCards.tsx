'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Status } from './Status';
import { retryJobAction } from '@/lib/actions';
import { stageName } from '@/lib/stageNames';
import type { JobProblemItem, ReplyItem } from '@/lib/inbox';

/** A stage that stopped and will not restart itself. */
export function JobProblemCard({ item }: { item: JobProblemItem }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const retry = () => startTransition(async () => {
    setMessage(await retryJobAction(item.jobId));
  });

  return (
    <article className="card p-5 sm:p-6">
      {/* `actionable` means this step BLOCKS its business and never ages out
          of the inbox — the distinction that stops work quietly leaving the
          to-do list by getting old (audit P1-6). Without rendering it, an item
          that will sit here forever looked identical to one that happened to
          be recent. */}
      <Status tone={item.status === 'failed' ? 'stop' : 'wait'} title={item.status}>
        {item.status === 'failed' ? 'Крок упав' : 'Крок зупинився і чекає рішення'}
      </Status>
      {item.actionable && (
        <p className="text-sm text-dot-wait mt-1">
          Бізнес стоїть, поки ти це не вирішиш — саме звідси не зникне.
        </p>
      )}

      <h2 className="text-lg font-semibold mt-2 first-letter:uppercase">{stageName(item.jobType)}</h2>

      <p className="text-sm text-ink-soft mt-1">
        {item.businessId ? (
          <Link href={`/businesses/${item.businessId}`}>{item.businessName ?? item.businessId}</Link>
        ) : (
          item.campaignId ?? 'без бізнесу'
        )}
        {item.attempts > 1 && <> · спроб: {item.attempts}</>}
      </p>

      {!message && (
        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <button type="button" className="btn-outline btn-sm" onClick={retry} disabled={pending}>
            {pending ? 'Ставлю в чергу…' : 'Повторити'}
          </button>
          {(item.errorCode || item.errorDetail) && (
            <button
              type="button"
              className="btn-quiet btn-sm"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? 'Сховати деталі' : 'Деталі'}
            </button>
          )}
        </div>
      )}

      {open && (
        <pre className="mt-3 text-sm text-ink-mute bg-paper-sunk rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono">
          {[item.errorCode, item.errorDetail].filter(Boolean).join('\n\n').slice(0, 1200)}
        </pre>
      )}

      {message && <p role="status" className="text-sm text-accent mt-3">{message}</p>}
    </article>
  );
}

/** Someone answered. The best kind of inbox item. */
export function ReplyCard({ item }: { item: ReplyItem }) {
  return (
    <article className="card p-5 sm:p-6">
      <Status tone="wait">Відповіли</Status>

      <h2 className="text-lg font-semibold mt-2">
        <Link href={`/businesses/${item.businessId}`} className="no-underline hover:underline">
          {item.name}
        </Link>
      </h2>

      {item.preview && (
        <p className="text-sm text-ink-soft mt-3 pl-4 border-l-2 border-line max-w-[70ch] whitespace-pre-wrap">
          {item.preview}
        </p>
      )}

      <div className="mt-4">
        <Link href={`/businesses/${item.businessId}#rozmova`} className="btn-outline btn-sm no-underline">
          Відкрити розмову
        </Link>
      </div>
    </article>
  );
}
