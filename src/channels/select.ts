/**
 * Channel selection (decision #8): live messengers before email.
 *
 *   WhatsApp → Instagram → Viber → email (fallback)
 *
 * Pure, deterministic code — an LLM never picks the channel. It reads
 * business_contacts and business_facts, returns the winner plus a
 * human-readable reason that the UI shows next to the Approve button,
 * and the full candidate list so Roman can override before approving.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { type OutreachChannel, isManualChannel } from './types.js';
import { normalizeHandle } from './instagram.js';
import { normalizePhone } from './whatsapp.js';

export interface ChannelCandidate {
  channel: OutreachChannel;
  toAddress: string;
  /** Why this address is trusted (which contact row / fact it came from). */
  evidence: string;
  verified: boolean;
  manual: boolean;
}

export interface ChannelSelection {
  channel: OutreachChannel | null;
  toAddress: string | null;
  reason: string;
  manual: boolean;
  candidates: ChannelCandidate[];
}

/** Priority order is the decision, written once. */
const PRIORITY: OutreachChannel[] = ['whatsapp', 'instagram', 'viber', 'email'];

const CHANNEL_REASON: Record<OutreachChannel, string> = {
  whatsapp: 'WhatsApp: живий месенджер, найвищий пріоритет — відповідають найчастіше',
  instagram: 'Instagram: месенджер є, WhatsApp немає; відправка вручну (DM-автоматизація = ризик бану)',
  viber: 'Viber: месенджер є, WhatsApp/Instagram немає; відправка вручну (легального API для холодних немає)',
  email: 'Email: месенджерів у бізнеса не знайдено, це fallback-канал',
};

/**
 * Collect every address the evidence supports, in priority order.
 * A phone becomes a WhatsApp candidate only when something actually flagged
 * it as WhatsApp — a `whatsapp` contact row, or a `messenger.whatsapp` fact.
 * A bare phone number is NOT assumed to be on WhatsApp.
 */
export async function collectCandidates(businessId: string): Promise<ChannelCandidate[]> {
  const contacts = await db.select().from(schema.businessContacts)
    .where(eq(schema.businessContacts.businessId, businessId));
  const facts = await db.select().from(schema.businessFacts)
    .where(eq(schema.businessFacts.businessId, businessId));

  const out: ChannelCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: ChannelCandidate) => {
    const dedupeKey = `${c.channel}:${c.toAddress.toLowerCase()}`;
    if (!c.toAddress || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push(c);
  };

  const factValue = (key: string): string | null => {
    const f = facts.find((x) => x.key === key);
    if (!f?.value) return null;
    return typeof f.value === 'string' ? f.value : String((f.value as any).value ?? '');
  };

  // ── WhatsApp: explicit whatsapp contacts, then phones flagged by enrichment
  for (const c of contacts.filter((x) => x.channel === 'whatsapp')) {
    push({
      channel: 'whatsapp', toAddress: normalizePhone(c.value),
      evidence: `business_contacts#${c.id} (channel=whatsapp)`, verified: c.verified, manual: false,
    });
  }
  const waFact = factValue('messenger.whatsapp');
  if (waFact) {
    push({
      channel: 'whatsapp', toAddress: normalizePhone(waFact),
      evidence: 'business_facts key=messenger.whatsapp', verified: true, manual: false,
    });
  }

  // ── Instagram: contact row or social.instagram fact
  for (const c of contacts.filter((x) => x.channel === 'instagram')) {
    push({
      channel: 'instagram', toAddress: normalizeHandle(c.value),
      evidence: `business_contacts#${c.id} (channel=instagram)`, verified: c.verified, manual: true,
    });
  }
  const igFact = factValue('social.instagram');
  if (igFact) {
    push({
      channel: 'instagram', toAddress: normalizeHandle(igFact),
      evidence: 'business_facts key=social.instagram', verified: true, manual: true,
    });
  }

  // ── Viber: contact row or messenger.viber fact
  for (const c of contacts.filter((x) => x.channel === 'viber')) {
    push({
      channel: 'viber', toAddress: normalizePhone(c.value),
      evidence: `business_contacts#${c.id} (channel=viber)`, verified: c.verified, manual: true,
    });
  }
  const viberFact = factValue('messenger.viber');
  if (viberFact) {
    push({
      channel: 'viber', toAddress: normalizePhone(viberFact),
      evidence: 'business_facts key=messenger.viber', verified: true, manual: true,
    });
  }

  // ── Email: fallback
  for (const c of contacts.filter((x) => x.channel === 'email')) {
    push({
      channel: 'email', toAddress: c.value.trim().toLowerCase(),
      evidence: `business_contacts#${c.id} (channel=email)`, verified: c.verified, manual: false,
    });
  }

  return out.sort((a, b) => {
    const byPriority = PRIORITY.indexOf(a.channel) - PRIORITY.indexOf(b.channel);
    if (byPriority !== 0) return byPriority;
    // verified addresses win inside the same channel
    return Number(b.verified) - Number(a.verified);
  });
}

/**
 * Pick the outreach channel for a business. Never throws: with no contact at
 * all it returns `channel: null` and the reason, so the approval card can show
 * "no channel" instead of the whole stage failing.
 */
export async function selectChannel(businessId: string): Promise<ChannelSelection> {
  const candidates = await collectCandidates(businessId);
  const winner = candidates[0];

  if (!winner) {
    return {
      channel: null, toAddress: null, manual: false, candidates,
      reason: 'Каналу немає: у бізнеса не знайдено ні месенджерів, ні email — outreach неможливий',
    };
  }

  const skipped = PRIORITY.slice(0, PRIORITY.indexOf(winner.channel))
    .filter((ch) => !candidates.some((c) => c.channel === ch));
  const skippedNote = skipped.length ? ` (немає: ${skipped.join(', ')})` : '';

  return {
    channel: winner.channel,
    toAddress: winner.toAddress,
    manual: isManualChannel(winner.channel),
    reason: CHANNEL_REASON[winner.channel] + skippedNote,
    candidates,
  };
}

/** Reason text for a channel Roman picked manually in the UI, overriding the automatic choice. */
export function overrideReason(channel: OutreachChannel): string {
  return `${CHANNEL_REASON[channel]} — обрано вручну Романом в UI`;
}
