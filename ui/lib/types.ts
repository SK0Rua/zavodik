/** Shared result shape returned by server actions to the client components. */
export interface ActionResult {
  ok: boolean;
  message: string;
  /** Set when a manual channel (instagram/viber) needs Roman to send by hand. */
  manual?: { channel: string; deepLink: string; text: string; approvalId: number };
}
