/**
 * Matching an inbound message back to the business we contacted (SPEC §4 stage 15).
 *
 * Two independent routes, strongest first:
 *  1. THREAD: the reply's In-Reply-To/References names a Message-ID we
 *     generated, whose idempotency key IS an outreach_messages row. Exact.
 *  2. ADDRESS: the sender's email/phone equals an address we sent to, or a
 *     `business_contacts` row. Weaker (a shared inbox can answer from a
 *     different address) but covers mailers that drop threading headers.
 *
 * Deliberately pure-ish: it reads the DB but performs no writes and no
 * transitions, so the same function serves the IMAP poller, the WAHA webhook
 * and the tests without side effects.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { parseMessageId } from '../channels/email.js';

export interface ReplyMatch {
  businessId: string;
  /** The outreach message this is an answer to, when we could pin it down. */
  messageId: number | null;
  /** How we matched — recorded in outreach_events.detail for the audit trail. */
  via: 'thread' | 'address' | 'contact';
  detail: string;
}

/** Every Message-ID referenced by a reply, newest-first-ish, deduped. */
export function collectReferences(input: {
  inReplyTo?: string | null;
  references?: string | string[] | null;
}): string[] {
  const raw: string[] = [];
  if (input.inReplyTo) raw.push(input.inReplyTo);
  if (Array.isArray(input.references)) raw.push(...input.references);
  else if (typeof input.references === 'string') {
    raw.push(...input.references.split(/\s+/).filter(Boolean));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const id = r.trim();
    if (id && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out;
}

/**
 * Route 1 — threading headers. The strongest signal: only WE could have
 * produced a `factory.<key>.<ts>@domain` Message-ID.
 */
export async function matchByThread(references: string[]): Promise<ReplyMatch | null> {
  for (const ref of references) {
    const key = parseMessageId(ref);
    if (!key) continue;
    const [msg] = await db.select().from(schema.outreachMessages)
      .where(eq(schema.outreachMessages.idempotencyKey, key));
    if (msg) {
      return {
        businessId: msg.businessId, messageId: msg.id, via: 'thread',
        detail: `In-Reply-To/References -> ${ref}`,
      };
    }
  }
  return null;
}

/** Route 2 — the address we actually sent to. */
export async function matchByAddress(channel: string, address: string): Promise<ReplyMatch | null> {
  const norm = normalizeAddress(channel, address);
  if (!norm) return null;

  const sent = await db.select().from(schema.outreachMessages)
    .where(eq(schema.outreachMessages.channel, channel));
  // Latest first: a business contacted twice should attach to the newest thread.
  const match = sent
    .filter((m) => normalizeAddress(channel, m.toAddress) === norm)
    .sort((a, b) => b.id - a.id)[0];
  if (match) {
    return {
      businessId: match.businessId, messageId: match.id, via: 'address',
      detail: `${channel} address match ${norm}`,
    };
  }

  // Route 2b — a known contact of a business we never messaged at THIS address
  // (e.g. the owner replies from a personal address listed in evidence).
  const contacts = await db.select().from(schema.businessContacts);
  const contact = contacts.find((c) => {
    if (channel === 'email' && c.channel !== 'email') return false;
    if (channel === 'whatsapp' && !['whatsapp', 'phone', 'viber'].includes(c.channel)) return false;
    return normalizeAddress(channel, c.value) === norm;
  });
  if (contact) {
    return {
      businessId: contact.businessId, messageId: null, via: 'contact',
      detail: `business_contacts#${contact.id} ${channel} ${norm}`,
    };
  }
  return null;
}

/** Emails compare case-insensitively; phones compare as digits only. */
export function normalizeAddress(channel: string, address: string | null | undefined): string {
  if (!address) return '';
  if (channel === 'email') return address.trim().toLowerCase();
  return address.replace(/[^\d]/g, '');
}

/**
 * Full resolution: thread first, then address. Returns null when nothing
 * matches — an unmatched inbound message is left alone, never guessed at.
 */
export async function resolveReply(input: {
  channel: string;
  fromAddress: string;
  inReplyTo?: string | null;
  references?: string | string[] | null;
}): Promise<ReplyMatch | null> {
  const refs = collectReferences(input);
  return (await matchByThread(refs)) ?? (await matchByAddress(input.channel, input.fromAddress));
}
