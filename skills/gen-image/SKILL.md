---
name: gen-image
description: Згенерувати зображення через Codex CLI (gpt-image-2) по підписці ChatGPT, не через API. Використовуй коли користувач просить згенерувати/створити/намалювати зображення, картинку, ілюстрацію, фото — "generate image", "згенеруй картинку", "створи зображення", "намалюй". Підтримує референс-фото через --ref.
allowed-tools: Bash(codex:*), Bash(echo:*), Bash(ls:*), Bash(cp:*), Bash(mv:*), Bash(realpath:*)
---

# Generate Image via Codex CLI

Користувач просить згенерувати зображення. Використай **Codex CLI** (підписка ChatGPT), а НЕ Anthropic image API.

**Запит користувача:** $ARGUMENTS

## Кроки

1. **Розпарси запит:**
   - Все що до `--ref` (або весь рядок, якщо `--ref` немає) → це `PROMPT`
   - Значення після `--ref` → це шлях до референс-фото (опціонально)
   - Якщо скіл викликано без аргументів — візьми опис зображення з контексту розмови

2. **Сформуй фінальний промпт із обовʼязковим жорстким префіксом** (інакше Codex почне малювати через Python/PIL/SVG):

   ```
   HARD CONSTRAINT: Use ONLY image_gen/gpt-image-2.
   NO Python, PIL, matplotlib, SVG, ASCII art, or any code-based drawing.
   If image_gen tool is unavailable — FAIL explicitly with an error message.

   TASK: <PROMPT тут>
   ```

3. **Запусти команду** (з `--image` тільки якщо був `--ref`):

   ```bash
   echo "<повний промпт>" | codex exec \
     --sandbox workspace-write \
     --skip-git-repo-check \
     [--image <REF_PATH>]
   ```

   > `--full-auto` більше НЕ існує в Codex CLI (перевірено на 0.147.0:
   > `error: unexpected argument '--full-auto' found`). Достатньо
   > `--sandbox workspace-write`.

4. **Знайди результат:**
   - Codex кладе файли не в корінь, а в підтеку сесії:
     `~/.codex/generated_images/<session-uuid>/exec-<id>.png`
   - Тому шукай рекурсивно, напр.
     `find ~/.codex/generated_images -type f -name '*.png' -exec stat -f '%m %N' {} \; | sort -rn | head -1`
   - Виведи користувачу абсолютний шлях

5. **Якщо в логах Codex зʼявилось щось типу `python`, `PIL`, `matplotlib`, `<svg`** — це означає що `image_gen` недоступний у цій сесії Codex. НЕ обходь, НЕ генеруй фейковий результат — повідом користувачу що треба перевірити доступ до tool в Codex.

## Приклади використання

- `/gen-image кіт-самурай у стилі студії Ghibli, золота година`
- `/gen-image портрет у стилі ренесанс --ref ./photos/me.jpg`
