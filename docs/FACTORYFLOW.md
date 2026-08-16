# Website Offers Factory – цільовий флоу й архітектура

**Статус документа:** авторитетна цільова специфікація фабрики  
**Версія:** 1.0  
**Дата:** 2026-08-14  
**Власник бізнес-рішень:** Роман

> Цей документ фіксує, як має працювати фабрика: етапи, стек, дані, ролі,
> автоматизація, гейти, помилки та масштабування. Він описує **цільову систему**,
> а не стверджує, що вона вже реалізована.

---

## 1. Мета

Фабрика автоматично:

1. знаходить локальні бізнеси без нормального сайту або ж взагалі без сайту;
2. збирає перевірені факти, контакти, послуги, фото та відгуки;
3. визначає, кому доцільно запропонувати сайт;
4. генерує персоналізований wow-демосайт;
5. перевіряє його на desktop і mobile;
6. публікує приватне демо;
7. після дозволу Романа запускає персоналізований outreach;
8. веде відповіді, follow-up та результат угоди.

Цільовий результат одного проходу:

```text
campaign → qualified lead → evidence package → private demo → approved outreach → reply → won/lost
```

Фабрика повинна масштабуватися на різні міста й ніші без ручного перекладання
файлів, копіювання статусів і відновлення контексту з чатів.

---

## 2. Основне архітектурне рішення

### 2.1 n8n – центр керування

**n8n є control plane та оркестратором**, але не місцем для всієї бізнес-логіки.

n8n відповідає за:

- запуск кампаній за розкладом або вручну;
- виклик scraper/enrichment/audit/site-builder workers;
- черги, retries, timeouts і маршрути помилок;
- переходи між етапами;
- human approval gates;
- Telegram-сповіщення;
- запуск деплою та outreach після дозволу;
- запис результатів кожного job у базу.

Складна, повторно використовувана й тестована логіка живе у workers, а не у
великих Code-нодаx n8n.

### 2.2 Джерело істини

| Дані | Джерело істини |
|---|---|
| кампанії, бізнеси, статуси, score, jobs | PostgreSQL |
| нормалізовані факти та provenance | PostgreSQL |
| raw HTML/JSON, фото, screenshots, build artifacts | S3-compatible object storage |
| шаблони, workers, workflow exports, код сайтів | GitHub |
| оркестрація та approvals | n8n |
| JSON/YAML client package | експорт/agent handoff, не основна БД |

Поточні папки `clients/`, `campaigns/`, `assets/` не викидаються. Вони
імпортуються в нову модель і надалі можуть генеруватися як читабельний snapshot
клієнта.

### 2.3 Чого n8n не робить

- не зберігає binary assets у execution data;
- не є CRM-базою;
- не містить великих scraper/build scripts у Code nodes;
- не приймає AI-висновок без структурованої схеми;
- не надсилає outreach без approval;
- не виконує важкі browser/build jobs у головному n8n process.

---

## 3. Цільовий стек

| Рівень | Технологія | Призначення |
|---|---|---|
| Оркестрація | **n8n** | workflows, schedules, approvals, retries |
| Workflow DB | **PostgreSQL, окрема DB/schema для n8n** | внутрішній стан n8n |
| Business DB | **PostgreSQL** | campaigns, businesses, facts, jobs, sites, outreach |
| Queue | **Redis + n8n queue mode** | паралельні execution workers |
| Object storage | **Cloudflare R2 або MinIO/S3** | raw, assets, screenshots, build archives |
| Discovery worker | **Python** | Maps/source adapters, normalization, dedup |
| Enrichment worker | **Python + browser/API adapters** | сайт, пошук, соцмережі, reviews, services |
| Browser audit | **Playwright/Chromium** | URL matrix, desktop/mobile render, screenshots |
| AI/agent tasks | **Claude Code/LLM workers зі structured output** | research synthesis, content brief, design, implementation |
| Website stack | **Next.js + TypeScript + Tailwind/CSS + Motion** | персоналізовані демосайти |
| Motion | **CSS/Motion за замовчуванням; GSAP лише за потреби** | контрольований wow-ефект |
| Repository | **GitHub** | код, PR, версії templates/workers/workflows |
| CI | **GitHub Actions** | lint, tests, build, screenshot checks |
| Deploy | **Dokploy** | приватні demo deployments |
| Reverse proxy/domain | **Cloudflare** | demo routing, TLS, access rules |
| Notifications | **Telegram через n8n** | failures, approval requests, replies, daily summary |
| Observability | **n8n executions + structured logs + Sentry/аналог** | помилки й метрики |

