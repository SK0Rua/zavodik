# Медіа-генерація: зображення і hero-відео

Реалізація спеки §2.5 (рішення №12 і №13). Модуль `src/media/**`.

**Все по підписках.** Зображення - Codex CLI (gpt-image-2, підписка ChatGPT). Відео - FlowKit → Google Flow/Veo (підписка Google AI). Жодного pay-per-token медіа-API; `OPENAI_API_KEY` і `ANTHROPIC_API_KEY` явно вирізаються з env перед запуском Codex.

## Інваріанти

- Все, що згенеровано тут, пишеться в `assets` з `ai_generated=true` і `rights='private_demo_only'`. Обидва прапорці зашиті в `registerGeneratedAsset()` і **не є параметрами** - воркер не може їх обійти.
- Зображення - **декоративні**: фони, текстури, патерни, og-images. Ніколи не підміняють реальне фото бізнесу, інтер'єру чи робіт майстрів.
- Hero-кліп робиться з **РЕАЛЬНОГО фото бізнесу** (evidence-асет): оживлення доказу, а не вигадана сцена. Шлях до вихідного фото зберігається в `generation_meta.sourceImagePath`.

## Публічний API

```ts
import {
  generateImage, generateHeroClip, flowkitAvailable,
  fallbackHeroMedia, registerGeneratedAsset,
} from '../media/index.js';
```

| Функція | Що робить |
|---|---|
| `generateImage({prompt, refPath?, size?, outDir, fileName?, timeoutMs?})` | Один декоративний кадр через Codex CLI. Повертає `GeneratedImage` (`filePath`, `bytes`, `contentType`, `durationMs`, `aiGenerated: true`). Кидає `ImageGenerationError` з `reason`. |
| `generateHeroClip({imagePath, prompt, durationSec?, outDir, mode?, projectId?})` | Hero-кліп із реального фото. `HeroClip` або `null` (коли й ffmpeg немає). Кидає `FlowkitError`. |
| `flowkitAvailable()` | Health-проба, ніколи не кидає: `{reachable, extensionConnected, flowKeyPresent, url, detail}`. |
| `fallbackHeroMedia({imagePath?, durationSec?, reason?})` | Конфіг Ken Burns для білдера (CSS/GSAP по реальному фото). Без мережі, без відеофайлу, **не** `ai_generated`. |
| `kenBurnsClip({imagePath, outFile, durationSec})` | Нижчий рівень: детермінований mp4 через ffmpeg, `null` якщо ffmpeg нема. |
| `ffmpegAvailable()` | Чи запускається сконфігурований ffmpeg. |
| `registerGeneratedAsset(businessId, filePath, kind, meta)` | Заливає файл у storage і пише рядок `assets` з обов'язковими прапорцями. Ідемпотентно по (businessId, sha256). |

`kind`: `background | pattern | og | texture | decor | hero_clip`.

Типовий виклик із воркера:

```ts
const img = await generateImage({ prompt, outDir, size: 'landscape' });
await registerGeneratedAsset(businessId, img.filePath, 'background', {
  generator: 'gen-image:gpt-image-2', prompt: img.prompt,
});

const clip = await generateHeroClip({ imagePath: realPhoto, prompt, outDir });
if (clip) {
  await registerGeneratedAsset(businessId, clip.filePath, 'hero_clip', {
    generator: `flowkit:${clip.model ?? 'ken-burns'}`,
    prompt: clip.prompt, sourceImagePath: clip.sourceImagePath, durationSec: clip.durationSec,
  });
} else {
  applyKenBurns(fallbackHeroMedia({ imagePath: realPhoto }));  // відеофайлу нема взагалі
}
```

## Зображення: gen-image через Codex CLI

`src/media/images.ts` виконує кроки `skills/gen-image/SKILL.md` програмно:

1. жорсткий префікс (`HARD CONSTRAINT: Use ONLY image_gen/gpt-image-2...`) - без нього Codex починає "малювати" через Python/PIL/SVG;
2. `codex exec --sandbox workspace-write --skip-git-repo-check [--image <ref>] <prompt>`;
3. найсвіжіший файл із `$CODEX_HOME/generated_images/<session-uuid>/exec-*.png` (обхід рекурсивний - Codex кладе результат у підтеку сесії, а не в корінь), копіюється в `outDir`;
4. якщо файлу немає **і** в транскрипті видно `PIL/matplotlib/<svg` - результат відхиляється (`reason: 'drawing_fallback'`), фейк не приймається.

