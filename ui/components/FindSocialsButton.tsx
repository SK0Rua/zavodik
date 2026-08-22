'use client';

/**
 * "Дошукати соцмережі" on the business card.
 *
 * Like the build button, the eligibility decision arrives precomputed from the
 * server (`socialsButtonState`), so this component only renders it and calls the
 * action — the button can never offer what the action would refuse.
 *
 * No confirm dialog: unlike a build, this writes no status and starts no agent
 * session. The worst case of an accidental click is a few minutes of searching.
 */

import { useTransition } from 'react';
import { startSocialsDiscovery } from '@/lib/actions';
import { runWithToast } from '@/lib/toast';
import type { SocialsButtonState } from '@/lib/socials';

export function FindSocialsButton({ businessId, state }: {
  businessId: string;
  state: SocialsButtonState;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* `btn-outline`, not `btn-primary`: this sits on the Контакти tab of a
          card whose primary action («Побудувати демо») is in the header band
          above. Two filled buttons on one screen means neither is THE action —
          and the demo build is the one that matters. */}
      <button
        type="button"
        className="btn-outline"
        disabled={!state.enabled || pending}
        title={state.hint}
        onClick={() => startTransition(() => {
          void runWithToast(() => startSocialsDiscovery(businessId));
        })}
      >
        {pending ? 'Ставлю в чергу…' : 'Дошукати соцмережі'}
      </button>
      <span className="text-sm text-ink-mute">{state.hint}</span>
    </div>
  );
}
