/**
 * Viber adapter — MANUAL BY DESIGN (SPEC §2.2).
 * No legal API for cold outbound. Viber is mass-market in Greece, so
 * enrichment detects it separately; the UI hands Roman a `viber://` deep link
 * plus the prepared text.
 */
import { type ChannelAdapter, type OutreachDraft, type SendResult, NotConfiguredError } from './types.js';
import { normalizePhone } from './whatsapp.js';
import { log } from '../lib/logger.js';

export const viberAdapter: ChannelAdapter = {
  channel: 'viber',

  async sendDryRun(draft: OutreachDraft): Promise<SendResult> {
    log.info('DRY RUN viber (manual channel)', { to: normalizePhone(draft.toAddress) });
    return { state: 'simulated', providerMessageId: null, detail: { adapter: 'viber', manual: true, dryRun: true } };
  },

  async sendLive(_draft: OutreachDraft): Promise<SendResult> {
    throw new NotConfiguredError('viber', 'manual channel by design — Roman sends from the deep link');
  },

  deepLink(draft: OutreachDraft): string {
    return `viber://chat?number=%2B${normalizePhone(draft.toAddress)}`;
  },
};
