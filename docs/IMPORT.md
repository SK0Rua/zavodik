# Фаза F — імпорт legacy `website-offers`

Переносить пакети бізнесів зі старого репозиторію `website-offers` у БД фабрики
як **immutable evidence**, без дублікатів і без вигаданих фактів.

Авторитет: `docs/SPEC.md` §5 (модель даних + інваріанти) і §10 (фаза F).

---

## 1. Гарантія read-only

Стара тека **ніколи не змінюється**. Імпортер відкриває файли лише на читання
(`readFile` / `stat` / `readdir`) — у `src/import/` немає жодного виклику запису,
переміщення чи видалення в бік `LEGACY_DIR`.

Перевірено емпірично: контрольні суми тек трьох клієнтів до і після повного
прогону збігаються, кількість змінених файлів у legacy-дереві — `0`.

```bash
# перевірка, яку можна повторити будь-коли
cd "$LEGACY_DIR" && find . -newermt "$(date +%Y-%m-%d)" -type f | wc -l   # має бути 0
```

---

## 2. Як запускати

```bash
# 1) план без записів (нічого не пишеться ні в БД, ні в storage)
pnpm import:legacy --dry-run

# 2) реальний імпорт
pnpm import:legacy

# лише конкретні бізнеси (точний id або підрядок, прапорець повторюваний)
pnpm import:legacy --only get-nailed --only mc-beauty-center --only be-beautiful

# явний шлях і/або інша кампанія
pnpm import:legacy --dir ~/Developer/website-offers --campaign legacy-website-offers
```

### На сервері

```bash
LEGACY_DIR=/root/website-offers pnpm import:legacy --dry-run
LEGACY_DIR=/root/website-offers pnpm import:legacy
```

`LEGACY_DIR` за замовчуванням `/root/website-offers` (шлях зі спеки);
`--dir` перекриває змінну оточення. Підтримується `~`.

### Прапорці

| Прапорець | Значення |
|---|---|
| `--dir <path>` | тека legacy-воркспейсу (типово `$LEGACY_DIR`) |
| `--campaign <id>` | кампанія-парасолька (типово `legacy-website-offers`) |
| `--only <name>` | лише збіги за id або підрядком; можна повторювати |
| `--limit <n>` | обмежити кількість клієнтів |
| `--dry-run` | надрукувати план, нічого не писати |
| `--json` | повний машиночитний підсумок |

Передумови: `docker compose up -d postgres minio` і застосовані міграції
(`pnpm db:migrate`).

---

## 3. Формат legacy (що реально лежить у теці)

Станом на імпорт у `~/Developer/website-offers` — **487 клієнтів**, усі однакової
структури, усі зі статусом `discovered`:

```
clients/<client-id>/
  lead.yaml            факти у конвертах {value, source_ids, confidence, verified_at}
  status.yaml          статус, гейти, gaps, history
  sources.json         джерела: source_id, url, captured_at, method, raw_ref
  assets/manifest.json  (порожній: "assets": [])
  website/README.md    плейсхолдер, НЕ сайт
  outreach/README.md   плейсхолдер
campaigns/2026-07-gr-patras-beauty/
  campaign.yaml
  raw/google-maps/*.html   24 сирі HTML (13.4 МБ) — реальні докази
indexes/
  clients.jsonl, dedup.json, campaigns.json
```

Важливо: `raw_ref` у `sources.json` вказує **відносно теки кампанії**, а не теки
клієнта. Один HTML пошукової видачі є доказом одразу для багатьох клієнтів.

---

## 4. Таблиця відповідності legacy → фабрика

| Legacy | Фабрика | Примітки |
|---|---|---|
| тека `clients/<client-id>/` | `businesses` (1 рядок) | id перераховується як `<country>-<city>-<slug>`, як у normalize-воркері |
| `lead.identity.display_name.value` | `businesses.name` + `normalized_name` | |
| `lead.classification.category.value` | `businesses.category` | |
| `lead.location.address.value` | `businesses.address` | склеюється з `full`/`street`/`postal_code`/`city` |
| `lead.location.coordinates.value` | `businesses.lat` / `lng` | |
| `lead.location.maps_url.value` | `businesses.listing_url` | |
| `!19sChIJ…` з `maps_url` | `businesses.place_id` | **справжній ChIJ place_id витягується з URL** — legacy вважав це gap-ом |
| `place_ref` hex (`0x…:0x…`) | `place_id` = `legacy_place_ref:<hex>` | лише як fallback, з префіксом, щоб не сплутати зі справжнім place_id |
| `lead.contact.phones/emails` | `business_contacts` | verified лише за наявності резолвабельного джерела |
| решта полів `lead.yaml` | `business_facts` (key = `identity.display_name`, `presence.rating`, …) | `confidence`: high→0.9, medium→0.6, low→0.3 |
| `sources.json[]` | `business_sources` | `method='legacy_import'`, `raw_object_key` — завантажений файл |
| `sources[].raw_ref` → файл | об'єкт у bucket `raw` | ключ `legacy/<sha256[0..16]>/<шлях>`; оригінальний шлях і mtime — у метаданих |
| сам `lead.yaml` | ще один `business_sources` (`source_type='directory'`) | пакет теж є доказом того, що legacy стверджував |
| `assets/manifest.json[]` | `assets` | `rights='private_demo_only'`, `ai_generated=false` (реальні фото) |
| `research/*audit*.json` | `website_audits` | вердикт мапиться в 6 значень спеки; невідомий → `none` + примітка |
| `website/` з реальними файлами | `site_projects` (`state='needs_human_review'`) | лише фіксується, **не деплоїться** |
| `status.yaml.status` | `businesses.status` + `status_reason` | див. §5 |
| `status.yaml.gaps[]` | `production_gaps` (`soft`, префікс `legacy:`) | переносяться дослівно |
| — | `status_history` | один рядок, `actor='legacy-import'`, з причиною |