На старті Redis/queue mode можна не вмикати, якщо кампанії малі. Перед паралельною
обробкою десятків бізнесів queue mode стає обов'язковим.

---

## 4. Високорівневий флоу

```text
[Campaign configuration]
          ↓
1. Discovery
          ↓
2. Normalize + deduplicate
          ↓
3. Fast qualification
          ↓
4. Deep enrichment + assets ─────┐
          ↓                      │
5. Website audit                 │
          ↓                      │
6. Scoring + independent QA ◀────┘
          ↓
7. Production-readiness gate
          ↓
8. Content + design contract
          ↓
9. Website generation
          ↓
10. Automated build + visual QA
          ↓
11. Private deploy
          ↓
12. Human approval
          ↓
13. Outreach + follow-ups
          ↓
14. Replies + won/lost + learning loop
```

Кожен етап є окремим job із власними input, output, status, attempts, error та
timestamps. Весь workflow не повинен перезапускатися через помилку одного бізнесу.

---

## 5. Етапи фабрики

## Етап 0 – Campaign setup

**Тригер:** ручний запуск у n8n або schedule.  
**Вхід:** країна, місто/геозона, ніша, search queries, target count, мова.  
**Вихід:** запис `campaign`, конфіг запуску та campaign job.

Обов'язкові параметри:

- `campaign_id`;
- location і перевірена geofence;
- niche;
- локальні та англомовні queries;
- максимальна кількість кандидатів;
- джерела;
- rate limits;
- режим `dry_run | live`;
- дозволені наступні етапи.

**Gate:** geofence, niche config і source credentials валідні.

---

## Етап 1 – Discovery

**Worker:** discovery worker.  
**Первинне джерело:** Google Maps.  
**Допоміжні джерела:** локальні каталоги, Yelp/аналоги, пошук.

Збираємо мінімум:

- назву;
- listing URL і place ID;
- категорію;
- адресу й координати;
- телефон;
- website URL;
- рейтинг і кількість відгуків;
- business status.

**Raw output** одразу зберігається в object storage без редагування. У БД
записується source URL, capture time, adapter і object key.

**Вихід:** `candidate` records.

---

## Етап 2 – Normalize + deduplicate

**Worker:** deterministic normalization service.

Порядок дедуплікації:

1. listing URL/place ID;
2. нормалізований телефон;
3. нормалізований домен;
4. normalized name + address/coordinates.

Дедуп не видаляє evidence. Нове джерело приєднується до наявного бізнесу.

**Вихід:** новий або оновлений `business`.  
**Gate:** стабільний `business_id`, valid location/category, duplicate resolved.

---

## Етап 3 – Fast qualification

Мета – не витрачати deep-enrichment на очевидно слабких кандидатів.

Перевіряємо:

- бізнес активний;
- належить до кампанії;
- не є мережею без локального decision path;
- є хоча б один публічний контакт;
- немає очевидно сильного сучасного owned site.

Результат:

- `prequalified`;
- `needs_review`;
- `rejected` із детермінованою причиною.

Score на цьому етапі попередній і не використовується як остаточний verdict.

---

## Етап 4 – Deep enrichment

**Worker:** enrichment worker + browser/LLM structured extraction.

Збираємо лише публічно підтверджені дані:

- identity і опис;
- verified contacts;
- official website та business social profiles;
- послуги й публічні ціни;
- години;
- мови;
- review excerpts;
- фото, logo, menu/price images;
- актуальні business signals.

Для кожного факту обов'язково:

- value;
- source URL;
- captured_at;
- source type;
- raw object key;
- confidence;
- extraction method.

Немає доказу – `null` + gap. Вигадування email, власника, ціни, років роботи або
відгуків заборонене.

**Assets:** кожен файл має hash, source URL, capture time, dimensions,
`intended_usage` і rights caution.

---

## Етап 5 – Website audit

**Worker:** Playwright audit worker.

Для кожного домену:

1. перевірити `http/https × www/non-www`;
2. зафіксувати redirects, HTTP status, TLS і final URL;
3. відкрити найкращий endpoint у реальному browser;
4. зробити desktop і mobile screenshots;
5. перевірити meaningful content, navigation, overflow і console errors;
6. порівняти verdict з даними enrichment.

Verdict:

