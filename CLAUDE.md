# Websites Factory

Автономна фабрика: пошук локальних бізнесів → evidence package → персоналізований демосайт → approval-gated outreach. Власник рішень: Роман.

## Джерело істини

**`docs/SPEC.md` — авторитетна специфікація.** Всі 13 зафіксованих рішень Романа там. При будь-якому конфлікті між кодом, README і спекою виграє спека. `docs/FACTORYFLOW.md` і `docs/CURRENT-STATE-2026-08.md` — історичний контекст, не інструкція.

## Процес роботи (жорстке правило)

1. **Будуй ВСЮ фабрику за один безперервний захід**, у порядку фаз A → F (розділ 10 спеки). Фази - це порядок збірки і критерії САМОперевірки: не переходь до наступної, доки критерій поточної не виконаний реальним прогоном, але НЕ зупиняйся чекати погодження Романа між фазами.
2. Зупинка дозволена лише коли фізично заблокований діями, які може зробити тільки Роман (секрети, QR-логіни, вибір машини). У такому разі: зроби все, що можливо без цього, задокументуй блокер у SETUP.md і продовжуй інші незалежні частини.
3. Архітектурні відхилення від спеки не робляться мовчки: спершу пропозиція Роману, після його "ок" - зміна в SPEC.md, потім код.
4. Результат = працююча система, перевірена реальними прогонами (не "код написаний"). Фінал: все підняте в dry_run, один зведений SETUP.md з коротким чеклістом дій Романа для переходу в live.

## Стан репозиторію

Фази A-F **реалізовані**; розбіжності прототипу v0 зі спекою закриті. Зведений
документ для Романа — **`SETUP.md`** у корені (сервіс-мапа, деплой, чекліст
переходу в live, обмеження, траблшутинг).

- discovery — тонкий клієнт REST API gosom (рукописний скрейпер видалено);
- агентний шар — тільки по підписці (`CLAUDE_CODE_OAUTH_TOKEN` / Codex CLI),
  `@anthropic-ai/sdk` і `ANTHROPIC_API_KEY` не використовуються ніде;
- інтерфейс — Next.js UI (`ui/`, :3000); тимчасовий HTML-dashboard прибрано,
  `:8787` лишився службовим JSON API і приймачем вебхуків;
- outreach — месенджери перед email, WhatsApp через self-hosted WAHA;
- legacy-імпорт — `pnpm import:legacy` (стару команду `pnpm factory import` видалено).

Профільні документи: `docs/AGENT-RUNTIME.md`, `docs/BUILD-PIPELINE.md`,
`docs/DESIGN-STACK.md`, `docs/MEDIA.md`, `docs/OUTREACH.md`, `docs/IMPORT.md`,
`docs/PIPELINE-STAGES-2-8.md`.

Що з v0 збереглося і лишається правильним: схема БД (17 таблиць), state machine
зі status_history, pg-boss черга з idempotency, evidence-правила, readiness-gates,
QA-loop.

**Обовʼязково при роботі в контейнері:** образ запускається під користувачем
`node`, бо Claude Code відмовляється працювати під root
(`--dangerously-skip-permissions cannot be used with root`). Повернення до root
ламає всі агентні етапи.

## Інваріанти (порушення = баг, незалежно від фази)

- Реальний білд демо (`content-and-design`/`build-site` для справжнього бізнесу) запускається ТІЛЬКИ кнопкою Романа в UI або політикою кампанії. Агенти/тести НІКОЛИ не запускають і не "перевіряють" пайплайн на реальних бізнесах — тільки на фікстурах (`e2e-*`).

- Кожен факт має source_id → immutable raw evidence. Немає доказу = null + gap. Вигадувати контакти/послуги/відгуки/ціни неможливо by construction.
- LLM ніколи не вирішує переходи статусів і не тримає стан. Це код + Postgres.
- Без записаного в БД approval жоден send технічно неможливий. Один send на idempotency key, НІКОЛИ не auto-retry.
- Всі AI-виклики по підписках (Claude Code OAuth / Codex CLI / FlowKit через Google AI), жодного pay-per-token API.
- AI-згенеровані медіа позначаються `ai_generated` і не видаються за реальні фото бізнесу.
- Демо приватні: noindex, неугадувані URL, assets `private_demo_only`.
- Падіння одного бізнесу не зупиняє кампанію.

