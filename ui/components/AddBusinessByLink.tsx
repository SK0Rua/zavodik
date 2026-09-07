'use client';

/**
 * Paste a Google Maps link, get the business into the funnel.
 *
 * Collapsed by default: this is the exception, not the way leads normally
 * arrive, and an always-open form would compete with the filter bar for the
 * top of the page.
 *
 * The submit is genuinely slow — it waits for a gosom lookup — so the button
 * says so rather than leaving Roman wondering whether the click landed.
 */

import { useState } from 'react';
import { ActionForm } from './ActionForm';
import { addBusinessByLink } from '@/lib/manualBusinessActions';

export function AddBusinessByLink() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="btn-outline btn-sm"
        onClick={() => setOpen(true)}
      >
        + Додати за посиланням
      </button>
    );
  }

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div>
          <h2 className="h-section">Додати бізнес за посиланням</h2>
          <p className="text-sm text-ink-mute mt-0.5">
            Знайшов щось цікаве на картах — встав посилання. Ми знайдемо це місце
            й заведемо його у воронку; далі тиснеш «Зібрати дані».
          </p>
        </div>
        <button type="button" className="btn-quiet btn-sm" onClick={() => setOpen(false)}>
          Згорнути
        </button>
      </div>

      <ActionForm
        action={addBusinessByLink}
        resetOnSuccess
        className="flex gap-2 flex-wrap items-start"
      >
        <input
          type="url"
          name="url"
          required
          placeholder="https://maps.app.goo.gl/… або посилання з адресного рядка"
          // `input` is styled globally by tag (globals.css), so this only has
          // to say how the field shares the row.
          className="flex-1 min-w-[260px]"
          // Roman pastes from his phone constantly; nothing here should fight him.
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn-primary btn-sm">
          Знайти й додати
        </button>
      </ActionForm>

      <p className="text-sm text-ink-mute mt-2">
        Підійде і коротке посилання «Поділитися», і довге з адресного рядка.
        Пошук триває кілька секунд.
      </p>
    </section>
  );
}
