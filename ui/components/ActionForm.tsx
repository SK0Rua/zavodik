'use client';

/**
 * A `<form>` whose server action reports through a toast.
 *
 * Half the console's mutations were plain `<form action={serverAction}>` with a
 * `Promise<void>` action: submit, revalidate, and nothing anywhere says the
 * click landed. Now those actions return `ActionResult` and this wrapper is
 * what turns the returned sentence into the toast.
 *
 * Written as a form rather than as "make every one of them a button with an
 * onClick" on purpose: the markup inside stays exactly what it was — named
 * inputs, selects, hidden fields, native `required` validation, Enter to
 * submit — and only the submission path changes. Converting them to controlled
 * React state would have meant rewriting six working forms to gain nothing.
 *
 * `useTransition` + calling the action directly (rather than passing it to
 * `action=`) is what makes the return value reachable: React's form action
 * integration discards it.
 */

import { useRef, useTransition } from 'react';
import { toastError, toastResult } from '@/lib/toast';
import type { ActionResult } from '@/lib/types';

export function ActionForm({
  action, children, className, confirm, onDone, resetOnSuccess = false, ...rest
}: {
  action: (formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  /**
   * Asked before anything is submitted. Returning false cancels, exactly like
   * the `onSubmit` + `preventDefault` pattern this replaces.
   */
  confirm?: (formData: FormData) => boolean;
  /** Called after a successful action — closing a dialog, mostly. */
  onDone?: (result: ActionResult) => void;
  /** Clear the fields after a success. For "add one more" forms. */
  resetOnSuccess?: boolean;
} & Omit<React.FormHTMLAttributes<HTMLFormElement>, 'action' | 'onSubmit'>) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      {...rest}
      ref={formRef}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        // Native validation still applies: `required` on an input inside this
        // form blocks the submit before we ever get here, because the browser
        // fires `submit` only on a valid form.
        const formData = new FormData(e.currentTarget);
        if (confirm && !confirm(formData)) return;
        startTransition(async () => {
          try {
            const result = await action(formData);
            toastResult(result);
            if (result.ok) {
              if (resetOnSuccess) formRef.current?.reset();
              onDone?.(result);
            }
          } catch (err) {
            toastError(`Не вдалося виконати: ${String(err).slice(0, 200)}`);
          }
        });
      }}
      // `fieldset[disabled]` is what actually stops a double submit: it
      // disables every control inside at once, including the submit button,
      // without each form having to thread a `pending` prop to its own button.
      data-pending={pending ? '' : undefined}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
