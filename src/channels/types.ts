/**
 * Outreach channel adapters (SPEC §4 stage 14, decision #8).
 *
 * Two families:
 *  - AUTOMATED (`whatsapp`, `email`): the factory sends by itself once Roman approves.
 *  - MANUAL (`instagram`, `viber`): no legal/safe API for cold outbound, so the UI
 *    hands Roman a deep link + prepared text; he taps, pastes, sends, and confirms.
 *    The confirmation is what records the message as sent.
 *
 * Phase D ships `sendDryRun` for all four. Phase E implements `sendLive`
 * (WAHA for WhatsApp, Gmail SMTP for email); manual channels never get a
 * live sender by design — `sendLive` there stays NotConfigured forever.
 */

export const OUTREACH_CHANNELS = ['whatsapp', 'instagram', 'viber', 'email'] as const;
export type OutreachChannel = typeof OUTREACH_CHANNELS[number];

/** Channels the factory can send on its own; the rest need Roman's thumb. */
export const AUTOMATED_CHANNELS: ReadonlySet<OutreachChannel> = new Set<OutreachChannel>(['whatsapp', 'email']);

export function isManualChannel(channel: OutreachChannel): boolean {
  return !AUTOMATED_CHANNELS.has(channel);
}

export interface OutreachDraft {
  channel: OutreachChannel;
  /** phone in E.164-ish digits, email address, or instagram handle. */
  toAddress: string;
  subject: string | null;
  body: string;
}

export interface SendResult {
  /** `simulated` in dry_run, `sent` when a live adapter actually delivered. */
  state: 'simulated' | 'sent' | 'manual_pending';
  providerMessageId: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Thrown by `sendLive` while the channel has no live implementation or
 * credentials. The send worker treats it as a hard stop, never as a retry:
 * SPEC §7 forbids auto-retrying sends.
 */
export class NotConfiguredError extends Error {
  code = 'CHANNEL_NOT_CONFIGURED';
  constructor(channel: OutreachChannel, detail: string) {
    super(`channel ${channel} has no live sender: ${detail}`);
  }
}

/**
 * Per-send context the worker passes down. Channels use what they understand
 * and ignore the rest, so adding a field never breaks an adapter.
 */
export interface SendContext {
  /** The send's idempotency key. Email turns it into a Message-ID + header. */
  idempotencyKey?: string;
  /** Message-ID of the thread's first message; follow-ups thread under it. */
  inReplyTo?: string;
}

export interface ChannelAdapter {
  channel: OutreachChannel;
  /** Never sends anything. Used in FACTORY_MODE=dry_run and by manual channels. */
  sendDryRun(draft: OutreachDraft, ctx?: SendContext): Promise<SendResult>;
  /**
   * Really sends. Throws NotConfiguredError when the channel has no live path
   * (manual channels: forever). A throw is final — sends are never auto-retried.
   */
  sendLive(draft: OutreachDraft, ctx?: SendContext): Promise<SendResult>;
  /** Deep link Roman taps for manual channels; null for automated ones. */
  deepLink?(draft: OutreachDraft): string | null;
}
