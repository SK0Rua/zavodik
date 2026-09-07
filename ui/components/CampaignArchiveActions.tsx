'use client';

/**
 * Archive / restore / delete buttons for one campaign card.
 *
 * A client component purely because of the confirmations: `ActionForm`'s
 * `confirm` prop is a FUNCTION, and the campaigns page is a server component —
 * passing a closure across that boundary is what Next refuses ("Functions
 * cannot be passed directly to Client Components"). The dialogs belong on the
 * client anyway; only the plain, serialisable facts about the campaign cross
 * over.
 */

import { ActionForm } from './ActionForm';
import {
  archiveCampaignAction, deleteCampaignAction, unarchiveCampaignAction,
} from '@/lib/archiveActions';

export function CampaignArchiveActions({
  campaignId,
  archived,
  /** Businesses in the campaign, archived ones included — the delete gate. */
  totalBusinesses,
  /** Businesses this archive would shelve right now (live ones only). */
  liveBusinesses,
}: {
  campaignId: string;
  archived: boolean;
  totalBusinesses: number;
  liveBusinesses: number;
}) {
  if (archived) {
    return (
      <>
        <ActionForm action={unarchiveCampaignAction}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <button type="submit" className="btn-primary btn-sm">
            Повернути з архіву
          </button>
        </ActionForm>
        {/* Offered only on an EMPTY campaign: with businesses still attached
            the factory refuses, so a button here would always fail. */}
        {totalBusinesses === 0 && (
          <ActionForm
            action={deleteCampaignAction}
            confirm={() => window.confirm(
              `Видалити кампанію ${campaignId} назавжди? Це не можна скасувати.`,
            )}
          >
            <input type="hidden" name="campaignId" value={campaignId} />
            <button type="submit" className="btn-outline btn-sm text-danger">
              Видалити
            </button>
          </ActionForm>
        )}
      </>
    );
  }

  return (
    <ActionForm
      action={archiveCampaignAction}
      confirm={() => window.confirm(
        liveBusinesses > 0
          ? `Заархівувати кампанію разом з ${liveBusinesses} бізнесами?\n\n`
            + 'Активні задачі буде скасовано. Це оборотно.'
          : 'Заархівувати кампанію? Це оборотно.',
      )}
    >
      <input type="hidden" name="campaignId" value={campaignId} />
      <button type="submit" className="btn-outline btn-sm">
        В архів
      </button>
    </ActionForm>
  );
}
