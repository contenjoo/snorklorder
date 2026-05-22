CREATE TABLE IF NOT EXISTS "email_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "to_email" text NOT NULL,
  "subject" text NOT NULL,
  "kind" text NOT NULL,
  "status" text NOT NULL,
  "error_message" text,
  "related_type" text,
  "related_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "email_logs_created_at_idx" ON "email_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "email_logs_status_idx" ON "email_logs" ("status");
CREATE INDEX IF NOT EXISTS "email_logs_kind_idx" ON "email_logs" ("kind");
