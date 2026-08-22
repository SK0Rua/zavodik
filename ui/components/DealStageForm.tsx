import { ActionForm } from '@/components/ActionForm';
import { updateDealStage } from '@/lib/actions';
import { DEAL_STATES } from '@/lib/format';
import { humanStatus } from '@/lib/humanStatus';

/**
 * Where the conversation stands, and moving it by hand.
 *
 * This is what the old `/conversations` page was for. It lived on its own page
 * listing every deal, which meant looking up "did they answer?" for one business
 * happened somewhere other than that business's card. Now it is a tab on the
 * card, and the page it came from is gone: a reply also raises an inbox item, so
 * nothing is lost by not having a list of them.
 */
export function DealStageForm({ businessId, state }: { businessId: string; state: string }) {
  return (
    <section className="card p-5 sm:p-6">
      <ActionForm action={updateDealStage} className="flex gap-3 items-end flex-wrap">
        <input type="hidden" name="businessId" value={businessId} />
        <div className="min-w-[200px]">
          <label className="label" htmlFor={`deal-${businessId}`}>На якому ми етапі</label>
          <select id={`deal-${businessId}`} name="state" defaultValue={state}>
            {DEAL_STATES.map((s) => (
              <option key={s} value={s}>{humanStatus(s).text}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-outline btn-sm">Оновити</button>
      </ActionForm>
    </section>
  );
}
