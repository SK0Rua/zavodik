/**
 * Fact keys and gap keys → what Roman actually reads.
 *
 * `business_facts.key` is a machine vocabulary written by the enrichment
 * workers: `hours.structured`, `google.attributes`, `review_excerpt`,
 * `contact_marker.facebook`. Printing those raw on the Факти tab turns the
 * page that proves the factory does not invent facts into a database dump — the
 * one tab whose whole job is being READABLE was the least readable page in the
 * console (sweep P0-6).
 *
 * The key is never thrown away: it stays as a `title` tooltip on the label, so
 * a raw lookup is one hover away and debugging still works.
 */

/** Exact-match labels, in the order the enrichment workers write them. */
const FACT_LABELS: Record<string, string> = {
  // identity
  'identity.brand_name': 'Назва бренду',
  'identity.display_name': 'Як себе називають',
  'identity.tagline': 'Слоган',
  'identity.description': 'Опис бізнесу',

  // location / contact
  'address.confirmed': 'Підтверджена адреса',
  'address.structured': 'Адреса',
  'location.address': 'Адреса',
  'location.coordinates': 'Координати',
  'location.maps_url': 'Сторінка на Google Maps',
  timezone: 'Часовий пояс',
  languages: 'Мови обслуговування',

  // hours
  hours: 'Години роботи',
  'hours.structured': 'Години роботи (по днях)',

  // offering
  service: 'Послуга',
  amenity: 'Зручність',
  about: 'Про бізнес',

  // reputation
  review: 'Відгук',
  review_excerpt: 'Цитата з відгуку',
  'reviews.distribution': 'Розподіл оцінок',
  'presence.rating': 'Оцінка на Google',

  // google listing internals
  'google.attributes': 'Позначки Google',
  'google.owner_profile': 'Профіль власника в Google',
  'google.menu_link': 'Посилання на меню з Google',

  // classification
  'classification.category': 'Категорія',
  'classification.business_status': 'Стан бізнесу',

  // brand (rendered as swatches, but labelled here for completeness)
  'brand.palette_primary': 'Основний колір',
  'brand.palette_accent': 'Акцентний колір',
  'brand.photo_colors': 'Кольори з фото',
  'brand.site_colors': 'Кольори з сайту',
  'brand.avatar_colors': 'Кольори аватара',
  'brand.fonts_seen': 'Помічені шрифти',
  'brand.voice': 'Тон комунікації',
};

/** Prefix rules for the `x.<platform>` families, which are open-ended. */
const PLATFORM_NAMES: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  viber: 'Viber',
  email: 'пошта',
  phone: 'телефон',
  contact_form: 'форма звʼязку',
  website: 'сайт',
};

function platformName(raw: string): string {
  return PLATFORM_NAMES[raw] ?? raw;
}

/** A fact key, in words. Unknown keys degrade to a de-underscored key. */
export function factLabel(key: string): string {
  const exact = FACT_LABELS[key];
  if (exact) return exact;

  if (key.startsWith('contact_marker.')) {
    return `Згадка контакту — ${platformName(key.slice('contact_marker.'.length))}`;
  }
  if (key.startsWith('social_match.')) {
    return `Знайдений профіль — ${platformName(key.slice('social_match.'.length))}`;
  }
  // Last resort: never show a snake_case token as-is.
  return key.replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * The readiness gates, named by what is missing.
 *
 * Duplicated deliberately from `humanStatus.ts`? No — imported from there.
 * This re-export exists so the Факти tab and the status line cannot drift into
 * two different Ukrainian names for one gate.
 */
export { GAP_NAMES, gapName } from './humanStatus';

/**
 * Sort order for the facts list: identity first, then what the business sells,
 * then reputation, then plumbing.
 *
 * The list arrived in database order, which is insertion order, which is the
 * order a scraper happened to walk a page — so `timezone` sat above the brand
 * name. Grouping by meaning makes the list skimmable without changing a single
 * value.
 */
const GROUP_ORDER: Array<{ id: string; title: string; match: (key: string) => boolean }> = [
  {
    id: 'identity',
    title: 'Хто вони',
    match: (k) => k.startsWith('identity.') || k.startsWith('classification.'),
  },
  {
    id: 'offering',
    title: 'Що пропонують',
    match: (k) => k === 'service' || k === 'about' || k === 'amenity' || k === 'google.attributes',
  },
  {
    id: 'reputation',
    title: 'Що про них кажуть',
    match: (k) => k === 'review' || k === 'review_excerpt'
      || k === 'reviews.distribution' || k === 'presence.rating',
  },
  {
    id: 'contact',
    title: 'Де їх знайти',
    match: (k) => k.startsWith('address.') || k.startsWith('location.')
      || k.startsWith('contact_marker.') || k.startsWith('social_match.')
      || k === 'hours' || k === 'hours.structured' || k === 'google.menu_link',
  },
  {
    id: 'other',
    title: 'Інше',
    match: () => true,
  },
];

export interface FactGroup<T> {
  id: string;
  title: string;
  facts: T[];
}

/** Buckets facts into the five reading groups, dropping the empty ones. */
export function groupFacts<T extends { key: string }>(facts: T[]): Array<FactGroup<T>> {
  const buckets = new Map<string, T[]>(GROUP_ORDER.map((g) => [g.id, []]));
  for (const f of facts) {
    const group = GROUP_ORDER.find((g) => g.match(f.key))!;
    buckets.get(group.id)!.push(f);
  }
  return GROUP_ORDER
    .map((g) => ({ id: g.id, title: g.title, facts: buckets.get(g.id)! }))
    .filter((g) => g.facts.length > 0);
}
