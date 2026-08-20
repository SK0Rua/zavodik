/**
 * A fact's VALUE, rendered as the thing it is.
 *
 * `business_facts.value` is jsonb, and the Факти tab used to print
 * `JSON.stringify(value)` for every row. That is how the tab that exists to
 * prove "the factory does not invent facts" ended up showing Roman
 * `{"name":"Μανικιούρ","price":null}` and `{"1":2,"2":0,"3":0,"4":1,"5":82}`
 * (sweep P0-6). A price of `null` is not a missing field to be hidden — it is
 * the factory saying "no price was published anywhere", which is exactly the
 * kind of honesty the tab is for. So it renders as «ціна не вказана», not as
 * nothing.
 *
 * Every shape below was read off the live database rather than guessed; keys
 * that do not match any known shape fall back to readable text, never to JSON.
 */

import { safeHttpUrl } from '@/lib/format';

/** U+FFFD arrives inside evidence Facebook itself truncated mid-character. */
const REPLACEMENT_CHAR = /�/g;

/**
 * Cleans a captured string for display.
 *
 * The mojibake Roman saw (`αγάπ�`) is NOT our bug: Facebook's own
 * `og:description` is cut at a byte boundary mid-UTF-8-character, and the
 * replacement char is in the raw HTML we captured (verified in the stored
 * evidence object). Byte-truncating it further on our side would only create
 * more. We strip the broken glyph and say plainly that the source was cut off,
 * which is the true statement; the raw value stays in the database untouched.
 */
export function cleanFactText(raw: string): { text: string; truncated: boolean } {
  let text = raw;
  let truncated = false;

  // The enrichment agent appends this marker when the SOURCE was already cut.
  const marker = /\s*\(text truncated in captured source\)\s*$/i;
  if (marker.test(text)) {
    truncated = true;
    text = text.replace(marker, '');
  }
  if (REPLACEMENT_CHAR.test(text)) {
    truncated = true;
    text = text.replace(REPLACEMENT_CHAR, '');
  }
  // A trailing ellipsis is the same statement, made by the scraper.
  text = text.replace(/[…\s]+$/u, '');
  return { text, truncated };
}

function Truncated() {
  return (
    <span className="text-ink-mute"> … (у джерелі обірвано)</span>
  );
}

/** Plain captured text, with the truncation note when the source was cut. */
function TextValue({ value }: { value: string }) {
  const { text, truncated } = cleanFactText(value);
  const url = safeHttpUrl(text);
  // Some facts ARE a URL (location.maps_url, google.menu_link). A raw URL as
  // body text looks clickable and is not — the exact thing Roman objected to.
  if (url && /^https?:\/\//i.test(text)) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-sm break-all">
        {text.length > 70 ? `${text.slice(0, 70)}…` : text} ↗
      </a>
    );
  }
  return (
    <span className="text-sm break-words">
      {text}
      {truncated && <Truncated />}
    </span>
  );
}

/** `{name, price}` — a price of null is a STATEMENT, not an empty cell. */
function ServiceValue({ v }: { v: { name?: unknown; price?: unknown } }) {
  const name = typeof v.name === 'string' ? cleanFactText(v.name).text : '—';
  const price = v.price;
  const priceText = price === null || price === undefined || price === ''
    ? 'ціна не вказана'
    : String(price);
  return (
    <span className="text-sm">
      {name}
      <span className="text-ink-mute"> — {priceText}</span>
    </span>
  );
}

/** `{"1":3,"2":0,…,"5":111}` — labelled bars, worth more than five numbers. */
function DistributionValue({ v }: { v: Record<string, unknown> }) {
  const stars = [5, 4, 3, 2, 1];
  const counts = stars.map((s) => {
    const n = v[String(s)];
    return { star: s, n: typeof n === 'number' ? n : 0 };
  });
  const total = counts.reduce((a, c) => a + c.n, 0);
  const max = Math.max(1, ...counts.map((c) => c.n));

  return (
    <div className="mt-1 space-y-1 max-w-sm">
      {counts.map(({ star, n }) => (
        <div key={star} className="flex items-center gap-2 text-sm">
          <span className="tabular-nums shrink-0 w-8 text-ink-soft">{star}★</span>
          <span className="flex-1 h-2 rounded-full bg-paper-sunk overflow-hidden">
            <span
              className="block h-full rounded-full bg-dot-go"
              style={{ width: `${Math.round((n / max) * 100)}%` }}
            />
          </span>
          <span className="tabular-nums shrink-0 w-10 text-right text-ink-soft">{n}</span>
        </div>
      ))}
      <p className="text-sm text-ink-mute pt-0.5">усього {total}</p>
    </div>
  );
}

/** `{Δευτέρα:["10:00–19:30"], …}` — one line per day, in week order. */
const DAY_ORDER = ['Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο', 'Κυριακή'];
const DAY_UK: Record<string, string> = {
  'Δευτέρα': 'Пн', 'Τρίτη': 'Вт', 'Τετάρτη': 'Ср', 'Πέμπτη': 'Чт',
  'Παρασκευή': 'Пт', 'Σάββατο': 'Сб', 'Κυριακή': 'Нд',
};

