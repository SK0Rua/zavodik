'use client';

import { useEffect, useState } from 'react';

/**
 * WAHA pairing QR, rendered inline so Roman never has to open the WAHA
 * dashboard on a separate port with a separate password.
 *
 * The image comes from our own authenticated route (`/api/waha-qr`), which
 * proxies WAHA with the API key from the settings store. A QR is a live
 * credential: it is cache-busted on every render and never cached by the
 * browser, and it expires on WAHA's side within about 20 seconds — hence the
 * explicit refresh button rather than a stale picture sitting on screen.
 */
export function WahaQr({ autoShow = false, primary = false, reachable = true }: {
  autoShow?: boolean;
  /**
   * True when scanning is the thing the card is asking for. Showing the QR is
   * then THE action and gets the filled button; the rest of the time it is one
   * outline button among several.
   */
  primary?: boolean;
  /**
   * Whether the WAHA ping succeeded.
   *
   * False renders NOTHING at all — not a collapsed button, not an empty frame.
   * Roman's server screenshot (2026-08-22) was a full screen of blank space with
   * a lone «Оновити» stranded at the bottom: the panel laid itself out first and
   * only learned the fetch had failed once the <img> errored, by which point the
   * QR box, its heading and its instructions were already on screen telling him
   * to scan something that was never going to appear. A control for an
   * unreachable service is not a control, so the card shows the error and its
   * «Оновити» instead, and this component stays out of the way.
   */
  reachable?: boolean;
}) {
  const [open, setOpen] = useState(autoShow);
  const [nonce, setNonce] = useState(() => Date.now());
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => { if (autoShow) setOpen(true); }, [autoShow]);

  // Collapse if WAHA goes away while the panel is open, so a live failure does
  // not leave the same empty frame behind.
  useEffect(() => { if (!reachable) setOpen(false); }, [reachable]);

  if (!reachable) return null;

  function refresh() {
    setFailed(null);
    setNonce(Date.now());
  }

  if (!open) {
    return (
      <button
        type="button" className={`${primary ? 'btn-primary' : 'btn-outline'} btn-sm`}
        onClick={() => { setOpen(true); refresh(); }}
      >
        Показати QR
      </button>
    );
  }

  // `w-full` because the collapsed trigger sits in the card's flex action row:
  // once expanded this block must take the whole line rather than squeeze in
  // beside «Оновити».
  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-outline btn-sm" onClick={refresh}>Оновити QR</button>
        <button type="button" className="btn-quiet btn-sm" onClick={() => setOpen(false)}>Сховати</button>
      </div>
      <p className="text-sm text-ink-mute">
        WhatsApp → Пристрої → Прив’язати пристрій. QR живе ~20 секунд, тому оновлюй його,
        якщо не встиг.
      </p>

      {failed ? (
        <div className="rounded-lg border border-dot-wait/30 bg-dot-wait/8 px-3 py-2 text-sm text-dot-wait">
          {failed}
        </div>
      ) : (
        <div className="inline-block rounded-lg bg-white p-3">
          {/* Plain <img>: next/image would try to optimize a one-off credential
              image through its own cache, which is exactly what must not happen. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/waha-qr?t=${nonce}`}
            alt="WAHA QR"
            width={264}
            height={264}
            onError={() => setFailed(
              'QR недоступний. Або сесія вже підключена (тоді все добре — натисни «Оновити» у картці), '
              + 'або WAHA не піднятий / невірний API key.',
            )}
          />
        </div>
      )}
    </div>
  );
}
