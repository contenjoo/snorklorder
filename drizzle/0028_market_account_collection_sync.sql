-- Account collection submission is immutable and commits with every account request update.
-- No existing account, invoice, payment or email state is backfilled or changed.
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "market_collection_id" text;
CREATE INDEX IF NOT EXISTS "account_requests_market_collection_id_idx" ON "account_requests" ("market_collection_id");
CREATE TABLE IF NOT EXISTS "market_account_collection_sync" (
  "collection_id" text PRIMARY KEY,
  "submission_hash" text NOT NULL,
  "payload_hash" text NOT NULL,
  "source_kind" text NOT NULL,
  "market_order_id" text,
  "order_number" text,
  "request_ids" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "market_account_collection_sync_hash_check" CHECK (
    "submission_hash" ~ '^[a-f0-9]{64}$' AND "payload_hash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "market_account_collection_sync_source_check" CHECK (
    ("source_kind" = 'order' AND "market_order_id" IS NOT NULL AND "order_number" IS NOT NULL)
    OR ("source_kind" = 'external' AND "market_order_id" IS NULL AND "order_number" IS NULL)
  ),
  CONSTRAINT "market_account_collection_sync_requests_check" CHECK (
    jsonb_typeof("request_ids") = 'array' AND jsonb_array_length("request_ids") BETWEEN 1 AND 30
  )
);
CREATE INDEX IF NOT EXISTS "market_account_collection_sync_requests_idx"
  ON "market_account_collection_sync" USING gin ("request_ids");

CREATE OR REPLACE FUNCTION "guard_market_account_collection_receipt"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_ACCOUNT_COLLECTION_RECEIPT_IMMUTABLE';
END;
$$;
DROP TRIGGER IF EXISTS "market_account_collection_receipt_immutable" ON "market_account_collection_sync";
CREATE TRIGGER "market_account_collection_receipt_immutable"
  BEFORE UPDATE OR DELETE ON "market_account_collection_sync"
  FOR EACH ROW EXECUTE FUNCTION "guard_market_account_collection_receipt"();

-- All writers, including old/manual/partner routes, share account advisory locks.
-- Existing non-collection duplicates are retained; only new conflicts involving a collection are rejected.
CREATE OR REPLACE FUNCTION "guard_market_collection_account"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_school text;
  v_emails text[];
  v_email text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."market_collection_id" IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'COLLECTION_IDENTITY_CONFLICT';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."market_collection_id" IS NOT NULL AND (
    NEW."market_collection_id" IS DISTINCT FROM OLD."market_collection_id"
    OR NEW."external_source" IS DISTINCT FROM OLD."external_source"
    OR NEW."market_request_id" IS DISTINCT FROM OLD."market_request_id"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."market_order_id" IS DISTINCT FROM OLD."market_order_id"
    OR NEW."order_number" IS DISTINCT FROM OLD."order_number"
    OR NEW."draft_only" IS DISTINCT FROM OLD."draft_only"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'COLLECTION_IDENTITY_CONFLICT';
  END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW."school_name", NEW."emails", NEW."type", NEW."status", NEW."archived_at", NEW."confirmed_at", NEW."market_collection_id")
    IS NOT DISTINCT FROM ROW(OLD."school_name", OLD."emails", OLD."type", OLD."status", OLD."archived_at", OLD."confirmed_at", OLD."market_collection_id") THEN
    RETURN NEW;
  END IF;
  IF NEW."type" <> 'upgrade' OR NEW."status" NOT IN ('draft', 'sent', 'invoiced', 'paid')
    OR NEW."archived_at" IS NOT NULL OR NEW."confirmed_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_school := lower(btrim(NEW."school_name"));
  SELECT array_agg(candidate.email ORDER BY candidate.email COLLATE "C") INTO v_emails
  FROM (SELECT DISTINCT lower(btrim(part.email)) AS email
    FROM regexp_split_to_table(NEW."emails", '[,;[:space:]]+') AS part(email)
    WHERE btrim(part.email) <> '') candidate;
  IF COALESCE(cardinality(v_emails), 0) = 0 THEN RETURN NEW; END IF;
  FOREACH v_email IN ARRAY v_emails LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('account:' || v_school || ':' || v_email, 0));
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM "account_requests" other
    WHERE other."id" <> NEW."id"
      AND lower(btrim(other."school_name")) = v_school
      AND other."type" = 'upgrade' AND other."status" IN ('draft', 'sent', 'invoiced', 'paid')
      AND other."archived_at" IS NULL AND other."confirmed_at" IS NULL
      AND (NEW."market_collection_id" IS NOT NULL OR other."market_collection_id" IS NOT NULL)
      AND EXISTS (SELECT 1 FROM regexp_split_to_table(other."emails", '[,;[:space:]]+') AS part(email)
        WHERE lower(btrim(part.email)) = ANY(v_emails))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'DUPLICATE_ACCOUNT_REQUEST';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "account_requests_collection_duplicate_guard" ON "account_requests";
CREATE TRIGGER "account_requests_collection_duplicate_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "account_requests"
  FOR EACH ROW EXECUTE FUNCTION "guard_market_collection_account"();
