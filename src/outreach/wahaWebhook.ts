/**
 * Parsing and verification of WAHA's inbound webhook (decision #2).
 *
 * Split out of the HTTP layer so the exact classification rules can be tested
 * against recorded WAHA payloads without standing up a server — and so the
 * "should we even look at this message" decision is one auditable function
 * rather than a chain of ifs inside a route handler.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { chatIdToDigits, isGroupChat, type WahaWebhookEnvelope } from '../channels/waha.js';

/**
 * WAHA signs the RAW body with HMAC-SHA512 when WHATSAPP_HOOK_HMAC_KEY is set.
 * Must be given the exact bytes received — re-serializing parsed JSON will not
 * match. No key configured = verification is skipped (and the api-key header
 * check is what protects the endpoint).
 */
export function verifyHmac(rawBody: string, headerValue: string | undefined | null): boolean {
  if (!config.waha.hookHmacKey) return true; // not enabled
  if (!headerValue) return false;
  const expected = createHmac('sha512', config.waha.hookHmacKey).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(headerValue).trim(), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Constant-time compare for the X-Api-Key header. */
export function verifyApiKey(headerValue: string | undefined | null): boolean {
  if (!config.waha.apiKey) return true; // no key configured -> nothing to check
  if (!headerValue) return false;
  const a = Buffer.from(config.waha.apiKey, 'utf8');
  const b = Buffer.from(String(headerValue), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type WahaSkipReason =
  | 'not_a_message_event'
  | 'no_payload'
  | 'from_me'
  | 'api_echo'
  | 'group_chat'
  | 'no_sender'
  | 'empty_body';

export interface ParsedWahaMessage {
  /** Sender phone as bare digits — what we match against outreach addresses. */
  fromDigits: string;
  chatId: string;
  body: string;
  providerMessageId: string | null;
  /** WAHA's `payload.timestamp` is SECONDS; converted here. */
  at: Date | null;
  session: string | null;
}

export type WahaParseResult =
  | { ok: true; message: ParsedWahaMessage }
  | { ok: false; skip: WahaSkipReason };

/**
 * Decide whether an envelope is an inbound human WhatsApp message we should act
 * on, and extract what we need.
 *
 * Skips, each for a concrete reason:
 *  - anything that is not the `message` event;
 *  - `fromMe: true` or `source: "api"` — our own outreach echoing back;
 *  - group chats (`@g.us`): cold outreach never targets a group, so a group
 *    message can only be noise, and its `from` is the group, not a person;
 *  - empty bodies (a bare sticker/media notification is not a reply we can quote).
 */
export function parseWahaMessage(envelope: WahaWebhookEnvelope | null | undefined): WahaParseResult {
  if (!envelope || envelope.event !== 'message') return { ok: false, skip: 'not_a_message_event' };
  const p = envelope.payload;
  if (!p) return { ok: false, skip: 'no_payload' };
  if (p.fromMe === true) return { ok: false, skip: 'from_me' };
  if (p.source === 'api') return { ok: false, skip: 'api_echo' };

  const chatId = String(p.from ?? '');
  if (isGroupChat(chatId)) return { ok: false, skip: 'group_chat' };

  // Newer WhatsApp can deliver a @lid id with no digits; `participant` then
  // carries the real @c.us address.
  const fromDigits = chatIdToDigits(chatId) || chatIdToDigits(String(p.participant ?? ''));
  if (!fromDigits) return { ok: false, skip: 'no_sender' };

  const body = String(p.body ?? '').trim();
  if (!body) return { ok: false, skip: 'empty_body' };

  return {
    ok: true,
    message: {
      fromDigits,
      chatId,
      body,
      providerMessageId: p.id ? String(p.id) : null,
      at: typeof p.timestamp === 'number' ? new Date(p.timestamp * 1000) : null,
      session: envelope.session ?? null,
    },
  };
}
