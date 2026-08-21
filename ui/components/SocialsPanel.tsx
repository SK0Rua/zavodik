/**
 * The result of social discovery, on the business card.
 *
 * Server component with plain `<form action={...}>` submits: confirming or
 * rejecting a candidate is a one-shot mutation with no client state worth
 * keeping, and a form works with JS disabled.
 *
 * What it shows, and why each part is there:
 *  - VERIFIED profiles: the outreach channels that actually exist (decision #8
 *    puts messengers before email, so a confirmed Instagram is a channel, not
 *    decoration). `verified_by` distinguishes Roman's decision from the
 *    matcher's.
 *  - UNVERIFIED candidates: profiles the matcher found and captured but could
 *    not PROVE belong to this business. They are shown as a question, never as
 *    a fact — with the link to open, and the match reasoning the matcher stored,
 *    so the confirm is an informed one.
 *  - the open `socials_unresolved` gap, when the search came back empty: "we
 *    looked and found nothing" is different from "we never looked".
 */

import { Badge } from '@/components/Badge';
import { safeHttpUrl } from '@/lib/format';
import { verifySocialContact, rejectSocialContact } from '@/lib/actions';
import { isSocialChannel } from '@/lib/socials';

export interface SocialContactRow {
  id: number;
  channel: string;
  value: string;
  verified: boolean;
  verifiedBy: string | null;
  sourceUrl: string | null;
  /** `social_match.<platform>` fact, when the matcher stored its reasoning. */
  match: { strength?: string; score?: number; signals?: string[]; blockers?: string[] } | null;
}

export function SocialsPanel({ contacts, unresolvedGap }: {
  contacts: SocialContactRow[];
  unresolvedGap: boolean;
}) {
  const verified = contacts.filter((c) => c.verified);
  const candidates = contacts.filter((c) => !c.verified);

  return (
    <div className="space-y-4">
      {verified.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-mute mb-1.5">
            Підтверджені ({verified.length})
          </p>
          <ul className="space-y-1.5">
            {verified.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm flex-wrap">
                <Badge tone="ok">{c.channel}</Badge>
                <a href={safeHttpUrl(c.value)} target="_blank" rel="noreferrer" className="font-mono text-xs break-all">
                  {c.value} ↗
                </a>
                <span className="text-xs text-ink-mute">
                  {c.verifiedBy ? `підтвердив ${c.verifiedBy}` : 'збіг підтверджено автоматично'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {candidates.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-mute mb-1.5">
            Кандидати без підтвердження ({candidates.length})
          </p>
          <p className="text-xs text-ink-mute mb-2">
            Матчер знайшов і зберіг сторінку, але не довів, що вона належить цьому бізнесу.
            Відкрий профіль і виріши. Відхилення видаляє контакт, але evidence лишається.
          </p>
          <ul className="space-y-2.5">
            {candidates.map((c) => (
              <li key={c.id} className="border-l-2 border-line pl-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="warn">{c.channel}</Badge>
                  <a href={safeHttpUrl(c.value)} target="_blank" rel="noreferrer" className="font-mono text-xs break-all">
                    {c.value} ↗
                  </a>
                  {c.match?.strength && (
                    <span className="text-xs text-ink-mute">
                      {c.match.strength}
                      {c.match.score !== undefined && ` · ${c.match.score}`}
                    </span>
                  )}
                  {c.sourceUrl && (
                    <a
                      href={safeHttpUrl(c.sourceUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs"
                      title="Захоплена сторінка профілю — evidence, на яку посилається контакт"
                    >
                      evidence ↗
                    </a>
                  )}
                </div>
                {c.match?.signals?.length ? (
                  <p className="text-xs text-ink-mute mt-1">збіги: {c.match.signals.join('; ')}</p>
                ) : null}
                {c.match?.blockers?.length ? (
                  <p className="text-xs text-dot-wait mt-0.5">проти: {c.match.blockers.join('; ')}</p>
                ) : null}
                <div className="flex gap-2 mt-1.5 flex-wrap items-center">
                  <form action={verifySocialContact} className="flex gap-2 items-center">
                    <input type="hidden" name="contactId" value={c.id} />
                    <input
                      name="note"
                      placeholder="нотатка (необовʼязково)"
                      className="text-xs"
                      aria-label={`Нотатка до ${c.value}`}
                    />
                    <button type="submit" className="btn-outline btn-sm">Підтвердити</button>
                  </form>
                  <form action={rejectSocialContact}>
                    <input type="hidden" name="contactId" value={c.id} />
                    <button type="submit" className="btn-danger text-xs">Відхилити</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {contacts.length === 0 && (
        <p className="text-sm text-ink-mute">
          {unresolvedGap
            ? 'Пошук уже виконувався і нічого не підтвердив (gap socials_unresolved).'
            : 'Соцмереж ще не знайдено.'}
        </p>
      )}

      {unresolvedGap && contacts.length > 0 && (
        <p className="text-xs text-dot-wait">
          Відкритий gap socials_unresolved — попередній пошук не дав підтвердженого профілю.
        </p>
      )}
    </div>
  );
}

/** Which contact rows belong on this panel. */
export function isSocialContact(channel: string): boolean {
  return isSocialChannel(channel);
}