## Setup

```bash
cp .env.example .env         # ТІЛЬКИ інфра; ANTHROPIC_API_KEY не потрібен
echo "UI_PASSWORD=$(openssl rand -hex 16)" >> .env
echo "SETTINGS_MASTER_KEY=$(openssl rand -hex 32)" >> .env
cp -r skills/* .claude/skills/   # skills/ - джерело правди (gen-image та майбутні)
docker compose up -d postgres minio
pnpm install && pnpm db:migrate
pnpm typecheck && pnpm tsx scripts/smoke.ts   # обидва мають бути зеленими до і після твоїх змін
pnpm e2e                                      # так само зелений до і після змін (потрібен піднятий стек)
pnpm tsx scripts/test-settings.ts             # шифрування + БД→env→дефолт + live-зміна
```

**Операційна конфігурація живе в Postgres, не в `.env`** (рішення Романа
2026-08-17, SPEC §8): токени, SMTP/IMAP, WAHA, ліміти, dry_run/live
редагуються в UI на `/settings` і діють наживо (TTL 15с, без перезапуску і без
ребілду). Секрети зашифровані AES-256-GCM під `SETTINGS_MASTER_KEY` з `.env`.
Порядок розвʼязання: **БД → env → дефолт**.

Наслідок для коду: `config.*` — це ГЕТЕРИ (`src/config.ts`). Ніколи не
захоплюй їх у module-level константу (`const x = config.a.b` на рівні модуля
заморозить значення) — читай у момент використання. Реєстр ключів —
`src/lib/settings.ts`, він же шариться в UI через `ui/factory/settings.ts`
(симлінк локально, копія в Docker-білді — як schema.ts і buildPolicy.ts).

## Задача: побудувати все

Виконай фази A → F повністю (деталі і критерії кожної - розділ 10 спеки):

- **A** gosom сервісом у compose, discovery.ts = тонкий клієнт його REST API (email-екстракція on, проксі закладені порожнім списком, 0 результатів = failure з алертом), рукописний Maps-скрейпер видалити. Самоперевірка: реальна кампанія Patras beauty дає 20+ кандидатів у БД з raw evidence без дублікатів.
- **B** агентний шар повністю на Claude Code по підписці (`CLAUDE_CODE_OAUTH_TOKEN`, рішення №10; `@anthropic-ai/sdk` з API-ключем прибрати), прогін етапів 2-8 на реальних кандидатах. Самоперевірка: 3+ бізнеси production_ready, у решти чесні gaps.
- **C** builder з дизайн-стеком (Aceternity + Magic UI в шаблоні, gsap-skills, референси; розділ 2.4), FlowKit/gen-image інтеграція (розділ 2.5; Chrome-міст на маку Романа - якщо недоступний, зробити адаптер + мок і записати в SETUP.md), visual QA loop, private deploy. Самоперевірка: демо реального бізнесу відкривається по приватному URL, скриншоти і QA-звіт у storage.
- **D** Next.js UI (approval-черга, воронка, кампанії, jobs, розмови; розділ 12 спеки) + Telegram-пуші з лінками, outreach у dry_run. Самоперевірка: Approve в UI створює simulated send рівно один раз, ручні канали дають deep-link кнопку.
- **E** live-адаптери: Gmail SMTP/IMAP, WAHA, follow-ups, reply detection. Без секретів Романа - будувати з моками, реальну перевірку описати в SETUP.md.
- **F** імпортер legacy `/root/website-offers`. Самоперевірка: Get Nailed / MC Beauty / BE BEAUTIFUL імпортуються без дублювання.

Фінальний стан: `docker compose up -d` піднімає все, повний пайплайн проходить у dry_run, SETUP.md містить вичерпний чекліст дій Романа (токени, QR, вибір хоста) для переходу в live.