- `none`;
- `unreachable_all_endpoints`;
- `working_with_https_issue`;
- `working_but_dated`;
- `acceptable`;
- `strong_modern`.

Одна TLS-помилка не означає, що сайт відсутній. Якщо enrichment витягнув із сайту
послуги/фото, а audit каже `none`, job переходить у `needs_review`.

---

## Етап 6 – Scoring + independent QA

Score обчислюється детерміновано, а LLM може лише сформулювати пояснення з
посиланнями на факти.

Компоненти:

- website opportunity;
- contactability;
- content richness;
- business health;
- decision path.

Потрібно розділяти:

- **qualification** – чи варто продавати цьому бізнесу сайт;
- **priority score** – у якому порядку його обробляти;
- **production readiness** – чи достатньо контенту для чесного демо.

QA виконує окремий agent/job, не той, що робив enrichment. Він вибірково відкриває
оригінальні джерела та повністю перевіряє website audit.

---

## Етап 7 – Production-readiness

До генерації демо потрібні:

- підтверджена identity;
- валідний website audit;
- хоча б один verified contact;
- щонайменше три підтверджені послуги;
- щонайменше три придатні demo assets;
- hero image або logo;
- достатній review/content context;
- завершений independent QA.

Лід може бути `qualified`, але `not_production_ready`. У такому разі n8n створює
точковий enrichment job лише для конкретних gaps.

---

## Етап 8 – Content brief + design contract

**Вхід:** тільки verified client package.  
**Вихід:** версіонований `CONTENT-BRIEF.md` і `DESIGN.md`/структурований аналог.

Процес:

1. сформувати source-backed content brief;
2. визначити головний offer і CTA;
3. створити три структурно різні art directions;
4. вибрати одну за rubric або human review;
5. зафіксувати DESIGN.md: layout, type, palette, sections, motion, responsive rules;
6. заборонити claims, яких немає у verified package.

Нішева design system є основою, але кожен сайт має відрізнятися структурою,
композицією, typography treatment і motion, а не лише кольорами.

---

## Етап 9 – Website generation

**Worker:** isolated website-builder agent.  
**Стек:** Next.js, TypeScript, Tailwind/CSS, Motion; GSAP opt-in.

Builder отримує:

- immutable client snapshot;
- content brief;
- selected DESIGN.md;
- дозволені assets;
- template/design-system version;
- acceptance criteria.

Builder не шукає факти в інтернеті. Брак контенту повертає пакет у enrichment.

Для кожного сайту:

- окрема Git branch;
- окремий каталог/repository boundary;
- lint, typecheck, tests і production build;
- commit із client/job metadata;
- ніколи не push напряму в `main`.

---

## Етап 10 – Automated QA + visual critique

Обов'язкові перевірки:

- production build;
- browser console errors;
- broken links/assets;
- desktop 1440 px;
- tablet 768 px;
- mobile 390 px;
- overflow і text clipping;
- accessibility basics;
- performance budget;
- reduced motion;
- factual comparison із client snapshot.

Після screenshots окремий visual-review agent робить незалежну критику. Builder
отримує лише конкретні issues, виправляє їх і повторює QA. Є ліміт ітерацій;
після нього сайт іде в `needs_human_review`, а не в нескінченний цикл.

**Gate `site_ready`:** build зелений, critical QA issues = 0, screenshots існують,
factual audit пройдено.

---

## Етап 11 – Private deploy

n8n запускає deploy у Dokploy лише для `site_ready`.

Правила:

- окремий preview hostname;
- `noindex`;
- приватний/непублічно рекламований URL;
- assets залишаються `private_demo_only`, доки права не підтверджені;
- health check після deploy;
- screenshot deployed version;
- deployment URL і version записуються в БД.

Публічний production domain клієнта не створюється й не купується до угоди.

---

## Етап 12 – Human approval

Перед першим контактом n8n надсилає Роману в Telegram картку:

- бізнес;
- score і ключова причина opportunity;
- контакти;
- demo URL;
- desktop/mobile previews;
- текст першого повідомлення;
- planned channel;
- кнопки `Approve`, `Reject`, `Needs changes`.

Без записаного approval outreach workflow не запускається. Approval може бути
per-lead або явно визначеним batch approval для конкретної кампанії.

---

## Етап 13 – Outreach

Після approval:

1. вибрати verified public channel;
2. сформувати персоналізоване повідомлення мовою клієнта;
3. надіслати або поставити в approved send queue;
4. записати provider message ID, час, channel і exact text;
5. запланувати follow-ups;
6. зупинити follow-ups після відповіді, opt-out або hard bounce.

Канали підключаються окремими adapters: email, contact form, Instagram/інший
доступний канал. Жодного вигаданого контакту або обходу platform restrictions.

---

## Етап 14 – Replies, CRM state і learning loop

Стани продажу:

```text
approved → contacted → replied → meeting → proposal → won | lost
```

Для кожного ліда зберігаємо:

- усі outreach events;
- replies;
- next action;
- lost reason;
- deal value;
- sold package;
- recurring revenue;
- conversion timestamps.

Аналітика повертається у фабрику:

- які ніші/міста відповідають;
- який site verdict конвертується;
- які design directions працюють;
- який канал і copy працюють;
- cost/time per qualified lead, site, reply і sale.

AI не змінює scoring, offer або outreach policy автоматично. Він формує
рекомендації, а Роман затверджує зміни.

---

## 6. Основна модель даних

Мінімальні таблиці business DB:

| Таблиця | Призначення |
|---|---|
| `campaigns` | конфіг і стан кампаній |
| `businesses` | стабільна identity бізнесу |
| `business_sources` | URL, captured_at, raw object key |
| `business_facts` | нормалізовані факти з provenance |
| `business_contacts` | verified public contact routes |
| `assets` | object key, hash, source, rights, usage |
| `website_audits` | endpoint matrix, verdict, evidence |
| `qualifications` | gates, score, reasons, QA result |
| `production_gaps` | відсутні inputs та їхній blocker level |
| `site_projects` | design/build/deploy state і versions |
| `workflow_jobs` | job type, attempts, status, error, timing |
| `approvals` | хто, що й коли дозволив |
| `outreach_messages` | channel, exact text, provider ID, state |
| `outreach_events` | sent, delivered, replied, bounced, opted out |
| `deals` | pipeline state, value, won/lost reason |
| `status_history` | append-only історія переходів |

Факт без source не може перейти у verified. Raw objects immutable; повторне
захоплення створює нову версію source.

---

## 7. Статуси

### 7.1 Business lifecycle

```text
discovered
→ prequalified
→ enriching
→ needs_review
→ qualified
→ production_ready
→ site_in_progress
→ site_ready
→ outreach_approved
→ contacted
→ replied
→ meeting
→ proposal
→ won | lost
```

Окремі terminal/exception states:

- `rejected`;
- `duplicate`;
- `closed`;
- `do_not_contact`.

### 7.2 Job lifecycle

```text
queued → running → succeeded | retry_wait | failed | cancelled | needs_human
```

Business status і job status не можна змішувати. Падіння одного enrichment job не
робить бізнес `rejected`.

---

## 8. n8n workflows

Не один монолітний workflow, а набір subworkflows:

1. `campaign-orchestrator`;
2. `discover-businesses`;
3. `normalize-and-deduplicate`;
4. `fast-qualification`;
5. `enrich-business`;
6. `collect-assets`;
7. `audit-website`;
8. `score-and-qa`;
9. `close-production-gaps`;
10. `prepare-content-and-design`;
11. `build-site`;
12. `visual-qa-loop`;
13. `deploy-private-demo`;
14. `request-outreach-approval`;
15. `send-outreach`;
16. `process-replies`;
17. `run-follow-ups`;
18. `daily-operations-summary`;
19. `dead-letter-recovery`.

Кожен workflow приймає `job_id`, `business_id`, `campaign_id` і повертає
структурований результат. Великі payloads передаються через DB/object keys, а не
між нодами як binary blobs.

---

## 9. Помилки, retries та ідемпотентність

Для кожного job:

- `idempotency_key`;
- max attempts;
- exponential backoff;
- timeout;
- structured error code;
- last successful checkpoint;
- dead-letter state;
- manual retry action.

Правила:

- `429/5xx/network timeout` → retry;
- authentication/credential failure → stop workflow + Telegram alert;
- schema/provenance failure → `needs_human`, без retry-loop;
- browser challenge/login wall → зафіксувати blocked source і перейти до інших
  дозволених джерел;
- одна помилка бізнесу не зупиняє кампанію;
- повторний job не дублює business, asset, message або deployment.

Outreach використовує окремий idempotency key, щоб retry ніколи не відправив
повідомлення двічі.

---

## 10. Безпека та права