Порядок перевірок важливий: істина - це **наявність файлу**, а не текст транскрипту. Codex вивалює в лог власний skill-док `imagegen`, де згадуються і PIL/SVG, і "image_gen unavailable"; якщо звіряти транскрипт першим, успішна генерація хибно відхиляється. Тому евристики по тексту вмикаються лише тоді, коли файл не з'явився.

**Розбіжність зі SKILL.md:** скіл документує `--full-auto`, але в Codex CLI 0.147.0 цього прапорця вже немає (`error: unexpected argument '--full-auto'`). Адаптер задає лише `--sandbox workspace-write`. Скіл варто оновити.

`ImageGenerationError.reason`: `codex_missing | image_tool_unavailable | drawing_fallback | no_output | timeout | exec_failed`. Декоративне зображення не є доказом, тому його відсутність має **деградувати** білд, а не блокувати його.

## Відео: FlowKit

Форк `Bl0ck154/flowkit`. **Гілки `omni-flash` у репозиторії немає** - реальна назва `feature/omni-flash`, і вона ідентична `main` (той самий SHA `be2bc96`). Адаптер писався по цьому коду.

Python-агент (FastAPI, `agent/config.py`: `API_PORT=8100`, роутери під `/api` в `agent/main.py:125-135`):

| Метод | Ендпоінт | Джерело | Для чого |
|---|---|---|---|
| GET | `/health` | `agent/main.py:169` | живий агент + `extension_connected` |
| GET | `/api/flow/status` | `agent/api/flow.py:98` | `connected`, `flow_key_present` |
| POST | `/api/projects` | `agent/api/projects.py:132` | проєкт на боці Flow, `id` = Flow `projectId` |
| POST | `/api/flow/upload-image` | `agent/api/flow.py:344` | залити реальне фото → `{media_id}` |
| POST | `/api/flow/generate-video` | `agent/api/flow.py:132` | image-to-video зі стартового кадру |
| POST | `/api/flow/check-status` | `agent/api/flow.py:245` | polling |

Живий сценарій: `ensureProject` → `upload-image` (реальне фото) → `generate-video` (`start_image_media_id`, `model_family`, `duration_s`) → polling → завантаження підписаного URL у `outDir`.

**Дві форми polling** (обидві підтримані):

- **Veo** (`model_family=veo`, за замовчуванням): сабміт повертає `operations`; статус - масив, URL у `operation.metadata.video.fifeUrl` (`agent/sdk/services/operations.py:653`), успіх = `MEDIA_GENERATION_STATUS_SUCCESSFUL`.
- **Omni Flash** (`model_family=omni_flash`, тривалості 4/6/8/10 c): сабміт повертає `data.flowkitPolling.workflows` (`agent/services/omni_flash.py:193`); у `check-status` треба передавати `workflows`, а не `operations`; відповідь - `{done, status, workflows: [{done, status, media: {url, media_id}}]}` (`agent/services/omni_flash.py:520-546`).

`FlowkitError.reason`: `unavailable | extension_disconnected | http_error | job_failed | timeout | no_output | ffmpeg_missing | bad_input`. 503 від FastAPI ("Extension not connected") мапиться в `extension_disconnected`.

### Режими (`FLOWKIT_MODE`)

| Режим | Поведінка |
|---|---|
| `live` | лише FlowKit; міст лежить = `FlowkitError`. |
| `mock` | лише локальний ffmpeg Ken Burns по тому самому реальному фото. Без Chrome, без мережі, детерміновано. |
| `auto` (дефолт) | health-проба → живий FlowKit, інакше mock; якщо й ffmpeg нема - `null`, і викликач бере `fallbackHeroMedia()`. |

Ланцюг деградації: **FlowKit → ffmpeg Ken Burns mp4 → CSS/GSAP Ken Burns конфіг**. Останній рівень не потребує нічого зовнішнього, тому пайплайн проходить end-to-end на будь-якій машині. Mock-кліп - це теж синтезований рух, тому він так само `ai_generated`; а `fallbackHeroMedia()` нічого не синтезує (анімується реальне фото в браузері), тому не позначається.

`fallbackHeroMedia()` повертає `respectReducedMotion: true` - білдер зобов'язаний віддати статичний кадр під `prefers-reduced-motion` (спека §2.4).

## Env

