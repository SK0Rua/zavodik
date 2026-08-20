# Агентний рантайм: тільки по підписці

Реалізація спеки §2.3 і рішення №10. **`ANTHROPIC_API_KEY` не потрібен, не читається і не передається в жоден процес.** Пакет `@anthropic-ai/sdk` (pay-per-token) видалений з залежностей.

## Два рантайми, один інтерфейс

| Рантайм | Оплата | Аутентифікація |
|---|---|---|
| `claude-code` (default) | підписка Claude Pro/Max Романа | сервер: `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` у `.env`; локально: власний логін CLI (нічого передавати не треба) |
| `codex` | підписка ChatGPT | `codex login` (токен у `$CODEX_HOME`) |

Обидва реалізують `AgentRuntime` (`src/agents/types.ts`):

```ts
structured(name, systemPrompt, userContent, zodSchema, opts) -> T   // headless, без інструментів
codeAgent(opts, resultSchema) -> T                                  // workspace + інструменти, результат через result.json
```

Публічний API для воркерів не змінився:

```ts
import { runAgent, z } from '../agents/agent.js';        // structured
import { runCodeAgent } from '../agents/codeAgent.js';   // workspace
```

Обидва модулі тепер тонкі фасади над `src/agents/runtime.ts`.

## Файли

| Файл | Що робить |
|---|---|
| `src/agents/types.ts` | інтерфейс `AgentRuntime`, `RateLimitedError`, `AgentSchemaError`, типи опцій |
| `src/agents/runtime.ts` | вибір рантайму + публічні `runAgent` / `runCodeAgent` |
| `src/agents/claudeCodeRuntime.ts` | адаптер Claude Code (Agent SDK) |
| `src/agents/codexRuntime.ts` | адаптер Codex CLI (`codex exec`) |
| `src/agents/schema.ts` | zod → JSON Schema, стійкий парсер JSON з відповіді |
| `src/agents/semaphore.ts` | обмеження конкурентності агентних викликів |

## Як зроблено structured output

