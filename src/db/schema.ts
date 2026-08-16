import {
  pgTable, text, integer, real, boolean, timestamp, jsonb, serial, uniqueIndex, index,
} from 'drizzle-orm/pg-core';

// ─── Campaigns ────────────────────────────────────────────────────────────────

export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey(), // e.g. gr-patras-beauty-2026-08
  country: text('country').notNull(),
  city: text('city').notNull(),
  niche: text('niche').notNull(),
  language: text('language').notNull().default('el'),
  queries: jsonb('queries').$type<string[]>().notNull(),
  geofence: jsonb('geofence').$type<{ lat: number; lng: number; radiusKm: number }>().notNull(),
  targetCount: integer('target_count').notNull().default(50),
  mode: text('mode').notNull().default('dry_run'), // dry_run | live
  status: text('status').notNull().default('created'), // created | running | paused | done
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── Businesses (stable identity) ────────────────────────────────────────────

export const businesses = pgTable('businesses', {
  id: text('id').primaryKey(), // <country>-<city>-<slug>
  campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  category: text('category'),
  address: text('address'),
  lat: real('lat'),
  lng: real('lng'),
  phone: text('phone'),
  normalizedPhone: text('normalized_phone'),
  websiteUrl: text('website_url'),
  domain: text('domain'),
  placeId: text('place_id'),
  listingUrl: text('listing_url'),
  rating: real('rating'),
  reviewCount: integer('review_count'),
  businessStatus: text('business_status'),
  status: text('status').notNull().default('discovered'),
  statusReason: text('status_reason'),
  score: real('score'),
  scoreBreakdown: jsonb('score_breakdown').$type<Record<string, number>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('biz_campaign_idx').on(t.campaignId),
  index('biz_status_idx').on(t.status),
  uniqueIndex('biz_place_idx').on(t.placeId),
]);

export const statusHistory = pgTable('status_history', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  reason: text('reason'),
  actor: text('actor').notNull(), // worker name | 'roman' | 'system'
  at: timestamp('at').notNull().defaultNow(),
});

// ─── Evidence: sources, facts, contacts, assets ───────────────────────────────

export const businessSources = pgTable('business_sources', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  sourceType: text('source_type').notNull(), // google_maps | owned_website | facebook | instagram | search | directory
  url: text('url').notNull(),
  capturedAt: timestamp('captured_at').notNull().defaultNow(),
  method: text('method').notNull(), // playwright | http | agent
  rawObjectKey: text('raw_object_key'), // immutable raw snapshot in S3
  version: integer('version').notNull().default(1),
}, (t) => [index('src_biz_idx').on(t.businessId)]);

export const businessFacts = pgTable('business_facts', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  key: text('key').notNull(), // identity.description | services[] | hours | price.x ...
  value: jsonb('value'),
  sourceId: integer('source_id').references(() => businessSources.id),
  confidence: real('confidence').notNull().default(0.5),
  extractionMethod: text('extraction_method').notNull(), // deterministic | llm_structured
  verified: boolean('verified').notNull().default(false),
  capturedAt: timestamp('captured_at').notNull().defaultNow(),
}, (t) => [index('fact_biz_idx').on(t.businessId), index('fact_key_idx').on(t.businessId, t.key)]);

export const businessContacts = pgTable('business_contacts', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  channel: text('channel').notNull(), // email | phone | whatsapp | instagram | facebook | contact_form
  value: text('value').notNull(),
  sourceId: integer('source_id').references(() => businessSources.id),
  verified: boolean('verified').notNull().default(false),
}, (t) => [index('contact_biz_idx').on(t.businessId)]);

export const assets = pgTable('assets', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  objectKey: text('object_key').notNull(),
  hash: text('hash').notNull(),
  sourceUrl: text('source_url').notNull(),
  sourceType: text('source_type').notNull(),
  contentType: text('content_type'),
  width: integer('width'),
  height: integer('height'),
  intendedUsage: text('intended_usage').notNull().default('demo'), // hero | logo | gallery | menu | demo
  rights: text('rights').notNull().default('private_demo_only'),
  capturedAt: timestamp('captured_at').notNull().defaultNow(),
}, (t) => [index('asset_biz_idx').on(t.businessId), uniqueIndex('asset_hash_idx').on(t.businessId, t.hash)]);

// ─── Audits, qualification, gaps ─────────────────────────────────────────────

