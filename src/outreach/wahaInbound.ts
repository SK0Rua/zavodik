/**
 * WAHA webhook -> factory state. The business logic behind `/webhooks/waha`,
 * kept out of the HTTP layer so it can be driven directly by tests with a
 * recorded WAHA payload (scripts/phaseE-e2e.ts).
 */
import { log } from '../lib/logger.js';
import type { WahaWebhookEnvelope } from '../channels/waha.js';
import { parseWahaMessage } from './wahaWebhook.js';
import { resolveReply } from './replyMatch.js';
import { processInbound, type InboundOutcome } from './inbound.js';

export interface WahaInboundResult {
  handled: boolean;
  /** Why nothing happened, when handled=false. */
  reason?: string;
  outcome?: InboundOutcome;
  businessId?: string;
}

export async function handleWahaWebhook(
  envelope: WahaWebhookEnvelope | null | undefined,
): Promise<WahaInboundResult> {
  const parsed = parseWahaMessage(envelope);
  if (!parsed.ok) {
    log.info('WAHA webhook skipped', { reason: parsed.skip, event: envelope?.event ?? null });
    return { handled: false, reason: parsed.skip };
  }

  const msg = parsed.message;
  const match = await resolveReply({ channel: 'whatsapp', fromAddress: msg.fromDigits });
  if (!match) {
    // Someone messaging the outreach number who was never contacted by us.
    // Nothing to record against — logged, then dropped.
    log.info('WAHA inbound did not match any outreach', {
      from: msg.fromDigits, preview: msg.body.slice(0, 80),
    });
    return { handled: false, reason: 'no_match' };
  }

  const outcome = await processInbound(match, {
    channel: 'whatsapp',
    fromAddress: msg.fromDigits,
    subject: null,
    text: msg.body,
    providerMessageId: msg.providerMessageId,
  });

  log.info('WAHA inbound processed', {
    businessId: match.businessId, outcome, via: match.via, from: msg.fromDigits,
  });
  return { handled: true, outcome, businessId: match.businessId };
}