---

## 5. Мапінг статусів (чесний, без завищення)

Legacy і фабрика мають схожі назви, але різні значення. Legacy `qualified`
означає лише «пакет виглядає достатньо повним для Stage 2», що **слабше** за
`qualified` фабрики (скоринг + незалежний QA, етап 7 спеки). Тому:

| Legacy статус | Фабрика | Чому |
|---|---|---|
| `discovered` | `discovered` | значення збігається один-в-один |
| `enriching` | `needs_review` | перерване збагачення, стан невідомий |
| `needs_review` | `needs_review` | |
| `rejected` | `rejected` | |
| `qualified`, `site_in_progress`, `site_ready` | `needs_review` | legacy-кваліфікація слабша за гейт фабрики — вирішує людина |
| `outreach_approved`, `contacted`, `replied`, `won`, `lost` | `needs_review` | був аутріч; перевірити перед будь-яким send фабрики |
| відсутній / невідомий | `needs_review` | |

**Жоден бізнес не стає `production_ready` на імпорті.** Цей гейт заробляється
readiness-воркером фабрики, а не успадковується з теки.

Кожен імпортований бізнес отримує `status_reason`, що починається з
`legacy-import:`, і рядок у `status_history` з `actor='legacy-import'`.

---

## 6. Evidence і правило «немає доказу — немає verified»

- Кожен legacy-файл вантажиться в object storage як **immutable** об'єкт.
- Ключ **content-addressed**: `legacy/<sha256[0..16]>/<санітизований шлях>`.
  Той самий файл → той самий ключ (тому повторний імпорт нічого не дублює);
  змінений файл → новий ключ, старий доказ ніколи не перезаписується.
- Оригінальний відносний шлях і `mtime` зберігаються в метаданих об'єкта
  (`legacy_path`, `legacy_mtime`) і в `business_sources.url`, тож санітизація
  ключа (грецькі назви файлів MinIO не приймає) нічого не втрачає.
- `business_facts.verified = true` **тільки** якщо хоча б один `source_id` факту
  резолвиться у реально створений `business_sources` з завантаженим файлом.
  Інакше факт зберігається `verified = false` і додається gap
  `unverified_facts:<ключі>`.
- Недоступний `raw_ref` → gap `legacy_raw_missing:<шлях>`; відсутній файл ассета
  → `legacy_asset_missing:<шлях>`. Нічого не вигадується.

---

## 7. Дедуплікація

Використовується той самий порядок, що й у `src/workers/normalize.ts`:

```
place_id → нормалізований телефон → домен → назва + гео (150 м)
```

Наслідки:

1. Повторний запуск імпортера приєднується до наявного бізнесу (`attached`), а
   не створює другий рядок.
2. Пізніше discovery через gosom, яке знайде той самий бізнес, потрапить у **той
   самий `business_id`** — бо ChIJ place_id уже витягнутий з legacy `maps_url`.
3. Дедуп **ніколи не видаляє evidence**: дублікат лише додає джерело.
4. При `attached` статус наявного бізнесу **не переписується** — ним керує
   пайплайн фабрики. Заповнюються лише порожні колонки (place_id, телефон,
   сайт, адреса, координати, рейтинг).

Перевірено: запит за трьома ChIJ place_id з legacy повертає рівно ті самі три
`business_id`, які створив імпорт.

---

## 8. Ідемпотентність

Другий прогін по незміненому дереву створює **нуль** нових рядків.

Ключі ідемпотентності:

| Сутність | Ключ |
|---|---|
| `businesses` | дедуп (place_id → телефон → домен → назва+гео) |
| `business_sources` | `(business_id, url, raw_object_key)` |
| `business_facts` | `(business_id, key, value)` |
| `business_contacts` | `(business_id, channel, value)` |
| `assets` | `(business_id, hash)` |
| `website_audits` | префікс `notes` = `legacy-import from <шлях>` |
| `site_projects` | `(business_id, dir)` |
| `production_gaps` | `(business_id, gap)` серед нерозв'язаних |
| об'єкт у storage | content hash у ключі |

---

## 9. Результат перевірки (2026-08-16, `~/Developer/website-offers`)

Три названі бізнеси, два послідовні прогони:

| | Прогін 1 | Прогін 2 |
|---|---|---|
| businesses | 3 created | **0 created**, 3 attached |
| sources | 6 created | **0 created**, 6 already present |
| facts | 21 (0 unverified) | **0** |
| gaps | 30 | **0** |
| objects uploaded | 6 | **0** |
| failed | 0 | 0 |

Стан у БД після імпорту:

| business_id | status | sources | facts | verified | assets | gaps |
|---|---|---|---|---|---|---|
| `gr-patras-be-beautiful` | `discovered` | 2 | 7 | 7 | 0 | 10 |
| `gr-patras-get-nailed-beauty-services` | `discovered` | 2 | 7 | 7 | 0 | 10 |
| `gr-patras-mc-beauty-center-laser` | `discovered` | 2 | 7 | 7 | 0 | 10 |

Інваріант дотримано: `verified` фактів без `source_id` — **0**.

Gaps на кожен бізнес: 6 hard (`identity`, `verified_contact`, `services_min3`,
`assets_min3`, `hero_or_logo`, `review_context`) + 4 soft, перенесені з legacy
(`legacy:contact.phones`, `legacy:contact.website`,
`legacy:location.address.postal_code`, `legacy:location.place_id`).

Повний прогін по всіх 487 клієнтах теж перевірено: 487 імпортовано, 0 падінь,
повторний прогін — 0 нових рядків.

---

## 10. Що в legacy-даних неоднозначне

1. **Ассетів немає взагалі.** Усі 487 `assets/manifest.json` порожні — фото,
   логотипів і скриншотів у legacy не збиралося. Код імпорту ассетів написаний і
   спрацює, коли/якщо такі файли з'являться, але зараз завжди імпортує 0.
2. **Демосайтів немає.** Усі `website/` містять лише README-плейсхолдер, тому
   `site_projects` не створюються. Код розрізняє плейсхолдер і реальні файли.
3. **Аудитів немає.** Тек `research/` не існує, `website_audits` не створюються.
4. **Контактів немає.** Телефони, email, сайти, години, послуги, кількість
   відгуків — усюди `null`. Legacy зупинився на картці Google Maps.
   Тому в кожного бізнесу gap `verified_contact`: фабрика не може писати
   бізнесу, поки enrichment не дасть канал.
5. **`place_id` у legacy вважався gap-ом**, але справжній ChIJ id насправді
   присутній у `maps_url` (сегмент `!19s`) — імпортер його витягує. Це прямо
   покращує майбутню дедуплікацію з gosom.
6. **Один HTML — багато клієнтів.** 487 клієнтів посилаються на 24 файли
   пошукової видачі. Content-addressed ключі роблять це дешевим автоматично:
   файл завантажується один раз і переюзається як доказ багатьма бізнесами.
7. **Один клієнт має грецьку назву файлу**, яку MinIO не приймає як ім'я
   об'єкта (`gr-patras-business-3c13`). Ключі санітизуються до ASCII; повний
   оригінальний шлях лишається в метаданих і в `business_sources.url`.
8. **Кампанія в legacy одна** (`2026-07-gr-patras-beauty`), тому всі імпортовані
   бізнеси йдуть в одну кампанію фабрики `legacy-website-offers`.

---

## 11. Розбіжність зі старим `pnpm factory import`

У `src/cli.ts` лишається команда `import` з прототипу v0. Вона читає **неіснуючі**
поля (`lead.name`, `lead.phone`, `lead.website` — у legacy вони вкладені в
`identity.display_name.value` тощо), не вантажить evidence, не робить дедуп і не
ідемпотентна. Вона **застаріла**; фаза F — це `pnpm import:legacy`.
Прибирання старої команди — поза межами цієї задачі (файл належить іншому агенту).

---

## 12. Файли

| Файл | Роль |
|---|---|
| `scripts/import-legacy.ts` | CLI (`pnpm import:legacy`) |
| `src/import/importer.ts` | оркестрація імпорту, дедуп, ідемпотентність |
| `src/import/legacyReader.ts` | read-only читання legacy-дерева |
| `src/import/mapping.ts` | чисті функції мапінгу (статуси, факти, gaps) |
| `src/import/storage.ts` | content-addressed завантаження evidence |
| `src/import/types.ts` | типи legacy-формату |
