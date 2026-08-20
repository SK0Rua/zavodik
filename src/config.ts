/**
 * Effective configuration, resolved LAZILY on every read.
 *
 * Roman's decision (2026-08-17): operational settings live in Postgres and are
 * edited in the UI (`/settings`), taking effect without a restart or rebuild.
 * `.env` keeps only infrastructure — DATABASE_URL, S3_*, UI_PASSWORD /
 * UI_SESSION_SECRET, SETTINGS_MASTER_KEY, ports — i.e. what is needed to boot
 * and to decrypt.
 *
 * Mechanics: every operational field below is a GETTER over
 * `src/lib/settings.ts`, whose resolution order is DB → env → registry default.
 * So `config.telegram.botToken` returns the current value at the moment of the
 * call, and the same expression written at module scope would freeze it — do
 * not capture config values into module-level constants. (Grep enforced: the
 * only former capture, `src/workers/assets.ts`, was converted to a call-time read.)
 *
 * The DB snapshot is refreshed in the background with a 15s TTL by
 * `src/lib/settingsStore.ts#initSettings`, which every entrypoint calls at
 * start-up. If the DB is unreachable the last snapshot (or plain env) is used —
 * configuration never becomes a start-up dependency.
 *
 * Infra values keep using `req()` and are read once: changing DATABASE_URL at
 * runtime is meaningless, and S3 credentials are not operator-tunable.
 */
import 'dotenv/config';
import {
  getSetting, getSettingBool, getSettingEnum, getSettingNumber,
} from './lib/settings.js';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Agent kinds that can carry their own runtime override (AGENT_RUNTIME_BUILDER=codex, ...). */
type AgentRuntimeKind =
  | 'enrichment' | 'qa' | 'content' | 'design' | 'outreach' | 'builder' | 'visual-critique';

/**
 * Only subscription runtimes exist. Anything else (notably the removed `api`
 * runtime) falls back to the default instead of silently enabling API billing.
 */
function normalizeRuntime(value: string | undefined, fallback: 'claude-code' | 'codex'): 'claude-code' | 'codex' {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'claude-code' || v === 'codex') return v;
  if (v && v !== '') {
    console.warn(`[config] unknown AGENT_RUNTIME "${value}"; only claude-code|codex are supported (API billing is not). Using "${fallback}".`);
  }
  return fallback;
}

