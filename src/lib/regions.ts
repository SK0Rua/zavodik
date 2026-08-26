/**
 * Country and language lists for campaign creation and its defaults.
 *
 * Two consumers share this ONE definition (like schema.ts and settings.ts):
 *   - the settings registry (`CAMPAIGN_DEFAULT_COUNTRY` / `_LANGUAGE` options),
 *   - the «Нова кампанія» form's two <select>s.
 * A drifting duplicate would let the form offer a country the default cannot be
 * set to, or a language the discovery worker never sees.
 *
 * Codes are what the pipeline already stores and passes on:
 *   - country → ISO 3166-1 alpha-2 (`GR`, `UA`), used in the campaign id/slug
 *     (`src/workers/normalize.ts`) — an identifier, not sent to Google;
 *   - language → ISO 639-1 (`el`, `uk`), sliced to 2 chars and passed to gosom
 *     as the Maps UI language (`src/workers/discovery.ts`).
 *
 * The list is deliberately Europe-heavy (where the factory actually operates)
 * plus the common English-speaking markets — not the full ISO tables. Adding a
 * row here makes it selectable everywhere at once.
 */

export interface Region {
  /** Stored/transmitted code. */
  code: string;
  /** Human name shown in the dropdown. */
  name: string;
}

/** Selectable countries, alphabetical by name. */
export const COUNTRIES: Region[] = [
  { code: 'AT', name: 'Австрія' },
  { code: 'AL', name: 'Албанія' },
  { code: 'BE', name: 'Бельгія' },
  { code: 'BG', name: 'Болгарія' },
  { code: 'BA', name: 'Боснія і Герцеговина' },
  { code: 'GB', name: 'Велика Британія' },
  { code: 'GR', name: 'Греція' },
  { code: 'DK', name: 'Данія' },
  { code: 'EE', name: 'Естонія' },
  { code: 'IE', name: 'Ірландія' },
  { code: 'ES', name: 'Іспанія' },
  { code: 'IT', name: 'Італія' },
  { code: 'CY', name: 'Кіпр' },
  { code: 'LV', name: 'Латвія' },
  { code: 'LT', name: 'Литва' },
  { code: 'LU', name: 'Люксембург' },
  { code: 'MT', name: 'Мальта' },
  { code: 'NL', name: 'Нідерланди' },
  { code: 'DE', name: 'Німеччина' },
  { code: 'NO', name: 'Норвегія' },
  { code: 'PL', name: 'Польща' },
  { code: 'PT', name: 'Португалія' },
  { code: 'MD', name: 'Молдова' },
  { code: 'RO', name: 'Румунія' },
  { code: 'RS', name: 'Сербія' },
  { code: 'SK', name: 'Словаччина' },
  { code: 'SI', name: 'Словенія' },
  { code: 'US', name: 'США' },
  { code: 'HU', name: 'Угорщина' },
  { code: 'UA', name: 'Україна' },
  { code: 'FI', name: 'Фінляндія' },
  { code: 'FR', name: 'Франція' },
  { code: 'HR', name: 'Хорватія' },
  { code: 'ME', name: 'Чорногорія' },
  { code: 'CZ', name: 'Чехія' },
  { code: 'CH', name: 'Швейцарія' },
  { code: 'SE', name: 'Швеція' },
];

/** Selectable interface languages for Google Maps discovery, alphabetical by name. */
export const LANGUAGES: Region[] = [
  { code: 'en', name: 'Англійська' },
  { code: 'bg', name: 'Болгарська' },
  { code: 'el', name: 'Грецька' },
  { code: 'da', name: 'Данська' },
  { code: 'et', name: 'Естонська' },
  { code: 'es', name: 'Іспанська' },
  { code: 'it', name: 'Італійська' },
  { code: 'lv', name: 'Латвійська' },
  { code: 'lt', name: 'Литовська' },
  { code: 'de', name: 'Німецька' },
  { code: 'nl', name: 'Нідерландська' },
  { code: 'no', name: 'Норвезька' },
  { code: 'pl', name: 'Польська' },
  { code: 'pt', name: 'Португальська' },
  { code: 'ro', name: 'Румунська' },
  { code: 'sr', name: 'Сербська' },
  { code: 'sk', name: 'Словацька' },
  { code: 'sl', name: 'Словенська' },
  { code: 'hu', name: 'Угорська' },
  { code: 'uk', name: 'Українська' },
  { code: 'fi', name: 'Фінська' },
  { code: 'fr', name: 'Французька' },
  { code: 'hr', name: 'Хорватська' },
  { code: 'cs', name: 'Чеська' },
  { code: 'sv', name: 'Шведська' },
];

export const COUNTRY_CODES: string[] = COUNTRIES.map((c) => c.code);
export const LANGUAGE_CODES: string[] = LANGUAGES.map((l) => l.code);

/** `{ GR: 'Греція', … }` — for select option labels in the settings registry. */
export const COUNTRY_LABELS: Record<string, string> =
  Object.fromEntries(COUNTRIES.map((c) => [c.code, `${c.name} (${c.code})`]));
export const LANGUAGE_LABELS: Record<string, string> =
  Object.fromEntries(LANGUAGES.map((l) => [l.code, `${l.name} (${l.code})`]));