**Claude Code:** нативно через Agent SDK — `outputFormat: { type: 'json_schema', schema }` (є в `@anthropic-ai/claude-agent-sdk` 0.3.233), результат читається з `result.structured_output`. Плюс `allowedTools: []`, turn budget (див. нижче), `permissionMode: 'bypassPermissions'`, `settingSources: []` (щоб проєктні CLAUDE.md/скіли не втручались у витяг фактів). У промпт додатково вкладається JSON Schema — якщо `structured_output` порожній, парситься фінальний текст (зняття ```-огорожі, збалансований span з урахуванням лапок). Невалідний JSON/схема → retry (за замовчуванням 3 спроби), далі `AgentSchemaError` з кодом `NEEDS_HUMAN` (спека §7: schema failure не крутиться в retry-циклі).

**Codex:** `codex exec --output-schema <file> --output-last-message <file> --sandbox read-only --ephemeral`; JSON береться з останнього повідомлення агента і валідується тією ж zod-схемою.

**Мультимодальність (visual QA):** скриншоти пишуться у тимчасову теку, агенту дозволяється лише `Read` і передаються шляхи до файлів — картинки читає він сам. Жодних base64-payload'ів в API.

## Моделі

Перевірено емпірично на `claude` CLI 2.1.233 — обидва id приймаються:

```
AGENT_MODEL=claude-sonnet-5        # enrichment, QA, content, outreach
AGENT_MODEL_HEAVY=claude-opus-5    # builder, design, visual critique
```

Для Codex `CODEX_MODEL` за замовчуванням порожній = дефолтна модель CLI.

## Вибір рантайму

```bash
AGENT_RUNTIME=claude-code      # глобально: claude-code | codex
AGENT_RUNTIME_BUILDER=codex    # перевизначення на етап
```

Доступні kind'и: `enrichment`, `qa`, `content`, `design`, `outreach`, `builder`, `visual-critique`.
`config.agents.runtimeFor(kind)` повертає ефективний рантайм. Значення `api` більше не існує — якщо воно лишилось у старому `.env`, код друкує попередження і використовує `claude-code`, а не вмикає API-білінг.

## Turn budget і рятування результату

`structured()` більше не прибитий до одного ходу. Дефолт — **2** ходи без інструментів (`maxTurns` у `StructuredOptions` перевизначає; з картинками додається хід на кожен Read). Причина: один хід вистачає для малої схеми, але великий structured-вихід (наприклад 3 повні art directions проти ~24KB промпту) інколи дописується на другому ході, і `error_max_turns` вбивав нормальний прогін. При `allowedTools: []` зайвий хід не дає агенту зробити жодної дії — тільки дописати відповідь.

**Окремий баг, полагоджений разом:** Agent SDK перетворює ненульовий вихід процесу з error-результатом на **throw** `Claude Code returned an error result: ...` (`Query.readMessages`). Через це `collectRun` не повертався, і повністю валідна відповідь, дописана на останньому ході, викидалась, а виклик спалював усі retry. Тепер:

- якщо `result`-повідомлення вже прийшло (`sawResult`), payload зберігається, а throw не пропускається далі;
- `structured()` приймає відповідь, якщо вона **валідується схемою**, навіть коли підтип сесії `error_max_turns` (у лог іде warning);
- `codeAgent()` перед тим, як оголосити падіння, перевіряє `result.json` на диску — артефакт є контрактом; якщо він валідний, сесія вважається успішною.

Rate-limit і timeout лишаються справжніми помилками і пропускаються далі як були.

Регресія закріплена: `pnpm tsx scripts/test-agent-salvage.ts` (реальні виклики) — форсує `error_max_turns` на агенті, який уже записав `result.json`, і перевіряє, що результат врятовано.

## Skills і налаштування у workspace-агента

`codeAgent()` приймає `skills?: string[] | 'all'` і передає їх в Agent SDK. Це **єдине місце, де скіли вмикаються** — `'Skill'` у `allowedTools` застаріле. Пропущене значення ≠ "скіли вимкнені": діють дефолти CLI. Builder передає `skills: 'all'`, бо в його workspace лежать офіційні GSAP-скіли (`<workspace>/.claude/skills/gsap-*`, спека §2.4 / рішення №11).

Застереження SDK: це **фільтр контексту, а не пісочниця** — невключені скіли ховаються зі списку, але їхні файли лишаються читабельними через Read/Bash. Для нас нормально: там публічна GSAP-документація, без секретів.

**Свідома асиметрія `settingSources`:**

| | `structured()` | `codeAgent()` |
|---|---|---|
| `settingSources` | `[]` (повна ізоляція) | `['project']` |

Витяг фактів має бути незалежним від будь-якого local config, тому там `[]`. Workspace-агенту, навпаки, потрібен власний `<cwd>/.claude/` — саме там живуть GSAP-скіли. Але завантажується **тільки `project`**, не `user`: персональний `~/.claude` оператора фабрики не повинен впливати на те, як збирається сайт клієнта. Оскільки cwd — це `sites/<biz>/`, кореневий CLAUDE.md фабрики туди не потрапляє.

## Ізоляція workspace-агента (безпека)

Builder працює з `bypassPermissions` (він мусить сам ставити пакети і робити білди без нагляду), тому два механізми в `src/agents/sandbox.ts` є навантаженими:

**1. Allowlist змінних оточення.** Процес фабрики тримає SMTP/IMAP-паролі, Telegram-токен, S3-ключі і `DATABASE_URL`. Агенту передається **тільки явний список**: `PATH`, `HOME`, `SHELL`, `TERM`, `TMPDIR`, `LANG`/`LC_*`, `NODE*`/`PNPM_*`/`NPM_CONFIG_*`/`COREPACK_*`, `HTTP(S)_PROXY`/`NO_PROXY`, `CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_HOME`. Все інше відкидається, плюс окремий denylist (`SMTP_`, `IMAP_`, `TELEGRAM_`, `WAHA_`, `S3_`, `AWS_`, `DATABASE_`, `UI_`, `ANTHROPIC_`, `OPENAI_`, …) як другий пояс. Те саме застосовано до Codex-адаптера і до `structured()` — немає причин показувати секрети моделі, яка обробляє чужий скрейпнутий текст.

**2. PreToolUse-guard.** Кожен виклик інструменту звіряється з межами workspace: Read/Write/Edit/Glob/Grep поза `cwd` (з `realpath`, тому `..` і симлінки не рятують) — deny; Bash із мережевими командами (`curl`, `wget`, `nc`, `ssh`, `scp`, `rsync`…) до немережевого loopback — deny; звернення до `~/.ssh`, `~/.aws`, `~/.config`, `.env`, `/etc/passwd` — deny. `pnpm`/`npm`/`npx`/`node`/`next`/`tsc` і доступ до пакетних реєстрів дозволені, бо це і є робота білдера. Guard fail-closed: якщо він сам кинув помилку, виклик забороняється.

> **Важливо для тих, хто це рефакторитиме:** `canUseTool` тут НЕ працює. Під `bypassPermissions` SDK авто-схвалює кожен виклик до колбека і друкує `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`; навіть під `permissionMode: 'default'` голі імена в `allowedTools` перекривають колбек. Перевірено емпірично на 0.3.233: файл записався попри `deny`-колбек. Працює саме **PreToolUse hook** — його `deny` дотримується. Не «спрощуй» це назад до `canUseTool`: guard мовчки перестане існувати.

**Це не периметр безпеки, а другий пояс.** Реальна ізоляція в проді — Docker-контейнер (спека §2.3: інтернету немає, крім пакетних реєстрів). У SETUP при розгортанні варто додати фільтрацію egress на рівні `--network` (дозволити лише registry.npmjs.org і API Anthropic/OpenAI), щоб мережеві обмеження трималися ядром, а не регекспами.

Перевірка: `pnpm tsx scripts/test-agent-sandbox.ts` (33 офлайн-тести) і `--live` (реальний агент пробує вкрасти `~/.ssh` і писати поза workspace).

## Метрики використання (§9)

Обидві операції приймають необов'язковий `onUsage(usage)`, який викликається раз на сесію:

```ts
{ runtime: 'claude-code', model: 'claude-sonnet-5', numTurns: 4, costUsd: 0.144, durationMs: 9102 }
```

Це дає спеці §9 "QA-ітерації" і "cost per demo" на кожну ітерацію білда. `costUsd` — оцінка споживання підписки самим рантаймом, **не рахунок**: pay-per-token тут немає. Колбек best-effort: якщо він кине помилку, агентний виклик не падає (пишеться warning).

## Ліміти підписки як частина дизайну (§2.3)

**Детекція.** Agent SDK віддає окреме повідомлення `rate_limit_event` з `rate_limit_info: { status, resetsAt, rateLimitType }`. `status === 'rejected'` = вікно вичерпане. Додатково ловляться typed-помилки асистента (`rate_limit`, `overloaded`), HTTP 429 і текстові сигнатури ("rate limit", "usage limit", "you've hit your limit"). У Codex — тільки текстові сигнатури зі stdout/stderr.

**Реакція.** Кидається `RateLimitedError { retryAfterMs, rateLimitType, resetsAt }`. `retryAfterMs` рахується з `resetsAt` (+30 c запасу, обрізається `AGENT_RATE_LIMIT_MAX_WAIT_MINUTES`, дефолт 6 год), інакше `AGENT_RATE_LIMIT_WAIT_MINUTES` (дефолт 15 хв).

**У черзі** (`src/orchestrator/queue.ts`): job переходить у **`retry_wait`** з `next_attempt_at`, лічильник `attempts` відкочується (ліміт падінь не витрачається), job перезапускається з **тим самим idempotency key** через `startAfter`, у Telegram іде повідомлення "це не помилка, черга продовжить сама". `failed` при вичерпаному ліміті не буває ніколи.

Колонка `workflow_jobs.next_attempt_at` додана міграцією `drizzle/0001_dark_mulholland_black.sql`.

## Конкурентність

`AGENT_CONCURRENCY` (дефолт 1) обмежує одночасні агентні виклики через in-process семафор (`withAgentSlot`, `src/agents/semaphore.ts`) — він огортає і `structured`, і `codeAgent` в обох адаптерах. Другий пояс: агентні типи jobs (`enrich`, `score-and-qa`, `content-and-design`, `build-site`, `visual-qa`, `request-approval`) реєструються в pg-boss з `teamSize: 1, batchSize: 1`, і їм дається довший `expireInSeconds` (90 хв), бо збірка сайту з `pnpm build` довга.

## Docker

Образ ставить обидва CLI:

```dockerfile
RUN npm i -g @anthropic-ai/claude-code @openai/codex
ENV CODEX_HOME=/home/node/.codex
USER node          # НЕ хардening: --dangerously-skip-permissions відмовляється працювати під root
```

`CLAUDE_CODE_OAUTH_TOKEN` підхоплюється з `.env`. Для Codex змонтуй `~/.codex` як volume, щоб логін підписки жив між рестартами.

## Перевірка

```bash
pnpm tsx scripts/test-agent-parsing.ts     # 31 тест: парсинг, схеми, rate-limit, семафор (без мережі)
pnpm tsx scripts/test-rate-limit-requeue.ts # retry_wait проти реального Postgres/pg-boss
pnpm tsx scripts/test-agent-salvage.ts     # рятування результату при error_max_turns (реальні виклики)
pnpm tsx scripts/test-agent-sandbox.ts     # env-allowlist + guard (33 офлайн); --live = реальна атака
pnpm tsx scripts/verify-agent-runtime.ts   # реальні виклики по підписці
AGENT_RUNTIME=codex pnpm tsx scripts/verify-agent-runtime.ts
```

## Групи воркерів: семафор на процес (рішення Романа, 2026-08-16)

`AGENT_CONCURRENCY` і `withAgentSlot` обмежують агентні виклики **в межах одного
процесу**. Поки `startWorkers()` реєстрував усі типи jobs, це означало спільну
FIFO-чергу: 40-хвилинна сесія `build-site` або блокувала бек-лог `enrich`, або
сама ставала в чергу за ним (реально спостережено: 126 `enrich` у черзі, білд не
стартував 50 хвилин).

Рішення — топологія процесів, не зміна архітектури (спека §2.3(а) говорить про
конкурентність, а вона конфігурується на процес). `src/workers/main.ts` реєструє
jobs групами `core` / `enrich` / `build`:

```bash
pnpm workers                      # усі групи (дефолт, локальна розробка)
pnpm workers --only=core,enrich   # контейнер factory
pnpm workers --only=build         # контейнер factory-build
WORKER_GROUPS=build pnpm workers  # те саме через env
```

Процес, що хостить рівно одну агентну групу, бере її власний ліміт:
`AGENT_CONCURRENCY_BUILD` / `AGENT_CONCURRENCY_ENRICH` (інакше — глобальний
`AGENT_CONCURRENCY`). Розклади реєструє тільки `core`. Деталі груп і сервісів
compose — `docs/BUILD-PIPELINE.md` §11.

Альтернативний важіль: `AGENT_RUNTIME_BUILDER=codex` кладе білд на підписку
ChatGPT, повністю звільняючи вікно Claude для enrichment.

## Мова нотаток: український шар над агентним текстом (рішення Романа, 2026-08-20)

Роман читає консоль українською, але два потоки вільного тексту українськими
бути не можуть у момент, коли їх пишуть:

- **soft gaps з enrichment.** Промпт (`enrich.ts`, правило 5) вимагає лишатись у
  мові доказів — саме це не дає моделі «перекласти» слова бізнесу в маркетинг.
  Для Патр докази грецькі, тому й пропуски грецькі: «Δεν εντοπίστηκε επίσημος
  ιστότοπος…». Виправлення — окремий прохід перекладу, а не змінений промпт.
- **зауваження незалежного QA-критика.** Англійська там навмисна: критик — інша
  персона, що міркує про походження фактів, а не про бізнес.

`src/lib/translateNotes.ts` перекладає їх **на запису**, одним пакетним викликом
`runAgent` на бізнес, у паралельну колонку. Оригінал ніколи не перезаписується —
це доказ того, що агент справді сказав, і UI тримає його на одну згортку далі.

| Поле | Колонка з перекладом | Хто пише |
|---|---|---|
| `production_gaps.gap` | `gap_uk` | `enrichHandler` |
| `qualifications.qa_notes` | `qa_notes_uk` | `scoreAndQaHandler` |
| `website_audits.notes` | — (див. нижче) | — |

**`website_audits.notes` колонки не має і не потребує.** Кожен рядок у ньому
складений з наших власних шаблонів у `src/workers/audit.ts` (`slow render (6.4s
to settle)`, `generator=WordPress 6.9.4`), тому його рендерить код —
`ui/lib/auditNotes.ts` — а не модель. Наслідки: жодного виклику підписки на
вгадування власного формату, усі старі рядки стають українськими одразу без
бекфілу, а в БД лишається англійська, яку `src/build/snapshot.ts` віддає
білдер-агенту (англомовній персоні, чий вхід не можна псувати заради мови
консолі).

Три властивості перекладу, які тримаються навмисно:

1. **Не фатальний.** Помилка перекладу → `null` у колонці + warning; UI показує
   оригінал. Неперекладений пропуск — косметика, зірваний enrichment — ні.
2. **Модель не викликається без потреби.** Текст, що вже кирилицею, проходить
   повз (`isCyrillic`), а наші власні ключі (`logo_missing`,
   `socials_unresolved`, `brand_unresolved`) мають словник у коді.
3. **Пакет із розбіжною кількістю рядків відкидається цілком.** Зсунутий на один
   переклад приписав би пропуск одного бізнесу іншому — це гірше, ніж переклад
   відсутній.

Бекфіл наявних рядків (ідемпотентний, тільки `NULL`):

```bash
pnpm tsx scripts/translate-notes.ts --campaign gr-patras-beauty-2026-08
pnpm tsx scripts/translate-notes.ts --dry-run --limit 10   # подивитись, нічого не писати
```

Юніт-перевірки рендера (без БД і без агента): `pnpm tsx scripts/test-notes-uk.ts`.