- credentials зберігаються в n8n credentials/secret manager, не в workflow JSON;
- n8n UI закритий authentication і network policy;
- workers отримують мінімальні credentials;
- business DB і n8n DB логічно відокремлені;
- raw/asset buckets не є публічними;
- preview URL має `noindex`;
- PII не збирається понад публічно необхідні business contacts;
- opt-out створює `do_not_contact` і блокує всі майбутні кампанії;
- права на фото не припускаються: private demo не дорівнює дозволу на production;
- усі approvals і sends мають audit trail.

---

## 11. Спостереження та метрики

Telegram alerts:

- workflow failed після retries;
- credentials/source заблоковані;
- сайт потребує human review;
- demo готове до approval;
- отримано reply;
- daily summary.

Ключові метрики:

- discovered businesses;
- dedup/reject rate;
- qualified rate;
- production-ready rate;
- enrichment cost і duration;
- build success rate;
- average QA iterations;
- cost per demo;
- approval-to-send time;
- delivery, reply, meeting і win rate;
- revenue, MRR і lost reasons.

Логи мають містити `campaign_id`, `business_id`, `job_id`, `workflow_name` і
`execution_id`.

---

## 12. Масштабування

Порядок масштабування:

1. одна ніша + одне місто;
2. стабільні 20–50 бізнесів за кампанію;
3. queue mode і паралельні workers;
4. друга ніша в тому самому місті;
5. друге місто з тими самими adapters;
6. кілька design systems;
7. кілька мов і outreach channels.

До масштабування кожен етап повинен мати:

- success/error metrics;
- retry policy;
- idempotency;
- schema validation;
- перевірений output на реальних даних;
- визначений owner і recovery path.

---

## 13. Міграція поточного `/root/website-offers`

Поточний repository є **документованим і частково operated прототипом**, але не
готовою фабрикою. У ньому вже є цінні дані й правила, які треба зберегти.

Міграція:

1. зафіксувати DB schema та object-storage layout;
2. створити імпортер наявних `campaigns/` і `clients/`;
3. перенести raw/assets у object storage зі збереженням hash/provenance;
4. імпортувати normalized facts, audits, scores і history;
5. знайти й винести contradictions у migration review queue;
6. реалізувати deterministic validators;
7. підключити n8n workflows по одному;
8. прогнати Patras beauty повторно без дублювання;
9. порівняти результат зі старими пакетами;
10. лише після verification зробити PostgreSQL джерелом істини.

До завершення міграції стара файлова модель залишається read-only evidence archive.
Не можна одночасно вручну змінювати YAML і DB без явної sync policy.

---

## 14. Межі автоматизації

Автоматично можна:

- discovery;
- enrichment;
- audit;
- scoring;
- production-gap routing;
- design/build/QA;
- private deployment;
- підготовку outreach drafts;
- follow-up scheduling після approval.

Потрібне рішення Романа:

- зміна ринку, ніші, pricing або scoring policy;
- публічний deploy;
- купівля домену;
- зняття rights caution;
- перший контакт або batch outreach approval;
- нестандартні claims;
- автоматичне масштабування campaign limits.

---

## 15. Definition of Done фабрики v1

Factory v1 готова лише коли на реальній кампанії:

- n8n створює campaign і jobs;
- discovery знаходить і дедуплікує бізнеси;
- raw та assets зберігаються поза n8n;
- enrichment створює source-backed facts;
- website audit перевіряє URL matrix та mobile/desktop;
- QA відокремлює qualification від production readiness;
- qualified package автоматично доходить до site build;
- сайт проходить build і screenshot QA;
- private demo реально відкривається;
- Роман отримує Telegram approval card;
- без approval нічого не надсилається;
- після approval тестове повідомлення відправляється рівно один раз;
- reply змінює CRM state і зупиняє follow-ups;
- помилка одного business job не зупиняє кампанію;
- dashboard показує повний шлях і метрики.

Документація, папки або намальований n8n workflow без такого end-to-end прогону не
означають, що фабрика реалізована.

---

## 16. Зафіксоване рішення

Фінальна модель:

```text
n8n orchestration
+ PostgreSQL source of truth
+ S3-compatible evidence/assets
+ isolated scraper/browser/AI/build workers
+ GitHub versioning and CI
+ Dokploy private demos
+ Telegram approvals
+ approval-gated outreach
```

Поточні JSON/YAML contracts використовуються як основа схем і експортів, але не як
головний operational state масштабованої фабрики.