export const config = {
  // ── Infra (.env only) ─────────────────────────────────────────────────────
  databaseUrl: req('DATABASE_URL', 'postgres://factory:factory@localhost:5432/factory'),
  s3: {
    endpoint: req('S3_ENDPOINT', 'http://localhost:9000'),
    accessKey: req('S3_ACCESS_KEY', 'factory'),
    secretKey: req('S3_SECRET_KEY', 'factorysecret'),
    bucketRaw: req('S3_BUCKET_RAW', 'factory-raw'),
    bucketAssets: req('S3_BUCKET_ASSETS', 'factory-assets'),
  },
  // Agent layer — SUBSCRIPTION ONLY (spec §2.3, decision #10).
  // No ANTHROPIC_API_KEY anywhere: Claude Code runs on Roman's Pro/Max login
  // (`claude setup-token` -> pasted into the UI's settings page; locally the
  // CLI login is used), Codex runs on the ChatGPT subscription (`codex login`).
  agents: {
    /**
     * Read PER CALL by both runtimes, so pasting a token in the UI is picked up
     * by an already-running worker within the settings TTL — no restart.
     * Empty locally (the CLI's own login is used).
     */
    get oauthToken(): string { return getSetting('CLAUDE_CODE_OAUTH_TOKEN'); },
    get model(): string { return getSetting('AGENT_MODEL'); },
    get modelHeavy(): string { return getSetting('AGENT_MODEL_HEAVY'); },
    /** CLI binaries stay in env: they are properties of the image, not of the operator. */
    get codexBin(): string { return process.env.CODEX_BIN ?? 'codex'; },
    /** Empty = let the Codex CLI pick its configured default. */
    get codexModel(): string { return process.env.CODEX_MODEL ?? ''; },
    get codexModelHeavy(): string { return process.env.CODEX_MODEL_HEAVY ?? process.env.CODEX_MODEL ?? ''; },
    /** Concurrent agent calls; subscription windows are shared, so keep it low. */
    get concurrency(): number { return getSettingNumber('AGENT_CONCURRENCY', 1); },
    /**
     * Per-group caps used when a worker process hosts exactly one agent-heavy
     * group (`pnpm workers --only=build` / `--only=enrich`). The semaphore is
     * per-process, so splitting groups across processes is what stops a 40-minute
     * site build and a large enrichment backlog from starving each other.
     */
    get concurrencyBuild(): number {
      return getSettingNumber('AGENT_CONCURRENCY_BUILD', getSettingNumber('AGENT_CONCURRENCY', 1));
    },
    get concurrencyEnrich(): number {
      return getSettingNumber('AGENT_CONCURRENCY_ENRICH', getSettingNumber('AGENT_CONCURRENCY', 1));
    },
    /** Wait applied when the subscription window is exhausted and no reset time is known. */
    get rateLimitDefaultWaitMs(): number {
      return Number(process.env.AGENT_RATE_LIMIT_WAIT_MINUTES ?? 15) * 60_000;
    },
    /** Cap on a reset-time-derived wait (weekly caps would otherwise park a job for days). */
    get rateLimitMaxWaitMs(): number {
      return Number(process.env.AGENT_RATE_LIMIT_MAX_WAIT_MINUTES ?? 6 * 60) * 60_000;
    },
    /** Global runtime; `AGENT_RUNTIME_<KIND>` overrides it per agent kind. */
    get runtime(): 'claude-code' | 'codex' {
      return normalizeRuntime(getSetting('AGENT_RUNTIME'), 'claude-code');
    },
    runtimeFor(kind?: AgentRuntimeKind): 'claude-code' | 'codex' {
      const override = kind ? process.env[`AGENT_RUNTIME_${kind.toUpperCase().replace(/-/g, '_')}`] : undefined;
      return normalizeRuntime(override, this.runtime);
    },
  },
  // gosom/google-maps-scraper REST API — the single discovery source (spec §3).
  gosom: {
    // inside compose: http://gosom:8080; on the host (pnpm dev): 127.0.0.1:8085
    // Stays in env: it is a compose topology fact, not an operator setting.
    get url(): string { return (process.env.GOSOM_URL ?? 'http://127.0.0.1:8085').replace(/\/+$/, ''); },
    // scroll depth per keyword (gosom default 10); more depth = more results, slower
    get depth(): number { return getSettingNumber('GOSOM_DEPTH', 10); },
    get zoom(): number { return getSettingNumber('GOSOM_ZOOM', 15); },
    get radiusMeters(): number { return getSettingNumber('GOSOM_RADIUS', 10000); },
    // gosom rejects max_time <= 3m; it is the scrape's own budget, in seconds
    get maxTimeSeconds(): number { return getSettingNumber('GOSOM_MAX_TIME_SECONDS', 900); },
    // how long we wait for the job to leave pending/working before giving up
    get jobTimeoutSeconds(): number { return getSettingNumber('GOSOM_JOB_TIMEOUT_SECONDS', 1800); },
    get pollIntervalSeconds(): number { return getSettingNumber('GOSOM_POLL_INTERVAL_SECONDS', 10); },
    get requestTimeoutSeconds(): number { return getSettingNumber('GOSOM_REQUEST_TIMEOUT_SECONDS', 60); },
    // email extraction on from the first campaign (Roman's decision #7)
    get email(): boolean { return getSettingBool('GOSOM_EMAIL_EXTRACTION', true); },
    // proxies not needed yet, support wired in (decision #3): comma/newline separated
    get proxies(): string[] {
      return getSetting('GOSOM_PROXIES').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    },
  },
  // Media generation (SPEC §2.5, decisions #12/#13) — subscriptions only.
  media: {
    /** Codex CLI binary for the gen-image flow (ChatGPT subscription, `codex login`). */
    get codexBin(): string { return process.env.CODEX_BIN ?? 'codex'; },
    get imageTimeoutMs(): number { return Number(process.env.GEN_IMAGE_TIMEOUT_SECONDS ?? 300) * 1000; },
    flowkit: {
      /** Python agent REST base. On the server this is Roman's mac over Tailscale. */
      get url(): string { return getSetting('FLOWKIT_URL').replace(/\/+$/, ''); },
      /**
       * live = require the Chrome bridge; mock = deterministic local Ken Burns mp4
       * (no Chrome, no network); auto = live when healthy, else fall back.
       */
      get mode(): 'auto' | 'live' | 'mock' {
        return getSettingEnum('FLOWKIT_MODE', ['auto', 'live', 'mock'] as const, 'auto');
      },
      /** Flow project reused for factory clips; empty = create one per call. */
      get projectId(): string { return process.env.FLOWKIT_PROJECT_ID ?? ''; },
      /** veo (default) or omni_flash — omni supports 4/6/8/10s durations. */
      get modelFamily(): 'veo' | 'omni_flash' {
        return (process.env.FLOWKIT_MODEL_FAMILY ?? 'veo') as 'veo' | 'omni_flash';
      },
      get aspectRatio(): string { return process.env.FLOWKIT_ASPECT_RATIO ?? 'VIDEO_ASPECT_RATIO_LANDSCAPE'; },
      get durationSeconds(): number { return Number(process.env.FLOWKIT_DURATION_SECONDS ?? 8); },
      get healthTimeoutMs(): number { return Number(process.env.FLOWKIT_HEALTH_TIMEOUT_SECONDS ?? 5) * 1000; },
      get requestTimeoutMs(): number { return Number(process.env.FLOWKIT_REQUEST_TIMEOUT_SECONDS ?? 120) * 1000; },
      get pollIntervalMs(): number { return Number(process.env.FLOWKIT_POLL_INTERVAL_SECONDS ?? 10) * 1000; },
      get jobTimeoutMs(): number { return Number(process.env.FLOWKIT_JOB_TIMEOUT_SECONDS ?? 900) * 1000; },
    },
    /** ffmpeg is only needed for the mock/Ken Burns path; absence degrades, never crashes. */
    get ffmpegBin(): string { return process.env.FFMPEG_BIN ?? 'ffmpeg'; },
    /**
     * Generate one decorative background per demo (phase C build prep).
     * Purely optional: a failure degrades the build, never blocks it. Turn off
     * to keep builds fully offline / faster.
     */
    get generateImages(): boolean { return getSettingBool('MEDIA_GEN_IMAGES', true); },
  },
  /**
   * Social discovery (SPEC §4 stage 4): keyless web search for a business's
   * Instagram/Facebook/TikTok profile when the listing did not publish one.
   * Roman's observation on the real Patras run: "exte hair design" has both a
   * Facebook page and an Instagram profile and the factory found neither,
   * because socials only ever came from the maps `website` field. In Patras the
   * messenger channel IS Instagram (decision #8), so this is an outreach gap.
   */
  socialDiscovery: {
    get enabled(): boolean { return getSettingBool('SOCIAL_DISCOVERY', true); },
    /** Profile pages actually opened and scored per business (each costs ~5s). */
    get maxCandidates(): number { return getSettingNumber('SOCIAL_DISCOVERY_MAX_CANDIDATES', 6); },
    /** Politeness pause between SERP/profile requests; too fast gets 429s. */
    get delayMs(): number { return getSettingNumber('SOCIAL_DISCOVERY_DELAY_MS', 2500); },
    get timeoutMs(): number { return Number(process.env.SOCIAL_DISCOVERY_TIMEOUT_SECONDS ?? 30) * 1000; },
  },
  telegram: {
    get botToken(): string { return getSetting('TELEGRAM_BOT_TOKEN'); },
    get chatId(): string { return getSetting('TELEGRAM_CHAT_ID'); },
  },
  // Control UI (SPEC §2.2, decision #9). Telegram only links here.
  ui: {
    /** Public base of the Next.js UI; every Telegram notification links into it. */
    get baseUrl(): string { return getSetting('UI_BASE_URL').replace(/\/+$/, ''); },
    /**
     * Single shared password (§8: the UI is never exposed without auth) and the
     * cookie-signing secret. Both stay in `.env`: they gate access to the very
     * page where every other setting is edited, so storing them behind that
     * page would be circular.
     */
    get password(): string { return process.env.UI_PASSWORD ?? ''; },
    get sessionSecret(): string { return process.env.UI_SESSION_SECRET ?? process.env.UI_PASSWORD ?? ''; },
    /** Shared secret the UI uses to call the factory's /internal/* endpoints. */
    get internalApiKey(): string {
      return process.env.INTERNAL_API_KEY ?? process.env.UI_SESSION_SECRET ?? process.env.UI_PASSWORD ?? '';
    },
  },
  // Email channel (decision #1): Roman's Gmail over SMTP app password + IMAP.
  smtp: {
    get host(): string { return getSetting('SMTP_HOST'); },
    get port(): number { return getSettingNumber('SMTP_PORT', 587); },
    /** 465 = implicit TLS; 587 = STARTTLS. Derived so a wrong combo can't hang. */
    get secure(): boolean {
      const explicit = getSetting('SMTP_SECURE');
      return explicit !== '' ? explicit === 'true' : getSettingNumber('SMTP_PORT', 587) === 465;
    },
    get user(): string { return getSetting('SMTP_USER'); },
    get pass(): string { return getSetting('SMTP_PASS'); },
    get from(): string { return getSetting('SMTP_FROM'); },
    /** Domain used in our own Message-ID; must be stable for IMAP reply matching. */
    get messageIdDomain(): string { return getSetting('SMTP_MESSAGE_ID_DOMAIN'); },
    /** Address put in List-Unsubscribe (mailto:). Empty = fall back to the From address. */
    get unsubscribeTo(): string { return getSetting('SMTP_UNSUBSCRIBE_TO'); },
    /** Dev only: local GreenMail speaks plain SMTP with a self-signed cert. */
    get rejectUnauthorized(): boolean { return getSettingBool('SMTP_TLS_REJECT_UNAUTHORIZED', true); },
  },
  imap: {
    get host(): string { return getSetting('IMAP_HOST'); },
    get port(): number { return getSettingNumber('IMAP_PORT', 993); },
    /** Gmail: 993 + TLS. GreenMail dev: 3143 plaintext. */
    get secure(): boolean {
      const explicit = getSetting('IMAP_SECURE');
      return explicit !== '' ? explicit === 'true' : getSettingNumber('IMAP_PORT', 993) === 993;
    },
    get user(): string { return getSetting('IMAP_USER'); },
    get pass(): string { return getSetting('IMAP_PASS'); },
    get mailbox(): string { return getSetting('IMAP_MAILBOX'); },
    get rejectUnauthorized(): boolean { return getSettingBool('IMAP_TLS_REJECT_UNAUTHORIZED', true); },
    /** Safety cap on how many messages one poll processes. */
    get maxPerPoll(): number { return getSettingNumber('IMAP_MAX_PER_POLL', 50); },
  },
  /**
   * WhatsApp via WAHA (decision #2) — self-hosted HTTP API, NOT the Meta Cloud API.
   * Roman scans a QR once with the dedicated outreach number; WAHA keeps the
   * session and POSTs inbound messages to /webhooks/waha.
   */
  waha: {
    /** Inside compose: http://waha:3000. On the host (pnpm dev): 127.0.0.1:3001. */
    get url(): string { return getSetting('WAHA_URL').replace(/\/+$/, ''); },
    /** Sent verbatim in the X-Api-Key header (WAHA may store it hashed as sha512:...). */
    get apiKey(): string { return getSetting('WAHA_API_KEY'); },
    get session(): string { return getSetting('WAHA_SESSION'); },
    /** Shared secret WAHA uses to HMAC-SHA512 the raw webhook body. */
    get hookHmacKey(): string { return getSetting('WAHA_HOOK_HMAC_KEY'); },
    get requestTimeoutMs(): number { return Number(process.env.WAHA_REQUEST_TIMEOUT_SECONDS ?? 30) * 1000; },
    /** Verify the number is on WhatsApp before sending (skippable if it misbehaves). */
    get checkExists(): boolean { return getSettingBool('WAHA_CHECK_EXISTS', true); },
  },
  deploy: {
    get mode(): 'static' | 'dokploy' { return (process.env.DEPLOY_MODE ?? 'static') as 'static' | 'dokploy'; },
    get demoBaseUrl(): string { return getSetting('DEMO_BASE_URL'); },
    get dokployUrl(): string { return process.env.DOKPLOY_URL ?? ''; },
    get dokployToken(): string { return process.env.DOKPLOY_TOKEN ?? ''; },
  },
  // Site build stage (SPEC §4 stages 10-12, phase C).
  build: {
    /**
     * Turn cap for one builder agent session. Budget per demo is unlimited
     * (decision #5), but an agent that has not converged in this many turns is
     * looping, not working — better to surface it than burn the subscription window.
     */
    get maxTurns(): number { return Number(process.env.BUILDER_MAX_TURNS ?? 200); },
    /** Turn cap for a QA fix iteration: a scoped fix needs far fewer turns. */
    get fixMaxTurns(): number { return Number(process.env.BUILDER_FIX_MAX_TURNS ?? 120); },
    /** Wall-clock cap for one builder session; pnpm install + build is slow. */
    get timeoutMs(): number { return Number(process.env.BUILDER_TIMEOUT_MINUTES ?? 90) * 60_000; },
    /** Independent `pnpm build` verification by code after the agent claims success. */
    get verifyTimeoutMs(): number { return Number(process.env.BUILD_VERIFY_TIMEOUT_MINUTES ?? 20) * 60_000; },
    /**
     * After a terminal state, delete node_modules/.next/out/references from the
     * workspace (~735MB -> a few MB). Sources and inputs are kept, so `pnpm
     * install` restores a rebuildable workspace.
     */
    get workspaceGc(): boolean { return getSettingBool('WORKSPACE_GC', true); },
    /** Critic issues at or above this severity are fed back to the builder. */
    get qaFeedbackSeverity(): 'low' | 'medium' | 'high' {
      return (process.env.QA_FEEDBACK_SEVERITY ?? 'medium') as 'low' | 'medium' | 'high';
    },
  },
  /** dry_run simulates every send; live actually contacts businesses. UI-switchable. */
  get mode(): 'dry_run' | 'live' {
    return getSettingEnum('FACTORY_MODE', ['dry_run', 'live'] as const, 'dry_run');
  },
  get dashboardPort(): number { return Number(process.env.DASHBOARD_PORT ?? 8787); },
  get demoPort(): number { return Number(process.env.DEMO_PORT ?? 8788); },
  get maxQaIterations(): number { return Number(process.env.MAX_QA_ITERATIONS ?? 3); },
  get followupDays(): number[] {
    return getSetting('FOLLOWUP_SCHEDULE_DAYS').split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
  },
  get outreachDailyLimit(): number { return getSettingNumber('OUTREACH_DAILY_LIMIT', 20); },
  // Pipeline stages 4-8 (SPEC §4). Evidence thresholds live here so they can be
  // tuned per niche without touching worker logic.
  pipeline: {
    /**
     * Share of a model-extracted claim's content words that must actually occur
     * in the source it cites, or the claim is dropped instead of stored
     * (`src/enrichment/grounding.ts`). Lower = more permissive paraphrase,
     * higher = stricter. 0.5 was chosen against the real Patras run.
     */
    get groundingThreshold(): number { return Number(process.env.GROUNDING_THRESHOLD ?? 0.5); },
    /** Reviews mined from the discovery evidence and offered to the agent. */
    get maxReviewsInPrompt(): number { return Number(process.env.MAX_REVIEWS_IN_PROMPT ?? 10); },
    /** Images downloaded per business in stage 5. */
    get maxAssetDownloads(): number { return Number(process.env.MAX_ASSET_DOWNLOADS ?? 30); },
    /** Readiness gates (SPEC §4 stage 8). */
    readiness: {
      get minServices(): number { return Number(process.env.READINESS_MIN_SERVICES ?? 3); },
      get minAssets(): number { return Number(process.env.READINESS_MIN_ASSETS ?? 3); },
      get minReviews(): number { return Number(process.env.READINESS_MIN_REVIEWS ?? 1); },
      /** Smallest edge (px) for an image to count as a hero/gallery asset. */
      get heroMinEdge(): number { return Number(process.env.READINESS_HERO_MIN_EDGE ?? 640); },
    },
  },
};
