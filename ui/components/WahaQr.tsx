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
export function WahaQr({ autoShow = false }: { autoShow?: boolean }) {
  const [open, setOpen] = useState(autoShow);
  const [nonce, setNonce] = useState(() => Date.now());
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => { if (autoShow) setOpen(true); }, [autoShow]);

  function refresh() {
    setFailed(null);
    setNonce(Date.now());
  }

  if (!open) {
    return (
      <button type="button" className="btn-ghost text-xs" onClick={() => { setOpen(true); refresh(); }}>
        Показати QR для сканування
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={refresh}>Оновити QR</button>
        <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>Сховати</button>
        <span className="text-xs text-ink-mute">
          WhatsApp → Пристрої → Прив’язати пристрій. QR живе ~20 секунд.
        </span>
      </div>

      {failed ? (
        <div className="rounded-md border border-dot-wait/40 bg-dot-wait/10 px-3 py-2 text-sm text-dot-wait">
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
              'QR недоступний. Або сесія вже WORKING (тоді все добре — натисни «Перевірити WAHA»), '
              + 'або WAHA не піднятий / невірний API key.',
            )}
          />
        </div>
      )}

      <p className="text-xs text-ink-mute">
        Скануй ВИДІЛЕНИМ номером для outreach, не особистим: протокол неофіційний і номер можуть заблокувати
        (рішення №2).
      </p>
    </div>
  );
}
