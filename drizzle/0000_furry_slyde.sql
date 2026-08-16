CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"kind" text DEFAULT 'outreach' NOT NULL,
	"decision" text,
	"decided_by" text,
	"decided_at" timestamp,
	"telegram_message_id" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"object_key" text NOT NULL,
	"hash" text NOT NULL,
	"source_url" text NOT NULL,
	"source_type" text NOT NULL,
	"content_type" text,
	"width" integer,
	"height" integer,
	"intended_usage" text DEFAULT 'demo' NOT NULL,
	"rights" text DEFAULT 'private_demo_only' NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"channel" text NOT NULL,
	"value" text NOT NULL,
	"source_id" integer,
	"verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"source_id" integer,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"extraction_method" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"source_type" text NOT NULL,
	"url" text NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"raw_object_key" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" text,
	"address" text,
	"lat" real,
	"lng" real,
	"phone" text,
	"normalized_phone" text,
	"website_url" text,
	"domain" text,
	"place_id" text,
	"listing_url" text,
	"rating" real,
	"review_count" integer,
	"business_status" text,
	"status" text DEFAULT 'discovered' NOT NULL,
	"status_reason" text,
	"score" real,
	"score_breakdown" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"country" text NOT NULL,
	"city" text NOT NULL,
	"niche" text NOT NULL,
	"language" text DEFAULT 'el' NOT NULL,
	"queries" jsonb NOT NULL,
	"geofence" jsonb NOT NULL,
	"target_count" integer DEFAULT 50 NOT NULL,
	"mode" text DEFAULT 'dry_run' NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"state" text DEFAULT 'contacted' NOT NULL,
	"value" real,
	"recurring" real,
	"lost_reason" text,
	"next_action" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "deals_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "do_not_contact" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_type" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"message_id" integer,
	"event" text NOT NULL,
	"detail" jsonb,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"channel" text NOT NULL,
	"to_address" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_message_id" text,
	"kind" text DEFAULT 'initial' NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "production_gaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"gap" text NOT NULL,
	"blocker_level" text DEFAULT 'hard' NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"stage" text NOT NULL,
	"qualified" boolean NOT NULL,
	"reasons" jsonb NOT NULL,
	"score" real,
	"score_breakdown" jsonb,
	"qa_passed" boolean,
	"qa_notes" text,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"dir" text NOT NULL,
	"content_brief_key" text,
	"design_contract_key" text,
	"design_direction" text,
	"build_ok" boolean,
	"qa_iterations" integer DEFAULT 0 NOT NULL,
	"qa_report_key" text,
	"screenshot_keys" jsonb,
	"deploy_url" text,
	"deployed_at" timestamp,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"actor" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "website_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"endpoint_matrix" jsonb,
	"best_endpoint" text,
	"verdict" text NOT NULL,
	"desktop_screenshot_key" text,
	"mobile_screenshot_key" text,
	"meaningful_content" boolean,
	"notes" text,
	"audited_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"boss_job_id" text,
	"job_type" text NOT NULL,
	"business_id" text,
	"campaign_id" text,
	"idempotency_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_detail" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_contacts" ADD CONSTRAINT "business_contacts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_contacts" ADD CONSTRAINT "business_contacts_source_id_business_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."business_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_facts" ADD CONSTRAINT "business_facts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_facts" ADD CONSTRAINT "business_facts_source_id_business_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."business_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_sources" ADD CONSTRAINT "business_sources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_message_id_outreach_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."outreach_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_gaps" ADD CONSTRAINT "production_gaps_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_projects" ADD CONSTRAINT "site_projects_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_audits" ADD CONSTRAINT "website_audits_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_biz_idx" ON "assets" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_hash_idx" ON "assets" USING btree ("business_id","hash");--> statement-breakpoint
CREATE INDEX "contact_biz_idx" ON "business_contacts" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "fact_biz_idx" ON "business_facts" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "fact_key_idx" ON "business_facts" USING btree ("business_id","key");--> statement-breakpoint
CREATE INDEX "src_biz_idx" ON "business_sources" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "biz_campaign_idx" ON "businesses" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "biz_status_idx" ON "businesses" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "biz_place_idx" ON "businesses" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dnc_idx" ON "do_not_contact" USING btree ("match_type","value");--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_idem_idx" ON "outreach_messages" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "outreach_biz_idx" ON "outreach_messages" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "audit_biz_idx" ON "website_audits" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "job_biz_idx" ON "workflow_jobs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "job_status_idx" ON "workflow_jobs" USING btree ("status");