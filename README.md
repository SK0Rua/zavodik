# Websites Factory

Автономна фабрика: пошук локальних бізнесів → evidence package → персоналізований демосайт → approval-gated outreach → replies/CRM.

Code-first мультиагентна система: **PostgreSQL = state machine і джерело істини, pg-boss = черга jobs, агенти = workers для нечітких етапів**. Оркеструє детермінований код, не LLM.

Агентний шар дворівневий (`AGENT_RUNTIME`):

- **claude-code (default)**: builder = справжній Claude Code агент через Agent SDK. Отримує ізольований workspace з Next.js-шаблоном (static export), immutable snapshot, brief, design contract і локальні assets. Сам пише код, сам запускає `pnpm install`/`pnpm build`, сам фіксить помилки збірки. QA-issues повертаються в той самий workspace на виправлення.
- **api**: дешеві одношотні structured-виклики (enrichment-екстракція, brief, дизайн-напрямки, критик) там, де агентність не потрібна; також fallback-режим builder (static HTML одним викликом).

## Архітектура

```text
CLI/schedule
   ↓
discover (Playwright Google Maps)          [worker]
   ↓ raw -> object storage
normalize + dedup (детерміновано)          [worker]
   ↓
fast-qualify (детерміновано)               [worker]
   ↓
enrich (browser capture -> LLM structured) [agent worker]
   ├─ collect-assets (hash+provenance)     [worker]
   └─ audit-website (URL matrix + browser) [worker]
        ↓
score-and-qa (детермін. score + незалежний QA agent)
   ↓
readiness-gate (qualified ≠ production_ready; gaps)
   ↓
content-and-design (brief agent + 3 art directions + rubric)
   ↓
build-site (builder agent, static HTML/CSS/JS + локальні assets)
   ↺ visual-qa (Playwright 3 viewports + visual critique agent, ліміт ітерацій)
   ↓
deploy-demo (static server з noindex / Dokploy adapter)
   ↓
request-approval (Telegram-картка: Approve / Reject / Changes)
   ↓ ТІЛЬКИ після Approve
send-outreach (email SMTP | WhatsApp Cloud API | manual card)
   ↓
follow-ups за розкладом · poll-replies (IMAP) · daily summary
```

Статуси бізнесу: `discovered → prequalified → enriching → needs_review → qualified → production_ready → site_in_progress → site_ready → outreach_approved → contacted → replied → meeting → proposal → won|lost` (+ `rejected`, `duplicate`, `closed`, `do_not_contact`). Всі переходи валідуються state machine і пишуться в append-only `status_history`.

## Швидкий старт

```bash
cp .env.example .env        # заповни ANTHROPIC_API_KEY, TELEGRAM_*, SMTP_* (див. нижче)
docker compose up -d postgres minio
pnpm install
pnpm db:migrate
pnpm all                    # workers + dashboard (:8787) + demo server (:8788) + telegram bot
```

Або повністю в Docker: `docker compose up -d --build`.

Запуск кампанії:

```bash
pnpm factory campaign:create --id gr-patras-beauty \
  --country gr --city Patras --niche beauty --lang el \
  --queries "nail salon,beauty salon,κομμωτήριο" --target 30
pnpm factory campaign:run --id gr-patras-beauty
```

Далі все їде саме: dashboard на `http://localhost:8787` показує воронку, jobs і помилки. Коли сайт пройде QA і задеплоїться, у Telegram прийде картка approve. Після Approve повідомлення відправляється рівно один раз (окремий idempotency key на send).

Імпорт наявного `/root/website-offers`:

```bash
pnpm factory import --dir /root/website-offers --campaign imported-patras-beauty
```

## Що потрібно від тебе, щоб фабрика працювала «бойово»

| Ключ | Для чого | Без нього |
|---|---|---|
| `ANTHROPIC_API_KEY` | всі агенти (enrichment, brief, дизайн, builder, QA) | пайплайн зупиняється на enrichment (needs_human) |
| `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | approval-картки, алерти, daily summary | approvals лишаються в dashboard/БД |
| `SMTP_*` + `IMAP_*` | email outreach + reply detection | email-канал недоступний |
| `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_ID` | автоматичний WhatsApp | картка з wa.me-лінком (ручний тап) |
| `FACTORY_MODE=live` | реальні відправки | `dry_run`: весь флоу працює, send симулюється |

Instagram DM не автоматизується принципово (бан акаунта): фабрика готує текст і шле картку в Telegram.

## Правила, які вбудовані в код (не в документацію)

- Кожен факт має `source_id` → `business_sources` → immutable raw object. Факт без source не стає verified.
- Вигадані контакти/послуги/відгуки неможливі by construction: агенти бачать лише захоплений raw-контент.
- Дедуп: place_id → телефон → домен → name+geo. Дублікат приєднує source, а не створює бізнес.
- Website audit: повна матриця http/https × www/non-www + реальний браузер + mobile. Одна TLS-помилка ≠ «сайту нема».
- Qualification ≠ priority score ≠ production readiness. Gaps блокують генерацію нечесного демо.
- Builder бачить тільки immutable snapshot. Бракує контенту → пакет назад на enrichment, а не фантазія.
- QA-ліміт ітерацій → `needs_human_review`, без нескінченних циклів.
- Outreach: без записаного approval send неможливий; окремий idempotency key на кожен send; daily limit; do_not_contact перевіряється в момент відправки; opt-out назавжди блокує контакт.
- Падіння одного бізнесу ніколи не зупиняє кампанію (retries + dead-letter в `workflow_jobs`).

## Структура

```text
src/
  db/            schema (17 таблиць), клієнт, міграції
  orchestrator/  statuses (state machine), queue (pg-boss), router (переходи етапів)
  agents/        agent harness: structured output через forced tool use + zod
  workers/       discovery, normalize, fastQualify, enrich, assets, audit,
                 score, readiness, contentDesign, snapshot, builder, visualQa,
                 deploy, approval, outreach, replies, summary
  telegram/      approval bot + notifications
  api/           dashboard + JSON API + demo static server + WhatsApp webhook
scripts/smoke.ts детермінований смоук-тест пайплайна
```

## Тести

```bash
pnpm typecheck
pnpm tsx scripts/smoke.ts   # campaign -> normalize -> dedup -> qualify -> audit -> gaps -> queue
```

## Свідомі відхилення від FACTORYFLOW.md

1. **n8n немає**: оркестрація — власний код (state machine + pg-boss). Причина: тестованість, версіонування, один стек.
2. **Redis немає**: pg-boss живе в Postgres. Queue mode «вмикається» кількістю процесів workers.
3. **Builder = Claude Code агент (Agent SDK) з Next.js-шаблоном**, стек як у спеці (Next.js + TS, static export). Fallback `AGENT_RUNTIME=api` генерує static HTML одним викликом, якщо треба здешевити.
4. **Deploy v1 = вбудований static server** з noindex і неугадуваними URL; Dokploy-адаптер є як опція.

Все інше (модель даних, статуси, gates, правила evidence, межі автоматизації) відповідає специфікації.
