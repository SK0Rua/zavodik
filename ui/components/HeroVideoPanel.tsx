'use client';

/**
 * «Відео для hero» — the wow-video brief and its upload slot (SPEC §2.5,
 * 2026-08-22).
 *
 * Fully automated Flow/Veo is off the table: every bridge needs an
 * authenticated Chrome outside a datacenter, and Roman keeps nothing on the
 * mac. So the factory does everything EXCEPT the generation click: it writes
 * the prompt, hands over the start frame, and takes the mp4 back — the
 * uploaded clip becomes a `hero_clip` asset that the next build uses instead
 * of the automatic Ken Burns.
 */

import { useRef, useState, useTransition } from 'react';
import { uploadHeroClip } from '@/lib/videoBriefActions';
import { runWithToast } from '@/lib/toast';

export function HeroVideoPanel({ businessId, prompt, heroPhoto, currentClip }: {
  businessId: string;
  prompt: string;
  /** The start-frame photo: workspace file name + a downloadable URL. */
  heroPhoto: { file: string; url: string } | null;
  /** The newest hero_clip asset, if one exists. */
  currentClip: { generator: string | null; capturedAt: string } | null;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const copy = () => {
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const upload = (formData: FormData) => startTransition(() => {
    void runWithToast(() => uploadHeroClip(businessId, formData), {
      onResult: (res) => { if (res.ok && fileRef.current) fileRef.current.value = ''; },
    });
  });

  const uploaded = currentClip?.generator === 'manual-upload';

  return (
    <section className="card p-5">
      <h3 className="label mb-0">Відео для hero</h3>
      <p className="text-sm text-ink-mute mt-2 max-w-[70ch]">
        {uploaded
          ? `Зараз демо використовує ЗАВАНТАЖЕНЕ відео (${currentClip!.capturedAt}). Новий файл замінить його в наступній збірці.`
          : currentClip
            ? 'Зараз демо використовує автоматичний Ken Burns з реального фото. Хочеш wow-відео — згенеруй за брифом нижче і завантаж: наступна збірка підхопить його сама.'
            : 'Кліпа ще немає — збірка зробить автоматичний Ken Burns. Хочеш wow-відео — згенеруй за брифом нижче і завантаж до збірки.'}
      </p>

      <div className="mt-3 rounded-lg border border-line bg-paper-sunk/50 p-3">
        <pre className="text-sm whitespace-pre-wrap font-mono text-ink-soft">{prompt}</pre>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-outline btn-sm" onClick={copy}>
          {copied ? 'Скопійовано' : 'Скопіювати промпт'}
        </button>
        {heroPhoto && (
          <a className="btn-quiet btn-sm no-underline" href={heroPhoto.url} download>
            Стартовий кадр: {heroPhoto.file} ↓
          </a>
        )}
      </div>

      <form action={upload} className="mt-4 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file" name="clip" accept="video/mp4"
          className="text-sm max-w-full"
          disabled={pending}
        />
        <button type="submit" className="btn-outline btn-sm" disabled={pending}>
          {pending ? 'Завантажую…' : 'Завантажити mp4'}
        </button>
      </form>
      <p className="text-sm text-ink-mute mt-2 max-w-[70ch]">
        Файл позначається як AI-згенерований і ніколи не видається за реальне відео бізнесу.
        Стартовим кадром має бути фото вище — кліп анімує реальність, а не вигадує сцену.
      </p>
    </section>
  );
}
