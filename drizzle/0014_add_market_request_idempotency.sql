-- 0014: market 전용 Snorkl 계정요청 수신 식별자와 멱등성 보강
-- 기존 수동/공개 요청은 nullable 필드를 사용하므로 동작이 바뀌지 않는다.
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "external_source" text;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "market_request_id" text;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "market_order_id" text;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "order_number" text;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "external_payload_hash" text;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "draft_only" boolean NOT NULL DEFAULT false;

-- 같은 market 요청 또는 같은 멱등키로 두 행이 생성되는 것을 DB에서도 차단한다.
CREATE UNIQUE INDEX IF NOT EXISTS "account_requests_idempotency_key_unique_idx"
  ON "account_requests" ("idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "account_requests_external_request_unique_idx"
  ON "account_requests" ("external_source", "market_request_id");

CREATE INDEX IF NOT EXISTS "account_requests_market_order_id_idx"
  ON "account_requests" ("market_order_id");
CREATE INDEX IF NOT EXISTS "account_requests_order_number_idx"
  ON "account_requests" ("order_number");
