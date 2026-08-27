'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Status } from './Status';
import { safeHttpUrl } from '@/lib/format';
import { businessQuickView } from '@/lib/actions';
import type { QuickView } from '@/lib/types';

const CHANNEL_LABEL: Record<string, string> = {
  phone: 'Телефон', email: 'Email', whatsapp: 'WhatsApp',
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', viber: 'Viber',
};

/**
 * «Швидкий перегляд» — a lead's essentials in a modal, without leaving the list.
 *
 * The list stays a list: opening this pulls the one business's data on demand
 * (the `businessQuickView` server action), so scrolling 500 rows costs nothing.
 * It answers "is this worth opening?" — verdict, what the site looks like now,
 * the description and services the factory extracted, contacts, open gaps — and
 * links onward to the full card for everything else.
 */
export function QuickViewModal({
  businessId, fallbackName, onClose,
}: {
  businessId: string;
  fallbackName: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<QuickView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    setState('loading');
    setData(null);
    businessQuickView(businessId)
      .then((res) => {
        if (!alive) return;
        if (!res) { setState('missing'); return; }
        setData(res); setState('ready');
      })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [businessId]);

  // Escape closes; the body cannot scroll behind the modal while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={`Швидкий перегляд: ${data?.name ?? fallbackName}`}
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="h-section break-words">{data?.name ?? fallbackName}</h2>
            {data && (
              <div className="mt-1 flex items-center gap-3 flex-wrap text-sm text-ink-mute">
                <Status tone={data.statusTone}>{data.statusText}</Status>
                {data.niche && <span>· {data.niche}</span>}
                {data.score !== null && <span>· бал {data.score}</span>}
              </div>
            )}
          </div>
          <button type="button" className="btn-quiet btn-sm" onClick={onClose} aria-label="Закрити">✕</button>
        </div>

        {state === 'loading' && <p className="mt-6 text-ink-mute">Завантажую…</p>}
        {state === 'missing' && <p className="mt-6 text-ink-mute">Бізнес не знайдено.</p>}
        {state === 'error' && <p className="mt-6 text-dot-stop">Не вдалося завантажити перегляд.</p>}

        {state === 'ready' && data && (
          <div className="mt-5 space-y-5">
            {/* What the current site looks like + the demo, side by side when both. */}
            {(data.auditShotKey || data.heroKey) && (
              <div className="grid grid-cols-2 gap-3">
                {data.auditShotKey && (
                  <figure className="min-w-0">
                    <img
                      src={`/api/object?bucket=raw&key=${encodeURIComponent(data.auditShotKey)}`}
                      alt="Поточний сайт"
                      className="w-full h-40 object-cover object-top rounded-lg border border-line bg-paper-sunk"
                    />
                    <figcaption className="text-label text-ink-mute mt-1">Поточний сайт · {data.verdictText}</figcaption>
                  </figure>
                )}
                {data.heroKey && (
                  <figure className="min-w-0">
                    <img
                      src={`/api/object?bucket=assets&key=${encodeURIComponent(data.heroKey)}`}
                      alt="Фото бізнесу"
                      className="w-full h-40 object-cover rounded-lg border border-line bg-paper-sunk"
                    />
                    <figcaption className="text-label text-ink-mute mt-1">Фото бізнесу</figcaption>
                  </figure>
                )}
              </div>
            )}

            {/* When there is no screenshot, the verdict still belongs here. */}
            {!data.auditShotKey && (
              <p className="text-sm">Сайт: <span className="text-ink-soft">{data.verdictText}</span></p>
            )}

            {(data.rating !== null || data.reviewCount !== null || data.address) && (
              <p className="text-sm text-ink-soft">
                {[
                  data.rating !== null ? `${data.rating}★` : null,
                  data.reviewCount !== null ? `${data.reviewCount} відгуків` : null,
                  data.address,
                ].filter(Boolean).join(' · ')}
              </p>
            )}

            {data.description && (
              <p className="text-sm text-ink-soft leading-relaxed">{data.description}</p>
            )}

            {data.services.length > 0 && (
              <div>
                <div className="text-label uppercase font-semibold text-ink-mute mb-1">Послуги</div>
                <ul className="text-sm text-ink-soft list-disc pl-5 space-y-0.5">
                  {data.services.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}

            {data.contacts.length > 0 && (
              <div>
                <div className="text-label uppercase font-semibold text-ink-mute mb-1">Контакти</div>
                <ul className="text-sm space-y-0.5">
                  {data.contacts.map((c, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-ink-mute w-24 shrink-0">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                      <span className="font-mono break-all">{c.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.gaps.length > 0 && (
              <div>
                <div className="text-label uppercase font-semibold text-ink-mute mb-1">Незакриті пропуски</div>
                <p className="text-sm text-dot-stop">{data.gaps.join(', ')}</p>
              </div>
            )}

            <div className="flex gap-3 flex-wrap pt-1">
              <Link href={`/businesses/${data.id}`} className="btn-primary btn-sm no-underline">
                Відкрити повну картку →
              </Link>
              {data.deployUrl && (
                <a href={safeHttpUrl(data.deployUrl)} target="_blank" rel="noreferrer" className="btn-outline btn-sm no-underline">
                  Демо ↗
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
