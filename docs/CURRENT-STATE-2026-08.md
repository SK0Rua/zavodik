# Website Offers — поточний флоу, інструменти та стан

**Версія:** 2.0  
**Дата:** 2026-08-14  
**Призначення:** одним документом зафіксувати, що реально є і як зараз виконується робота

> Цей документ описує **поточний фактичний процес** у `/root/website-offers`.
> Він не визначає майбутню архітектуру. Вибір оркестратора, бази даних, черг,
> сховища, CRM, deployment platform та інших компонентів робить Роман окремо.

---

## 1. Що це за проєкт

`website-offers` — робочий простір для двох пов'язаних задач:

1. знайти локальні бізнеси, яким можна запропонувати новий або кращий сайт;
2. зібрати про кожен бізнес достатній перевірений пакет і створити на його основі
   персоналізований приватний демосайт.

Загальна логіка:

```text
пошук бізнесів
→ структурований пакет клієнта
→ enrichment і перевірка доказів
→ аудит поточного сайту
→ qualification і пріоритет
→ перевірка готовності контенту
→ генерація демосайту
→ browser/visual QA
→ приватне демо
→ окреме рішення Романа щодо outreach
```

---

## 2. Що реально використовується зараз

### 2.1 Зберігання

Поточне джерело істини — локальні файли в `/root/website-offers`:

- YAML — нормалізовані факти та статуси;
- JSON/JSONL — джерела, manifests, аудити, кампанійні списки та звіти;
- Markdown — research, правила, handoff і QA reports;
- локальні файли — фото, логотипи, screenshots і raw evidence;
- Git — локальна історія коду й документів.

Централізованої operational database зараз немає.

### 2.2 Виконання процесу

Процес зараз виконується агентами та браузерними/командними інструментами за
правилами репозиторію. Більшість переходів між етапами не автоматизована одним
виконуваним pipeline.

Фактично використовуються:

- агенти Hermes/Claude для дослідження, структурування, аналізу та генерації;
- браузер для Google Maps, офіційних сайтів і публічних соцмереж;
- HTTP/browser перевірки сайтів;
- Playwright/Chromium для screenshots і visual QA;
- Next.js + TypeScript для демосайту Get Nailed;
- GSAP/ScrollTrigger у пілоті Get Nailed;
- локальні JSON/YAML contracts;
- ручні approval-рішення Романа.

### 2.3 Чого зараз немає

Не реалізовані як частина поточної системи:

- централізований workflow orchestrator;
- business database;
- job queue;
- автоматичний наскрізний pipeline;
- CRM;
- автоматичний outreach;
- автоматичні follow-ups;
- універсальний website generator для масового запуску;
- автоматична міграція статусів між усіма етапами;
- стабільний production deployment flow для кожного демо.

Майбутні технології для цих задач **не обрані цим документом**.

---

## 3. Поточна структура робочої теки

```text
/root/website-offers/
  CLAUDE.md
  README.md

  config/
    niches/                 конфіги ніш
    locations/              конфіги міст/локацій

  campaigns/
    <campaign-id>/
      campaign.yaml
      raw/
      candidates.jsonl
      rejected.jsonl
      qualified-leads.jsonl
      priority-shortlist.jsonl
      report.json

  clients/
    <client-id>/
      lead.yaml             нормалізовані факти
      status.yaml           стан, score, gaps, history
      sources.json          джерела фактів
      raw/                  незмінені сирі матеріали
      research/             reviews, services, website audit, notes
      assets/               фото, logo, screenshots, manifest
      website/              місце для Stage 2
      outreach/             чернетки після дозволу

  indexes/                  дедуплікація та похідні реєстри
  logs/                     логи запусків і аудитів
  docs/                     правила та контракти
  sites/
    get-nailed/             реалізований Stage 2 pilot
```

`client_id` має стабільний формат:

```text
<country>-<city>-<business-slug>
```

Наприклад:

```text
gr-patras-mc-beauty-center-laser
```

---

## 4. Джерела даних

### Первинні джерела

- Google Maps;
- офіційний сайт бізнесу;
- офіційні Facebook/Instagram та інші публічні business profiles.

### Допоміжні джерела

- Google Search;
- Yelp;
- локальні каталоги;
- booking/directory profiles.

Каталог або booking profile не вважається owned website.

Для кожного матеріального факту зберігаються:

- source URL;
- час захоплення;
- тип джерела;
- метод збору;
- посилання на raw artifact;
- confidence.

Якщо доказу немає, значення не вигадується: використовується `null`, а причина
записується в gaps.

---

## 5. Поточні етапи

## Етап 1 — Campaign configuration

Визначаються:

- країна й місто;
- ніша;
- search queries;
- географічні межі;
- порядок запуску;
- campaign ID.

Поточний rollout, зафіксований у конфігах:

1. Патри;
2. Салоніки;
3. Афіни;
4. Тирана після Греції.

Поточний порядок ніш:

1. beauty;
2. horeca;
3. nightlife;
4. wellness/fitness як наступна рекомендована;
5. home services як пізніша опція.

Геомежі мають бути перевірені до запуску нової кампанії.

---

## Етап 2 — Discovery

Мета — знайти бізнеси та зібрати мінімальні дані:

- назва;
- категорія;
- адреса;
- координати;
- телефон;
- website;
- Google Maps URL/place ID;
- рейтинг і кількість відгуків;
- business status.

Сирий результат зберігається окремо від нормалізованих даних.

Референсний scraper `Madi-S/Lead-Generation` розглядався як стартова точка для
Google Maps/Yelp, але його CSV не є моделлю даних і не утворює готовий pipeline.

---

## Етап 3 — Дедуплікація та materialization

Порядок пошуку дубліката:

1. listing URL/place ID;
2. нормалізований телефон або домен;
3. normalized name + address/coordinates.

Після перевірки створюється папка:

```text
clients/<client-id>/
```

У ній матеріалізуються:

- `lead.yaml`;
- `status.yaml`;
- `sources.json`;
- `raw/`;
- `research/`;
- `assets/`;
- `website/`;
- `outreach/`.

Повторний запуск не повинен створювати другого клієнта або дублювати history.

---

## Етап 4 — Enrichment

Для кожного клієнта дозбируються:

- точна identity;
- verified contacts;
- owned website;
- official social profiles;
- послуги;
- публічні ціни;
- години;
- рейтинг і кількість відгуків;
- review excerpts;
- опис бізнесу;
- фото, logo, menu/price assets.

Кожен факт має посилатися на `source_id`, який резолвиться у `sources.json`.

Raw evidence не редагується. Нове захоплення джерела створює нову версію, а не
переписує старий доказ.

---

## Етап 5 — Assets

Фото, логотипи, screenshots і menu/price images зберігаються локально в папці
клієнта.

Кожен asset у manifest має:

- локальний шлях;
- hash;
- source URL;
- source type;
- captured time;
- dimensions;
- intended usage;
- rights caution.

За замовчуванням реальні фото бізнесу можна використовувати лише для приватного
демо, доки права на публічне використання не підтверджені окремо.

---

## Етап 6 — Website audit

Аудит не обмежується однією HTTPS-адресою.

Обов'язковий процес:

1. перевірити `http/https × www/non-www`;
2. зафіксувати status, redirects, TLS і final URL;
3. відкрити найкращий endpoint у browser;
4. перевірити desktop і mobile render;
5. зробити screenshots;
6. перевірити meaningful content;
7. звірити verdict з enrichment і assets.

Поточні verdict:

- `none`;
- `unreachable_all_endpoints`;
- `working_with_https_issue`;
- `working_but_dated`;
- `acceptable`;
- `strong_modern`.

Одна помилка TLS не означає відсутність сайту. Саме через таку помилку Get Nailed
раніше був неправильно класифікований як broken, хоча HTTP-сайт працював.

---

## Етап 7 — Qualification, scoring і QA

Треба розділяти три поняття:

### Qualification

Лід варто розглядати, якщо:

- бізнес активний;
- є доведена website opportunity;
- є хоча б один verified public contact;
- немає hard reject.

### Priority score

Score визначає порядок обробки, а не автоматично відхиляє активний лід.

Компоненти поточного score:

- site gap;
- contactability;
- content richness;
- business health;
- decision path.

### Production readiness

Окремо перевіряється, чи достатньо матеріалу для демосайту:

- verified identity;
- валідний website audit;
- verified contact;
- щонайменше три підтверджені послуги;
- щонайменше три придатні assets;
- hero image або logo;
- review/content context;
- незалежний QA.

Бізнес може бути qualified, але ще не готовий до генерації сайту.

---

## Етап 8 — Website generation

Stage 2 запускається лише для конкретного клієнта після окремого дозволу Романа.

Website builder читає тільки готовий client package:

- `lead.yaml`;
- `research/`;
- `assets/manifest.json`;
- дозволені локальні assets.

Він не повинен самостійно шукати факти про бізнес. Якщо контенту бракує, пакет
повертається на enrichment.

Поточний реалізований приклад:

```text
sites/get-nailed/
```

Використаний стек цього пілота:

- Next.js;
- TypeScript;
- GSAP/ScrollTrigger;
- responsive browser QA.

Це стек одного пілота, а не автоматично затверджений універсальний стек усієї
майбутньої фабрики.

---

## Етап 9 — Build і visual QA

Для Get Nailed фактично виконувалися:

- production build;
- desktop/tablet/mobile screenshots;
- browser review;
- перевірка layout і overflow;
- visual corrections;
- QA report.

Загальні правила для наступних демо:

