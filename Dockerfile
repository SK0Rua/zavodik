FROM node:22-bookworm

RUN corepack enable
WORKDIR /app

# Agent runtimes. Both authenticate by SUBSCRIPTION, never by API key (spec §2.3):
#   claude -> CLAUDE_CODE_OAUTH_TOKEN from .env (`claude setup-token` on the host once)
#   codex  -> ChatGPT login persisted in $CODEX_HOME (mount ~/.codex to use it)
RUN npm i -g @anthropic-ai/claude-code @openai/codex \
    && claude --version && codex --version

# pnpm-workspace.yaml is NOT optional here: it carries `onlyBuiltDependencies:
# [esbuild]`. pnpm 11 exits non-zero on ERR_PNPM_IGNORED_BUILDS, so without this
# file the install below fails even though every package resolved fine.
# (package.json's `pnpm` field is no longer read by pnpm 11.)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# No `|| pnpm install` fallback: that hid the real failure AND would silently
# build an image whose dependency tree does not match the committed lockfile.
RUN pnpm install --frozen-lockfile

# Browsers for Playwright (audit, visual QA, page capture, social discovery).
#
# The install runs as root but every worker runs as `node` (see the USER switch
# below), and Playwright's default cache is PER USER (`$HOME/.cache/ms-playwright`).
# Without an explicit shared path the browsers land in /root/.cache, where the
# node user cannot see them, and every Playwright job dies with "Executable
# doesn't exist at /home/node/.cache/...". A fixed, world-readable path is what
# makes one install serve both users.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium \
    && chmod -R a+rx /ms-playwright

# ffmpeg: Ken Burns hero-clip mock/fallback (src/media/video.ts) — without it hero falls back to a static photo
# tmux:   the builder agent runs INSIDE a tmux session so Roman can attach to the
#         real terminal of a running build (src/agents/tmuxRuntime.ts). Without
#         it `BUILDER_MODE=tmux` degrades to the headless SDK path and the
#         «Відкрити термінал» button never appears.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tmux \
    && rm -rf /var/lib/apt/lists/* \
    && tmux -V

# ttyd serves that tmux session over HTTP, so attaching happens in a browser
# rather than over SSH (src/agents/terminalServer.ts).
#
# Installed as a pinned static binary rather than with apt, because ttyd is in
# NO Debian stable suite — it exists only in sid, so `apt-get install ttyd` on
# bookworm fails and takes the whole image build with it. The upstream release
# is statically linked and needs no runtime deps.
#
# Both architectures are listed because the factory runs on x86 servers and on
# Roman's Apple Silicon mac. The checksum is verified: this binary is handed a
# terminal into a container, so a silently substituted download is not a risk
# worth carrying for the sake of a shorter Dockerfile.
ARG TTYD_VERSION=1.7.7
ARG TTYD_SHA256_X86_64=8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55
ARG TTYD_SHA256_AARCH64=b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165
RUN set -eux; \
    case "$(dpkg --print-architecture)" in \
      amd64)  arch=x86_64;  sha="$TTYD_SHA256_X86_64" ;; \
      arm64)  arch=aarch64; sha="$TTYD_SHA256_AARCH64" ;; \
      *) echo "no ttyd build for $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/ttyd \
      "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${arch}"; \
    echo "${sha}  /usr/local/bin/ttyd" | sha256sum -c -; \
    chmod +x /usr/local/bin/ttyd; \
    ttyd --version

# The builder agent works inside a copy of site-template/ and reads references/
# and .claude/skills/ (gen-image). All three must exist in the image — see
# .dockerignore for what is deliberately left out (node_modules, .env, sites/).
COPY . .

# skills/ is the source of truth; the agent runtime reads .claude/skills/.
RUN mkdir -p .claude/skills && cp -r skills/. .claude/skills/

# ── run as a NON-ROOT user ───────────────────────────────────────────────────
# This is a hard requirement, not hardening: the agent layer drives Claude Code
# with permissionMode 'bypassPermissions', which the CLI implements as
# `--dangerously-skip-permissions` — and that flag REFUSES to run as root:
#   "--dangerously-skip-permissions cannot be used with root/sudo privileges"
# As root every agent job therefore fails 3/3 attempts regardless of whether
# CLAUDE_CODE_OAUTH_TOKEN is set. `node` (uid 1000) ships with the base image.
#
# The mounted sites/ and deploys/ volumes must be writable by that uid; they are
# created here so the bind mounts inherit an owner instead of arriving as root.
RUN mkdir -p /app/sites /app/deploys /app/storage /home/node/.codex \
    && chown -R node:node /app /home/node

# Where the Codex CLI keeps its subscription auth; mount a volume to persist it.
ENV CODEX_HOME=/home/node/.codex

USER node

# Migrations are idempotent and must be applied before workers touch the DB:
# a fresh `docker compose up` on an empty volume otherwise starts against no
# schema at all. Both factory containers run this; whoever gets there first wins.
CMD ["sh", "-c", "pnpm db:migrate && pnpm all"]
