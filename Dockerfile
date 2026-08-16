FROM node:22-bookworm

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

# Browsers for Playwright (discovery, audit, visual QA)
RUN npx playwright install --with-deps chromium

COPY . .

CMD ["pnpm", "all"]
