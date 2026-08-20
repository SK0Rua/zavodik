'use client';

/**
 * «Оновити айдентику» — next to the brand swatches on the Факти tab.
 *
 * It sits HERE rather than in the actions bar on purpose: this is the button
 * for "these colours look wrong / there is no logo", and the place a person
 * forms that opinion is while looking at the swatches themselves.
 *
 * No confirm dialog. The job mines evidence already in storage, writes no
 * status, starts no agent session and cannot trigger a build — the worst case
 * of an accidental click is a few seconds of worker time.
 */

import { useState, useTransition } from 'react';
import { refreshBrandIdentity } from '@/lib/actions';

export function RefreshBrandButton({ businessId }: { businessId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3 flex-wrap mt-4">
      <button
        type="button"
        className="btn-outline btn-sm"
        disabled={pending}
        title="Перешукати логотип і фото в уже збережених копіях сторінок, перерахувати палітру. Нічого не перебудовує."
        onClick={() => startTransition(async () => {
          const res = await refreshBrandIdentity(businessId);
          setMessage(res.message);
        })}
      >
        {pending ? 'Ставлю в чергу…' : 'Оновити айдентику'}
      </button>
      <span className="text-sm text-ink-mute">
        Перешукує логотип і фото в збережених доказах. Демо не перебудовується.
      </span>
      {message && <span className="text-sm text-ink-soft">{message}</span>}
    </div>
  );
}
