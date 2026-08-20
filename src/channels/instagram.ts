/**
 * Instagram adapter — MANUAL BY DESIGN (SPEC §2.2).
 * DM automation gets accounts banned, so the factory never sends here.
 * It prepares the text and a profile deep link; the UI shows a "I sent it"
 * button, and Roman's confirmation is what records the message.
 */
import { type ChannelAdapter, type OutreachDraft, type SendResult, NotConfiguredError } from './types.js';
import { log } from '../lib/logger.js';

/** Accepts `@handle`, `handle`, or a full profile URL; returns the bare handle. */
export function normalizeHandle(raw: string): string {
  const fromUrl = raw.match(/instagram\.com\/([^/?#]+)/i)?.[1];
  return (fromUrl ?? raw).replace(/^@/, '').replace(/\/+$/, '').trim();
}

export const instagramAdapter: ChannelAdapter = {
  channel: 'instagram',

  async sendDryRun(draft: OutreachDraft): Promise<SendResult> {
    log.info('DRY RUN instagram (manual channel)', { to: normalizeHandle(draft.toAddress) });
    return { state: 'simulated', providerMessageId: null, detail: { adapter: 'instagram', manual: true, dryRun: true } };
  },

  async sendLive(_draft: OutreachDraft): Promise<SendResult> {
    throw new NotConfiguredError('instagram', 'manual channel by design — Roman sends from the deep link');
  },

  deepLink(draft: OutreachDraft): string {
    return `https://instagram.com/${normalizeHandle(draft.toAddress)}`;
  },
};