| Змінна | Дефолт | Що це |
|---|---|---|
| `CODEX_BIN` | `codex` | Codex CLI (спільна з агентним шаром) |
| `GEN_IMAGE_TIMEOUT_SECONDS` | `300` | таймаут однієї генерації |
| `FLOWKIT_URL` | `http://localhost:8100` | REST python-агента; на сервері - мак Романа через Tailscale |
| `FLOWKIT_MODE` | `auto` | `auto \| live \| mock` |
| `FLOWKIT_PROJECT_ID` | *(порожньо)* | сталий Flow-проєкт; порожньо = створювати |
| `FLOWKIT_MODEL_FAMILY` | `veo` | `veo \| omni_flash` |
| `FLOWKIT_ASPECT_RATIO` | `VIDEO_ASPECT_RATIO_LANDSCAPE` | орієнтація |
| `FLOWKIT_DURATION_SECONDS` | `8` | Veo фіксовано 8; Omni 4/6/8/10 |
| `FLOWKIT_HEALTH_TIMEOUT_SECONDS` | `5` | health-проба |
| `FLOWKIT_REQUEST_TIMEOUT_SECONDS` | `120` | окремий HTTP-запит |
| `FLOWKIT_POLL_INTERVAL_SECONDS` | `10` | інтервал polling |
| `FLOWKIT_JOB_TIMEOUT_SECONDS` | `900` | увесь job |
| `FFMPEG_BIN` | `ffmpeg` | для mock/Ken Burns |

## Перевірка

```bash
pnpm tsx scripts/verify-media.ts              # реальна генерація зображення + відео в mock
pnpm tsx scripts/verify-media.ts --no-image   # без виклику Codex
pnpm tsx scripts/verify-media.ts --live       # спробувати ще й живий FlowKit
```

БД не потрібна: адаптери викликаються як чисті функції, вихід у `storage/media-verify/`.

## Схема БД

Міграція `drizzle/0002_media_ai_generated.sql` додає в `assets`:

- `ai_generated boolean NOT NULL DEFAULT false`
- `generator text` - `gen-image:gpt-image-2` | `flowkit:veo` | `flowkit:omni_flash` | `ken-burns`
- `generation_meta jsonb` - промпт, модель, вихідне фото, тривалість

---

## Чекліст Романа: увімкнути живий FlowKit

*(готовий до вставки в SETUP.md)*

Без цих кроків фабрика працює в `FLOWKIT_MODE=auto` і робить Ken Burns замість AI-відео. Нічого не падає - hero просто без згенерованого кліпу.

**На маку (де є Chrome і підписка Google AI):**

1. Клонувати форк і підняти агента:
   ```bash
   git clone -b feature/omni-flash https://github.com/Bl0ck154/flowkit.git
   cd flowkit && ./setup.sh
   source venv/bin/activate
   python -m agent.main          # REST :8100, WebSocket :9222
   ```
   `feature/omni-flash`, не `omni-flash` - гілки з такою назвою в репо немає.

2. Поставити розширення: `chrome://extensions` → Developer mode → **Load unpacked** → тека `extension/`.

3. Відкрити і **тримати відкритою** вкладку `labs.google/fx/tools/flow`, залогінену акаунтом із підпискою Google AI. Розширення звідти забирає bearer-токен; без живої вкладки міст не працює.

4. Перевірити:
   ```bash
   curl -s http://127.0.0.1:8100/health          # extension_connected: true
   curl -s http://127.0.0.1:8100/api/flow/status # connected: true, flow_key_present: true
   ```
   `extension_connected: false` = Chrome/вкладка не під'єднані; фабрика в `auto` тихо піде в Ken Burns.

5. Chrome має бути запущений увесь час, поки йдуть генерації. Мак не має засинати (`caffeinate -s` на час прогону).

**На сервері фабрики:**

6. Підняти Tailscale на обох машинах, взяти tailnet-IP мака.

7. У `.env` фабрики:
   ```bash
   FLOWKIT_URL=http://<tailscale-ip-мака>:8100
   FLOWKIT_MODE=auto        # live = вимагати міст (падати, якщо лежить)
   ```
   Порт :8100 назовні в інтернет **не** виставляти - лише в tailnet.

8. Перевірити з сервера: `pnpm tsx scripts/verify-media.ts --live`.

**Що знати наперед:** міст до Flow неофіційний і може ламатись при змінах на боці Google (спека §2.5). Тому `auto` - дефолт: фабрика не зупиняється, а деградує до Ken Burns по реальних фото.

## Чекліст Романа: gen-image

Зображення вже працюють локально (`codex` залогінений). На сервері:

1. `codex login` під акаунтом із підпискою ChatGPT (токен ляже в `$CODEX_HOME`).
2. Перевірити: `pnpm tsx scripts/verify-media.ts --no-image` (health) і повний прогін без прапорця.
3. Якщо в логах Codex зʼявляється PIL/matplotlib/SVG - у сесії немає доступу до `image_gen`; адаптер відхилить результат (`drawing_fallback`), фейкове зображення в assets не потрапить.
