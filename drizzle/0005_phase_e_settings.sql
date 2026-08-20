-- Phase E (SPEC §4 stage 15): durable poller state.
-- The IMAP reply poller needs a cursor that survives restarts and does NOT
-- depend on \Seen flags (Roman reading the mailbox in Gmail would otherwise
-- make the factory skip replies). Key/value only — credentials stay in .env (§8).
CREATE TABLE IF NOT EXISTS "settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
