'use server';

/**
 * «Додати бізнес за посиланням» — Roman found it on the map himself.
 *
 * Goes through the factory's internal API rather than writing here: creating a
 * business means a gosom lookup, immutable raw evidence in object storage,
 * dedup against the whole funnel and a fast-qualify job — all owned by the
 * factory process. A second implementation in the console would be a second
 * definition of what "a business exists" means.
 */

import { revalidatePath } from 'next/cache';
import { factoryFetch } from './factoryApi';
import { effectiveValue } from './settings';
import type { ActionResult } from './types';

export async function addBusinessByLink(formData: FormData): Promise<ActionResult> {
  const url = String(formData.get('url') ?? '').trim();
  if (!url) return { ok: false, message: 'Встав посилання на бізнес у Google Maps' };

  // The manual campaign is created per country, so these decide where the
  // business lands and in what language its demo will eventually be written.
  const [country, language] = await Promise.all([
    effectiveValue('CAMPAIGN_DEFAULT_COUNTRY'),
    effectiveValue('CAMPAIGN_DEFAULT_LANGUAGE'),
  ]);

  const res = await factoryFetch('/internal/businesses/from-link', {
    method: 'POST',
    body: {
      url,
      country: country || 'UA',
      language: language || 'uk',
      city: String(formData.get('city') ?? '').trim(),
    },
    // A gosom lookup is seconds, but the queue behind it can be busy; the
    // default 30s would report a timeout for a link that actually worked.
    timeoutMs: 180_000,
  });

  if (!res.ok) return { ok: false, message: res.message || 'Не вдалось додати бізнес' };

  revalidatePath('/businesses');
  revalidatePath('/campaigns');

  const result = res.body?.result as { kind?: string; businessId?: string } | undefined;
  return {
    ok: true,
    message: result?.kind === 'duplicate'
      ? `${res.message}. Він уже був у воронці — дивись його картку.`
      : `${res.message}. Тепер натисни «Зібрати дані» на його картці.`,
  };
}