function HoursValue({ v }: { v: Record<string, unknown> }) {
  const days = Object.keys(v).sort((a, b) => {
    const ia = DAY_ORDER.indexOf(a); const ib = DAY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return (
    <ul className="mt-1 space-y-0.5">
      {days.map((d) => {
        const slots = v[d];
        const text = Array.isArray(slots) ? slots.join(', ') : String(slots ?? '—');
        return (
          <li key={d} className="text-sm flex gap-3">
            <span className="text-ink-soft w-8 shrink-0">{DAY_UK[d] ?? d}</span>
            <span>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** `[{name, group, enabled}]` — grouped, with a yes/no mark that reads. */
function AttributesValue({ v }: { v: Array<Record<string, unknown>> }) {
  const byGroup = new Map<string, Array<{ name: string; enabled: boolean }>>();
  for (const a of v) {
    const group = typeof a.group === 'string' ? a.group : 'Інше';
    const name = typeof a.name === 'string' ? a.name : String(a.name ?? '');
    if (!name) continue;
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push({ name, enabled: a.enabled !== false });
  }
  return (
    <div className="mt-1 space-y-2">
      {[...byGroup].map(([group, items]) => (
        <div key={group}>
          <p className="text-sm text-ink-mute">{group}</p>
          <ul className="mt-0.5">
            {items.map((it, i) => (
              <li key={`${it.name}-${i}`} className="text-sm flex gap-2">
                <span className={it.enabled ? 'text-dot-go' : 'text-ink-mute'}>
                  {it.enabled ? '✓' : '✕'}
                </span>
                <span className={it.enabled ? '' : 'text-ink-mute'}>{it.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** `{name, group, values}` — one amenity row. */
function AmenityValue({ v }: { v: Record<string, unknown> }) {
  const name = typeof v.name === 'string' ? v.name : '—';
  const group = typeof v.group === 'string' ? v.group : null;
  const values = Array.isArray(v.values) ? v.values.filter(Boolean) : [];
  return (
    <span className="text-sm">
      {name}
      {values.length > 0 && <span className="text-ink-soft"> — {values.join(', ')}</span>}
      {group && <span className="text-ink-mute"> · {group}</span>}
    </span>
  );
}

/** `{text, author, when, rating}` — a review reads as a quote, not a record. */
function ReviewValue({ v }: { v: Record<string, unknown> }) {
  const text = typeof v.text === 'string' ? cleanFactText(v.text).text : '';
  const author = typeof v.author === 'string' ? v.author : null;
  const when = typeof v.when === 'string' ? v.when : null;
  const rating = typeof v.rating === 'number' ? v.rating : null;
  const theme = typeof v.theme === 'string' ? v.theme : null;

  return (
    <div className="mt-1">
      {(rating !== null || author || when) && (
        <p className="text-sm text-ink-mute">
          {[
            rating !== null ? `${rating}★` : null,
            author,
            when,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      <p className="text-sm mt-0.5 whitespace-pre-wrap break-words">{text}</p>
      {theme && <p className="text-sm text-ink-mute mt-0.5">тема: {REVIEW_THEMES[theme] ?? theme}</p>}
    </div>
  );
}

/**
 * Themes the extraction agent writes, in English, as free text.
 *
 * Unknown themes render as-is rather than being dropped — a missing translation
 * should look like a missing translation, not like missing evidence.
 */
const REVIEW_THEMES: Record<string, string> = {
  'staff friendliness': 'привітність персоналу',
  'staff expertise': 'професійність персоналу',
  'hair highlights quality': 'якість фарбування',
  'long-term customer loyalty': 'постійні клієнти',
  cleanliness: 'чистота',
  'cleanliness, manicure/pedicure service': 'чистота, манікюр і педикюр',
  price: 'ціна',
  atmosphere: 'атмосфера',
  results: 'результат',
};

/** `{city, street, country, postalCode}` — one address line. */
function AddressValue({ v }: { v: Record<string, unknown> }) {
  const parts = [v.street, v.postalCode, v.city, v.country]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  return <span className="text-sm">{parts.join(', ') || '—'}</span>;
}

/** `{link, name}` — the Google owner profile. */
function LinkNameValue({ v }: { v: Record<string, unknown> }) {
  const name = typeof v.name === 'string' ? v.name : null;
  const href = typeof v.link === 'string' ? safeHttpUrl(v.link)
    : typeof v.url === 'string' ? safeHttpUrl(v.url) : undefined;
  if (!href) return <span className="text-sm">{name ?? '—'}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-sm">
      {name ?? href} ↗
    </a>
  );
}

/** `{lat, lng}` — coordinates as a number pair, not as an object. */
function CoordsValue({ v }: { v: Record<string, unknown> }) {
  const lat = typeof v.lat === 'number' ? v.lat : null;
  const lng = typeof v.lng === 'number' ? v.lng : null;
  if (lat === null || lng === null) return <span className="text-sm">—</span>;
  return <span className="text-sm tabular-nums">{lat.toFixed(5)}, {lng.toFixed(5)}</span>;
}

/** `{value, foundOn, evidence}` — where a contact was spotted. */
function ContactMarkerValue({ v }: { v: Record<string, unknown> }) {
  const value = typeof v.value === 'string' ? v.value : '—';
  const foundOn = typeof v.foundOn === 'string' ? safeHttpUrl(v.foundOn) : undefined;
  const href = safeHttpUrl(value);
  return (
    <span className="text-sm break-all">
      {href
        ? <a href={href} target="_blank" rel="noreferrer">{value} ↗</a>
        : value}
      {foundOn && (
        <span className="text-ink-mute">
          {' · знайдено на '}
          <a href={foundOn} target="_blank" rel="noreferrer" className="text-ink-mute">
            сторінці ↗
          </a>
        </span>
      )}
    </span>
  );
}

/** `{url, score, bio, title, …}` — a matched social profile. */
function SocialMatchValue({ v }: { v: Record<string, unknown> }) {
  const url = typeof v.url === 'string' ? safeHttpUrl(v.url) : undefined;
  const raw = typeof v.url === 'string' ? v.url : '—';
  const score = typeof v.score === 'number' ? v.score : null;
  const strength = typeof v.strength === 'string' ? v.strength : null;
  return (
    <span className="text-sm break-all">
      {url ? <a href={url} target="_blank" rel="noreferrer">{raw} ↗</a> : raw}
      {(score !== null || strength) && (
        <span className="text-ink-mute">
          {' · збіг '}
          {score !== null ? `${score}/100` : ''}
          {strength ? ` (${MATCH_STRENGTH[strength] ?? strength})` : ''}
        </span>
      )}
    </span>
  );
}

const MATCH_STRENGTH: Record<string, string> = {
  strong: 'впевнений',
  likely: 'ймовірний',
  weak: 'слабкий',
};

/** A list of plain strings (languages, fonts). */
function ListValue({ v }: { v: unknown[] }) {
  const items = v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  return <span className="text-sm">{items.join(', ') || '—'}</span>;
}

/**
 * Renders one fact value for the key it belongs to.
 *
 * The key decides the shape — a `service` is always `{name, price}` — so the
 * dispatch is on the key first and on the runtime type only as a fallback for
 * evidence written before a shape settled.
 */
export function FactValue({ factKey, value }: { factKey: string; value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-sm text-ink-mute">не вказано</span>;
  }

  if (typeof value === 'string') return <TextValue value={value} />;
  if (typeof value === 'number') return <span className="text-sm tabular-nums">{value}</span>;
  if (typeof value === 'boolean') return <span className="text-sm">{value ? 'так' : 'ні'}</span>;

  if (Array.isArray(value)) {
    if (factKey === 'google.attributes') {
      return <AttributesValue v={value as Array<Record<string, unknown>>} />;
    }
    if (value.every((x) => typeof x === 'string' || typeof x === 'number')) {
      return <ListValue v={value} />;
    }
    // An array of objects with no known shape: one line each, still not JSON.
    return (
      <ul className="mt-1 space-y-0.5">
        {(value as unknown[]).map((item, i) => (
          <li key={i}><FactValue factKey={`${factKey}[]`} value={item} /></li>
        ))}
      </ul>
    );
  }

  const v = value as Record<string, unknown>;

  if (factKey === 'service') return <ServiceValue v={v} />;
  if (factKey === 'amenity') return <AmenityValue v={v} />;
  if (factKey === 'reviews.distribution') return <DistributionValue v={v} />;
  if (factKey === 'hours.structured') return <HoursValue v={v} />;
  if (factKey === 'review' || factKey === 'review_excerpt') return <ReviewValue v={v} />;
  if (factKey === 'address.structured') return <AddressValue v={v} />;
  if (factKey === 'google.owner_profile') return <LinkNameValue v={v} />;
  if (factKey === 'location.coordinates') return <CoordsValue v={v} />;
  if (factKey.startsWith('contact_marker.')) return <ContactMarkerValue v={v} />;
  if (factKey.startsWith('social_match.')) return <SocialMatchValue v={v} />;

  // Unknown object shape. Still not JSON: `key: value` lines a person can read.
  const entries = Object.entries(v).filter(([, x]) => x !== null && x !== '');
  if (entries.length === 0) return <span className="text-sm text-ink-mute">не вказано</span>;
  return (
    <ul className="mt-1 space-y-0.5">
      {entries.map(([k, x]) => (
        <li key={k} className="text-sm">
          <span className="text-ink-mute">{k}: </span>
          {typeof x === 'string' ? cleanFactText(x).text : JSON.stringify(x)}
        </li>
      ))}
    </ul>
  );
}
