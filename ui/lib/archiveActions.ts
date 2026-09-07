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
import { businessIdsMatching, parseFilters } from './businessQuery';
import type { ActionResult } from './types';

/** Turn the list's own query string back into the exact set it is showing. */
async function idsForFilterQuery(query: string): Promise<string[]> {
  const params: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of new URLSearchParams(query)) {
    const existing = params[key];
    if (existing === undefined) params[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else params[key] = [existing, value];
  }
  return businessIdsMatching(parseFilters(params));
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

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

// ── Bulk over a whole filtered selection ────────────────────────────────────
//
// The FILTER is what travels from the client, not a list of ids: the browser
// only ever holds the first 500 rows, and "archive everything I filtered" has
// to mean everything, not everything visible. The ids are resolved here, on the
// server, from the same query the list itself ran.

export async function archiveFilteredAction(formData: FormData): Promise<ActionResult> {
  const query = String(formData.get('filterQuery') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const ids = await idsForFilterQuery(query);
  if (!ids.length) return { ok: false, message: 'За цим фільтром нічого немає' };

  const res = await factoryFetch('/internal/businesses/archive-bulk', {
    method: 'POST',
    body: { businessIds: ids, reason },
    // A few thousand businesses with their queue cleanup is one big
    // transaction; the default 30s is not enough to sit through it.
    timeoutMs: 180_000,
  });
  if (!res.ok) return { ok: false, message: res.message || 'Не вдалось заархівувати' };

  revalidateLists();
  const result = res.body?.result as
    { archived?: number; cancelledJobs?: number; cancelledProjects?: number } | undefined;
  const archived = Number(result?.archived ?? 0);
  const cancelled = Number(result?.cancelledJobs ?? 0) + Number(result?.cancelledProjects ?? 0);
  const skipped = ids.length - archived;
  return {
    ok: true,
    message: [
      `В архіві: ${plural(archived, 'бізнес', 'бізнеси', 'бізнесів')}.`,
      cancelled ? `Скасовано задач: ${cancelled}.` : '',
      skipped > 0 ? `${skipped} вже були в архіві.` : '',
    ].filter(Boolean).join(' '),
  };
}

export async function unarchiveFilteredAction(formData: FormData): Promise<ActionResult> {
  const query = String(formData.get('filterQuery') ?? '');
  const ids = await idsForFilterQuery(query);
  if (!ids.length) return { ok: false, message: 'За цим фільтром нічого немає' };

  const res = await factoryFetch('/internal/businesses/unarchive-bulk', {
    method: 'POST',
    body: { businessIds: ids },
    timeoutMs: 180_000,
  });
  if (!res.ok) return { ok: false, message: res.message || 'Не вдалось повернути з архіву' };

  revalidateLists();
  const restored = Number((res.body?.result as { restored?: number } | undefined)?.restored ?? 0);
  return { ok: true, message: `Повернуто з архіву: ${plural(restored, 'бізнес', 'бізнеси', 'бізнесів')}.` };
}

export async function deleteFilteredAction(formData: FormData): Promise<ActionResult> {
  const query = String(formData.get('filterQuery') ?? '');
  const ids = await idsForFilterQuery(query);
  if (!ids.length) return { ok: false, message: 'За цим фільтром нічого немає' };

  const res = await factoryFetch('/internal/businesses/delete-bulk', {
    method: 'POST',
    body: { businessIds: ids },
    timeoutMs: 180_000,
  });
  if (!res.ok) return { ok: false, message: res.message || 'Не вдалось видалити' };

  revalidateLists();
  const result = res.body?.result as { deleted?: number; blocked?: number } | undefined;
  const deleted = Number(result?.deleted ?? 0);
  const blocked = Number(result?.blocked ?? 0);
  return {
    ok: true,
    message: [
      `Видалено: ${plural(deleted, 'бізнес', 'бізнеси', 'бізнесів')}.`,
      // Not a failure: those rows are protected precisely as designed, and
      // saying so is how Roman learns the rule without reading the code.
      blocked > 0
        ? `${blocked} пропущено — їм уже писали, такі можна лише архівувати.`
        : '',
    ].filter(Boolean).join(' '),
  };
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