- build має проходити;
- critical console errors відсутні;
- сайт перевірений на desktop і mobile;
- факти на сторінці відповідають client package;
- використані лише дозволені assets;
- сайт залишається приватним до окремого рішення.

Єдиного автоматизованого QA workflow для всіх майбутніх сайтів зараз немає.

---

## Етап 10 — Preview, deploy та outreach

Для Get Nailed використовувався тимчасовий приватний Tailscale preview. Це не
постійний production deployment flow.

Публічний deploy, домен, індексація, надсилання клієнту й outreach не запускаються
автоматично.

Перед будь-яким контактом потрібне окреме рішення Романа.

Можливі подальші стани вже описані у файловому контракті:

```text
site_ready
→ outreach_approved
→ contacted
→ replied
→ won | lost
```

Але автоматизованого механізму outreach, reply processing і follow-ups зараз
немає.

---

## 6. Поточні статуси

```text
discovered
→ enriching
→ needs_review
→ qualified
→ site_in_progress
→ site_ready
→ outreach_approved
→ contacted
→ replied
→ won | lost
```

Також використовується `rejected`.

Статус і його history зберігаються у `clients/<client-id>/status.yaml`.

Переходи зараз виконуються агентами або людиною через редагування файлового стану,
а не централізованим runtime state machine.

---

## 7. Поточний реальний результат

Для кампанії Patras beauty:

- зібрано реальний набір клієнтських папок;
- виконано discovery, enrichment, assets, website audit і scoring;
- проведено browser re-audit shortlist;
- виявлено й виключено два contaminated packages;
- є три пакети, які після targeted enrichment відповідають demo-content minimum:
  - Get Nailed;
  - MC Beauty Center & Laser;
  - BE BEAUTIFUL;
- Idol Hair Design залишається заблокованим через відсутність підтверджених
  публічних review excerpts;
- створено один Stage 2 pilot — Get Nailed.

MC Beauty і BE BEAUTIFUL мають підготовлені evidence/assets/research packages, але
окремі сайти для них ще не створені.

---

## 8. Сильні сторони поточного підходу

- source-backed facts;
- raw evidence не змішується з нормалізованими даними;
- стабільні client IDs;
- дедуплікація;
- окремі qualification і production readiness;
- перевірка owned website через HTTP/HTTPS та browser;
- provenance і rights caution для assets;
- заборона вигаданих контактів, послуг і reviews;
- окремий human gate перед outreach.

Ці правила треба зберегти незалежно від майбутнього вибору архітектури.

---

## 9. Слабкі місця поточного підходу

- flow переважно описаний у документації, а не реалізований як єдиний pipeline;
- забагато ручних переходів;
- файлові статуси легко розсинхронізувати;
- різні документи можуть застарівати незалежно один від одного;
- немає job queue, retries і централізованого error handling;
- немає dashboard із поточним станом усіх бізнесів;
- enrichment і QA займають багато ручної агентної роботи;
- немає стандартного генератора сайтів;
- немає стабільного deployment/outreach flow;
- локальний Git repository не має remote, тому PR зараз неможливий.

Це опис фактичних обмежень, а не рішення щодо того, якою має бути наступна
архітектура.

---

## 10. Що ще не вирішено

Роман окремо визначає:

- чи потрібен orchestration platform і який саме;
- чи потрібна база даних;
- де зберігати assets і raw evidence;
- як організувати job queue;
- який буде основний website stack;
- чи використовувати templates, agents або їх комбінацію;
- де деплоїти приватні демо;
- яку CRM використовувати;
- які outreach channels автоматизувати;
- на якому рівні потрібен human approval;
- порядок і бюджет масштабування.

Жоден із цих виборів не вважається прийнятим лише на підставі цього документа.

---

## 11. Поточний Definition of Done для одного клієнта

Клієнтський пакет готовий до Stage 2, коли:

- бізнес правильно ідентифікований;
- немає дубліката або contamination;
- є source-backed identity і contact;
- owned website перевірений повним audit protocol;
- послуги й reviews мають докази;
- assets мають manifest і provenance;
- qualification та score перевірені;
- production gaps закриті;
- незалежний QA завершений.

Демосайт готовий, коли:

- побудований лише з client package;
- production build проходить;
- перевірений у browser на desktop і mobile;
- critical layout/console issues виправлені;
- screenshots і QA report збережені;
- preview залишається приватним;
- outreach не запускався без рішення Романа.

---

## 12. Зафіксований поточний висновок

Зараз `/root/website-offers` — це:

```text
файлова evidence-first система
+ ручна/агентна оркестрація
+ browser-based enrichment та audit
+ один Next.js Stage 2 pilot
+ ручні approval gates
```

Це ще не автоматизована фабрика. Майбутня архітектура не визначена й має бути
окремо обрана Романом.
