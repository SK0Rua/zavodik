import 'dotenv/config';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  databaseUrl: req('DATABASE_URL', 'postgres://factory:factory@localhost:5432/factory'),
  s3: {
    endpoint: req('S3_ENDPOINT', 'http://localhost:9000'),
    accessKey: req('S3_ACCESS_KEY', 'factory'),
    secretKey: req('S3_SECRET_KEY', 'factorysecret'),
    bucketRaw: req('S3_BUCKET_RAW', 'factory-raw'),
    bucketAssets: req('S3_BUCKET_ASSETS', 'factory-assets'),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.AGENT_MODEL ?? 'claude-sonnet-4-5',
    modelHeavy: process.env.AGENT_MODEL_HEAVY ?? 'claude-opus-4-5',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID ?? '',
  },
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
  imap: {
    host: process.env.IMAP_HOST ?? '',
    port: Number(process.env.IMAP_PORT ?? 993),
    user: process.env.IMAP_USER ?? '',
    pass: process.env.IMAP_PASS ?? '',
  },
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN ?? '',
    phoneId: process.env.WHATSAPP_PHONE_ID ?? '',
  },
  deploy: {
    mode: (process.env.DEPLOY_MODE ?? 'static') as 'static' | 'dokploy',
    demoBaseUrl: process.env.DEMO_BASE_URL ?? 'http://localhost:8788',
    dokployUrl: process.env.DOKPLOY_URL ?? '',
    dokployToken: process.env.DOKPLOY_TOKEN ?? '',
  },
  mode: (process.env.FACTORY_MODE ?? 'dry_run') as 'dry_run' | 'live',
  agentRuntime: (process.env.AGENT_RUNTIME ?? 'claude-code') as 'claude-code' | 'api',
  dashboardPort: Number(process.env.DASHBOARD_PORT ?? 8787),
  demoPort: Number(process.env.DEMO_PORT ?? 8788),
  maxQaIterations: Number(process.env.MAX_QA_ITERATIONS ?? 3),
  followupDays: (process.env.FOLLOWUP_SCHEDULE_DAYS ?? '3,7').split(',').map(Number),
  outreachDailyLimit: Number(process.env.OUTREACH_DAILY_LIMIT ?? 20),
};
