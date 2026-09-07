'use server';

/**
 * Archive / delete actions for businesses and campaigns.
 *
 * All six go through the factory's internal API rather than writing here: the
 * archive has to cancel queue work in the SAME transaction that shelves the row
 * (see `src/orchestrator/archiveService.ts`), and the queue is the factory's to
 * own. A direct `db.update()` from the console would shelve the business while
 * leaving its jobs running — exactly the split-brain the internal API exists to
 * prevent.
 *
 * Deletion is refused by the factory once outreach exists; that verdict arrives
 * as a real message and is shown to Roman verbatim, not flattened into a
 * generic failure.
 */

import { revalidatePath } from 'next/cache';
import { factoryFetch } from './factoryApi';
import type { ActionResult } from './types';

/** Every view that can show an archived-or-not row. */
function revalidateLists(): void {
  revalidatePath('/businesses');
  revalidatePath('/campaigns');
  revalidatePath('/inbox');
}

export async function archiveBusinessAction(formData: FormData): Promise<ActionResult> {
  const businessId = String(formData.get('businessId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (!businessId) return { ok: false, message: 'Не вибрано бізнес' };
  const res = await factoryFetch(`/internal/businesses/${encodeURIComponent(businessId)}/archive`, {
    method: 'POST',
    body: { reason: reason ?? '' },
  });
  if (!res.ok) return { ok: false, message: res.message || 'Не вдалось заархівувати' };

  revalidateLists();
  const result = res.body?.result as { cancelledJobs?: number; cancelledProjects?: number } | undefined;
  const cancelled = Number(result?.cancelledJobs ?? 0) + Number(result?.cancelledProjects ?? 0);
  return {
    ok: true,
    message: cancelled
      ? `В архіві. Скасовано активних задач: ${cancelled}.`
      : 'В архіві.',
  };
}

export async function unarchiveBusinessAction(formData: FormData): Promise<ActionResult> {
  const businessId = String(formData.get('businessId') ?? '').trim();
  if (!businessId) return { ok: false, message: 'Не вибрано бізнес' };
  const res = await factoryFetch(`/internal/businesses/${encodeURIComponent(businessId)}/unarchive`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, message: res.message || 'Не вдалось повернути з архіву' };
  revalidateLists();
  return { ok: true, message: 'Повернуто з архіву.' };
}

/**
 * Hard delete. The confirmation lives in the UI; the REFUSAL lives in the
 * factory, so a business that was contacted stays undeletable even if a caller
 * skips the dialog.
 */
export async function deleteBusinessAction(formData: FormData): Promise<ActionResult> {
  const businessId = String(formData.get('businessId') ?? '').trim();
  if (!businessId) return { ok: false, message: 'Не вибрано бізнес' };
  const res = await factoryFetch(`/internal/businesses/${encodeURIComponent(businessId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) return { ok: false, message: res.message || 'Не вдалось видалити' };
  revalidateLists();
  return { ok: true, message: 'Бізнес видалено назавжди.' };
}

export async function archiveCampaignAction(formData: FormData): Promise<ActionResult> {
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (!campaignId) return { ok: false, message: 'Не вибрано кампанію' };
  const res = await factoryFetch(`/internal/campaigns/${encodeURIComponent(campaignId)}/archive`, {
    method: 'POST',
    body: { reason: reason ?? '' },
  });
  if (!res.ok) return { ok: false, message: res.message || 'Не вдалось заархівувати кампанію' };

  revalidateLists();
  const archived = Number(
    (res.body?.result as { archivedBusinesses?: number } | undefined)?.archivedBusinesses ?? 0,
  );
  return {
    ok: true,
    message: archived
      ? `Кампанію заархівовано разом з ${archived} бізнесами.`
      : 'Кампанію заархівовано.',
  };
}

export async function unarchiveCampaignAction(formData: FormData): Promise<ActionResult> {
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  if (!campaignId) return { ok: false, message: 'Не вибрано кампанію' };
  const res = await factoryFetch(`/internal/campaigns/${encodeURIComponent(campaignId)}/unarchive`, {
    method: 'POST',
  });
  if (!res.ok) return { ok: false, message: res.message || 'Не вдалось повернути кампанію' };

  revalidateLists();
  const restored = Number(
    (res.body?.result as { restoredBusinesses?: number } | undefined)?.restoredBusinesses ?? 0,
  );
  return {
    ok: true,
    message: restored
      ? `Кампанію повернуто разом з ${restored} бізнесами.`
      : 'Кампанію повернуто з архіву.',
  };
}

export async function deleteCampaignAction(formData: FormData): Promise<ActionResult> {
  const campaignId = String(formData.get('campaignId') ?? '').trim();
  if (!campaignId) return { ok: false, message: 'Не вибрано кампанію' };
  const res = await factoryFetch(`/internal/campaigns/${encodeURIComponent(campaignId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) return { ok: false, message: res.message || 'Не вдалось видалити кампанію' };
  revalidateLists();
  return { ok: true, message: 'Кампанію видалено.' };
}
