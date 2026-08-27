import { Badge } from '@/components/Badge';
import { fmtDate } from '@/lib/format';
import type { SystemStatus } from '@/lib/systemStatus';

/**
 * "Is anything broken right now" at a glance.
 *
 * The heartbeat rows are the part that cannot be faked by a healthy container:
 * each factory process stamps one every 30 seconds, so a stale age means the
 * workers are wedged even though the container is technically up.
 */
export function SystemStatusPanel({ status }: { status: SystemStatus }) {
  return (
    <section className="card p-4 space-y-4">
      <h2 className="text-sm font-medium text-ink">Стан системи</h2>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {status.services.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-line bg-paper-sunk px-3 py-2">
            <span className="text-sm text-ink">{s.label}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-ink-mute truncate max-w-[10rem]" title={s.detail}>{s.detail}</span>
              <Badge tone={s.ok ? 'ok' : 'bad'}>{s.ok ? 'ok' : 'down'}</Badge>
            </span>
          </div>
        ))}
      </div>

      <div>
        {/* «Up right now» above cannot see this: gosom can answer HTTP while no
            discovery has actually succeeded in days. This is that second, slower
            health question. */}
        <h3 className="text-xs uppercase tracking-wide text-ink-mute mb-2">Останні успішні прогони</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {status.lastRuns.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-line bg-paper-sunk px-3 py-2">
              <span className="text-sm text-ink">{r.label}</span>
              <span className={`text-xs text-ink-mute ${r.at ? '' : 'italic opacity-70'}`}>
                {r.at ? fmtDate(r.at) : 'ще не було'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-ink-mute mb-2">Воркери (heartbeat кожні 30с)</h3>
        {status.heartbeats.length === 0 ? (
          <p className="text-sm text-ink-mute">
            Жодного heartbeat. Контейнери <code>factory</code> / <code>factory-build</code> ще не перезапускалися
            після оновлення, або воркери не працюють.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {status.heartbeats.map((h) => (
              <div key={h.group} className="flex items-center justify-between gap-2 rounded-md border border-line bg-paper-sunk px-3 py-2">
                <span className="text-sm text-ink">{h.group}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-ink-mute">
                    {h.ageLabel ?? '—'}{h.pid ? ` · pid ${h.pid}` : ''}
                  </span>
                  <Badge tone={h.stale ? 'bad' : 'ok'}>
                    {h.stale ? 'застій' : 'живий'}
                  </Badge>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-ink-mute mb-2">Черга</h3>
        {status.jobs ? (
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="info">в черзі: {status.jobs.queued}</Badge>
            <Badge tone={status.jobs.active > 0 ? 'ok' : 'idle'}>в роботі: {status.jobs.active}</Badge>
            <Badge tone={status.jobs.failed > 0 ? 'bad' : 'idle'}>failed: {status.jobs.failed}</Badge>
          </div>
        ) : (
          <p className="text-sm text-ink-mute">pg-boss ще не ініціалізований.</p>
        )}
      </div>
    </section>
  );
}