export const websiteAudits = pgTable('website_audits', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  endpointMatrix: jsonb('endpoint_matrix').$type<Array<{
    url: string; status: number | null; finalUrl: string | null; tlsOk: boolean | null; error: string | null;
  }>>(),
  bestEndpoint: text('best_endpoint'),
  verdict: text('verdict').notNull(), // none | unreachable_all_endpoints | working_with_https_issue | working_but_dated | acceptable | strong_modern
  desktopScreenshotKey: text('desktop_screenshot_key'),
  mobileScreenshotKey: text('mobile_screenshot_key'),
  meaningfulContent: boolean('meaningful_content'),
  notes: text('notes'),
  auditedAt: timestamp('audited_at').notNull().defaultNow(),
}, (t) => [index('audit_biz_idx').on(t.businessId)]);

export const qualifications = pgTable('qualifications', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  stage: text('stage').notNull(), // fast | full
  qualified: boolean('qualified').notNull(),
  reasons: jsonb('reasons').$type<string[]>().notNull(),
  score: real('score'),
  scoreBreakdown: jsonb('score_breakdown').$type<Record<string, number>>(),
  qaPassed: boolean('qa_passed'),
  qaNotes: text('qa_notes'),
  at: timestamp('at').notNull().defaultNow(),
});

export const productionGaps = pgTable('production_gaps', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  gap: text('gap').notNull(), // verified_contact | services_min3 | assets_min3 | hero_or_logo | review_context | identity
  blockerLevel: text('blocker_level').notNull().default('hard'), // hard | soft
  resolved: boolean('resolved').notNull().default(false),
  at: timestamp('at').notNull().defaultNow(),
});

// ─── Sites ────────────────────────────────────────────────────────────────────

export const siteProjects = pgTable('site_projects', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  dir: text('dir').notNull(),
  contentBriefKey: text('content_brief_key'),
  designContractKey: text('design_contract_key'),
  designDirection: text('design_direction'),
  buildOk: boolean('build_ok'),
  qaIterations: integer('qa_iterations').notNull().default(0),
  qaReportKey: text('qa_report_key'),
  screenshotKeys: jsonb('screenshot_keys').$type<string[]>(),
  deployUrl: text('deploy_url'),
  deployedAt: timestamp('deployed_at'),
  state: text('state').notNull().default('pending'), // pending | brief | building | qa | needs_human_review | ready | deployed
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ─── Approvals, outreach, deals ──────────────────────────────────────────────

export const approvals = pgTable('approvals', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  kind: text('kind').notNull().default('outreach'),
  decision: text('decision'), // approved | rejected | needs_changes
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at'),
  telegramMessageId: text('telegram_message_id'),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const outreachMessages = pgTable('outreach_messages', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  channel: text('channel').notNull(), // email | whatsapp | instagram_manual
  toAddress: text('to_address').notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  providerMessageId: text('provider_message_id'),
  kind: text('kind').notNull().default('initial'), // initial | followup_1 | followup_2
  state: text('state').notNull().default('queued'), // queued | sent | delivered | failed | simulated | manual_pending
  sentAt: timestamp('sent_at'),
}, (t) => [uniqueIndex('outreach_idem_idx').on(t.idempotencyKey), index('outreach_biz_idx').on(t.businessId)]);

export const outreachEvents = pgTable('outreach_events', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id),
  messageId: integer('message_id').references(() => outreachMessages.id),
  event: text('event').notNull(), // sent | delivered | bounced | replied | opted_out
  detail: jsonb('detail'),
  at: timestamp('at').notNull().defaultNow(),
});

export const deals = pgTable('deals', {
  id: serial('id').primaryKey(),
  businessId: text('business_id').notNull().references(() => businesses.id).unique(),
  state: text('state').notNull().default('contacted'), // contacted | replied | meeting | proposal | won | lost
  value: real('value'),
  recurring: real('recurring'),
  lostReason: text('lost_reason'),
  nextAction: text('next_action'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const doNotContact = pgTable('do_not_contact', {
  id: serial('id').primaryKey(),
  matchType: text('match_type').notNull(), // email | phone | domain | business_id
  value: text('value').notNull(),
  reason: text('reason'),
  at: timestamp('at').notNull().defaultNow(),
}, (t) => [uniqueIndex('dnc_idx').on(t.matchType, t.value)]);

// ─── Jobs (mirror of pg-boss for reporting; pg-boss keeps its own schema) ────

export const workflowJobs = pgTable('workflow_jobs', {
  id: serial('id').primaryKey(),
  bossJobId: text('boss_job_id'),
  jobType: text('job_type').notNull(),
  businessId: text('business_id'),
  campaignId: text('campaign_id'),
  idempotencyKey: text('idempotency_key'),
  status: text('status').notNull().default('queued'), // queued | running | succeeded | failed | needs_human | cancelled
  attempts: integer('attempts').notNull().default(0),
  errorCode: text('error_code'),
  errorDetail: text('error_detail'),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('job_biz_idx').on(t.businessId), index('job_status_idx').on(t.status)]);
