-- 0017: Market 결제 취소와 Snorkl 계정요청 발송을 주문 단위로 직렬화한다.
--
-- 핵심 불변식
-- 1) 같은 market_order_id의 발송/확인/Stripe 선점과 취소 prepare는 같은 fence 행을
--    조건부 UPDATE한다. 먼저 선점한 쪽만 성공한다.
-- 2) 아직 account_requests 행이 도착하지 않았어도 prepared/voided fence가 늦은 create를 막는다.
-- 3) Market 요청은 삭제하지 않고 void 상태를 보존한다.

BEGIN;

ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "market_void_state" text NOT NULL DEFAULT 'active';
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "market_void_operation_id" text;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "market_void_prepared_at" timestamp;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "market_voided_at" timestamp;

ALTER TABLE "account_requests" DROP CONSTRAINT IF EXISTS "account_requests_market_void_state_check";
ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_market_void_state_check"
  CHECK ("market_void_state" IN ('active', 'non_voidable', 'prepared', 'voided'));

CREATE INDEX IF NOT EXISTS "account_requests_market_void_state_idx"
  ON "account_requests" ("market_void_state");

CREATE TABLE IF NOT EXISTS "market_order_void_fences" (
  "market_order_id" text PRIMARY KEY,
  "order_number" text NOT NULL,
  "state" text NOT NULL DEFAULT 'active',
  "operation_id" text,
  "reason_code" text,
  "request_fingerprint" text,
  "version" integer NOT NULL DEFAULT 0,
  "prepared_at" timestamp,
  "voided_at" timestamp,
  "aborted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "market_order_void_fences_state_check"
    CHECK ("state" IN ('active', 'non_voidable', 'prepared', 'voided'))
);

CREATE INDEX IF NOT EXISTS "market_order_void_fences_state_idx"
  ON "market_order_void_fences" ("state");
CREATE INDEX IF NOT EXISTS "market_order_void_fences_operation_id_idx"
  ON "market_order_void_fences" ("operation_id");
CREATE UNIQUE INDEX IF NOT EXISTS "market_order_void_fences_operation_id_unique_idx"
  ON "market_order_void_fences" ("operation_id")
  WHERE "operation_id" IS NOT NULL;

-- fence에는 현재 operation이 남지만, 이 원장은 과거 operationId를 영구 보존해
-- op1 abort → op2 abort → 늦은 op1 prepare 같은 ABA 부활을 막는다.
CREATE TABLE IF NOT EXISTS "market_order_void_operations" (
  "operation_id" text PRIMARY KEY,
  "market_order_id" text NOT NULL REFERENCES "market_order_void_fences" ("market_order_id") ON DELETE RESTRICT,
  "order_number" text NOT NULL,
  "request_fingerprint" text NOT NULL,
  "state" text NOT NULL,
  "prepared_at" timestamp NOT NULL DEFAULT now(),
  "aborted_at" timestamp,
  "voided_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "market_order_void_operations_state_check"
    CHECK ("state" IN ('prepared', 'aborted', 'voided'))
);

CREATE INDEX IF NOT EXISTS "market_order_void_operations_order_id_idx"
  ON "market_order_void_operations" ("market_order_id");

-- 기존 Market 요청은 실제 처리 흔적이 하나라도 있으면 취소 선점 불가로 보수적으로 백필한다.
INSERT INTO "market_order_void_fences" (
  "market_order_id",
  "order_number",
  "state",
  "version",
  "created_at",
  "updated_at"
)
SELECT
  ar."market_order_id",
  COALESCE(MAX(NULLIF(ar."order_number", '')), ar."market_order_id"),
  CASE WHEN BOOL_OR(
    ar."status" <> 'draft'
    OR ar."confirm_token" IS NOT NULL
    OR ar."confirmed_at" IS NOT NULL
    OR ar."processing_email_send_started_at" IS NOT NULL
    OR ar."processing_email_sent_at" IS NOT NULL
    OR ar."invoice_email_send_started_at" IS NOT NULL
    OR ar."invoice_email_sent_at" IS NOT NULL
    OR ar."invoice_gmail_message_id" IS NOT NULL
    OR ar."receipt_gmail_message_id" IS NOT NULL
    OR NULLIF(ar."invoice_number", '') IS NOT NULL
    OR NULLIF(ar."invoice_amount", '') IS NOT NULL
    OR ar."invoice_due_date" IS NOT NULL
    OR NULLIF(ar."payment_link", '') IS NOT NULL
    OR ar."payment_date" IS NOT NULL
    OR NULLIF(ar."payment_method", '') IS NOT NULL
  ) THEN 'non_voidable' ELSE 'active' END,
  CASE WHEN BOOL_OR(
    ar."status" <> 'draft'
    OR ar."confirm_token" IS NOT NULL
    OR ar."confirmed_at" IS NOT NULL
    OR ar."processing_email_send_started_at" IS NOT NULL
    OR ar."processing_email_sent_at" IS NOT NULL
    OR ar."invoice_email_send_started_at" IS NOT NULL
    OR ar."invoice_email_sent_at" IS NOT NULL
    OR ar."invoice_gmail_message_id" IS NOT NULL
    OR ar."receipt_gmail_message_id" IS NOT NULL
    OR NULLIF(ar."invoice_number", '') IS NOT NULL
    OR NULLIF(ar."invoice_amount", '') IS NOT NULL
    OR ar."invoice_due_date" IS NOT NULL
    OR NULLIF(ar."payment_link", '') IS NOT NULL
    OR ar."payment_date" IS NOT NULL
    OR NULLIF(ar."payment_method", '') IS NOT NULL
  ) THEN 1 ELSE 0 END,
  MIN(ar."created_at"),
  now()
FROM "account_requests" ar
WHERE ar."external_source" = 'market'
  AND ar."market_order_id" IS NOT NULL
GROUP BY ar."market_order_id"
ON CONFLICT ("market_order_id") DO NOTHING;

UPDATE "account_requests" ar
SET "market_void_state" = f."state"
FROM "market_order_void_fences" f
WHERE ar."external_source" = 'market'
  AND ar."market_order_id" = f."market_order_id";

-- 0017을 재적용하거나 중간 버전에서 올라와도 현재 fence operation을
-- 영구 원장에 승격한다. fingerprint 없는 비정상 레거시는 재사용되지 않게 고유값으로 닫는다.
INSERT INTO "market_order_void_operations" (
  "operation_id", "market_order_id", "order_number", "request_fingerprint", "state",
  "prepared_at", "aborted_at", "voided_at", "created_at", "updated_at"
)
SELECT
  f."operation_id",
  f."market_order_id",
  f."order_number",
  COALESCE(f."request_fingerprint", 'legacy:' || f."operation_id"),
  CASE
    WHEN f."aborted_at" IS NOT NULL THEN 'aborted'
    WHEN f."state" = 'voided' THEN 'voided'
    ELSE 'prepared'
  END,
  COALESCE(f."prepared_at", f."created_at"),
  f."aborted_at",
  f."voided_at",
  f."created_at",
  f."updated_at"
FROM "market_order_void_fences" f
WHERE f."operation_id" IS NOT NULL
ON CONFLICT ("operation_id") DO NOTHING;

-- Market 행의 모든 writer를 DB에서 fail-closed로 통제한다. 애플리케이션 가드가 빠져도
-- irreversible evidence를 쓰는 쪽과 prepare가 같은 fence UPDATE를 경합한다.
CREATE OR REPLACE FUNCTION "guard_market_account_request_write"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_state text;
  v_irreversible boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."external_source" = 'market' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_REQUEST_DELETE_BLOCKED';
    END IF;
    IF OLD."channel" = 'company'
      AND OLD."external_source" IS DISTINCT FROM 'market'
      AND OLD."notes" ~ '/ 주문번호: [A-Za-z0-9][A-Za-z0-9._:/-]{0,199} /' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_LEGACY_REQUEST_DELETE_BLOCKED';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."external_source" IS DISTINCT FROM 'market' THEN
    IF TG_OP = 'UPDATE' AND OLD."external_source" = 'market' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_REQUEST_IDENTITY_IMMUTABLE';
    END IF;
    -- 0017 이후 stale 구 writer는 strict identity 없는 Market 연관 행을 만들 수 없다.
    -- 기존 legacy 표식도 UPDATE로 제거·부활시키지 못하게 OLD/NEW 양쪽을 검사한다.
    IF NEW."channel" = 'company'
      AND NEW."notes" ~ '/ 주문번호: [A-Za-z0-9][A-Za-z0-9._:/-]{0,199} /' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_LEGACY_IDENTITY_REQUIRED';
    END IF;
    IF TG_OP = 'UPDATE'
      AND OLD."channel" = 'company'
      AND OLD."notes" ~ '/ 주문번호: [A-Za-z0-9][A-Za-z0-9._:/-]{0,199} /' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_LEGACY_IDENTITY_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."market_order_id" IS NULL OR NEW."order_number" IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_ORDER_ID_REQUIRED';
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO "market_order_void_fences" (
      "market_order_id", "order_number", "state", "created_at", "updated_at"
    ) VALUES (
      NEW."market_order_id", NEW."order_number", 'active', now(), now()
    )
    ON CONFLICT ("market_order_id") DO NOTHING;

    -- 조건부 UPDATE가 concurrent prepare/commit 뒤 WHERE를 다시 평가한다.
    -- non_voidable은 이미 취소 불가가 확정된 상태이므로 동일 주문의 늦은 sibling create는
    -- 허용해 유료 요청이 누락되지 않게 한다. prepared/voided만 create를 차단한다.
    UPDATE "market_order_void_fences"
    SET "updated_at" = "updated_at"
    WHERE "market_order_id" = NEW."market_order_id"
      AND "order_number" = NEW."order_number"
      AND "state" IN ('active', 'non_voidable')
    RETURNING "state" INTO v_state;

    IF v_state IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_ORDER_VOID_FENCED';
    END IF;
    NEW."market_void_state" := v_state;
    RETURN NEW;
  END IF;

  IF OLD."external_source" IS DISTINCT FROM NEW."external_source"
    OR OLD."market_order_id" IS DISTINCT FROM NEW."market_order_id"
    OR OLD."market_request_id" IS DISTINCT FROM NEW."market_request_id"
    OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key"
    OR OLD."order_number" IS DISTINCT FROM NEW."order_number" THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_REQUEST_IDENTITY_IMMUTABLE';
  END IF;

  -- market-void 상태 전이 함수가 바꾸는 감사 필드만 달라졌다면 fence의 현재 상태와
  -- 정확히 일치할 때만 통과한다. 일반 writer가 감사 컬럼을 임의로 바꾸지 못한다.
  IF (to_jsonb(NEW) - ARRAY[
      'market_void_state', 'market_void_operation_id', 'market_void_prepared_at',
      'market_voided_at', 'updated_at'
    ]) IS NOT DISTINCT FROM
    (to_jsonb(OLD) - ARRAY[
      'market_void_state', 'market_void_operation_id', 'market_void_prepared_at',
      'market_voided_at', 'updated_at'
    ]) THEN
    UPDATE "market_order_void_fences"
    SET "updated_at" = "updated_at"
    WHERE "market_order_id" = NEW."market_order_id"
      AND "state" = NEW."market_void_state"
      AND (
        "state" IN ('active', 'non_voidable')
        OR "operation_id" = NEW."market_void_operation_id"
      )
    RETURNING "state" INTO v_state;
    IF v_state IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_VOID_AUDIT_STATE_MISMATCH';
    END IF;
    RETURN NEW;
  END IF;

  v_irreversible :=
    NEW."status" <> 'draft'
    OR NEW."confirm_token" IS NOT NULL
    OR NEW."confirmed_at" IS NOT NULL
    OR NEW."processing_email_send_started_at" IS NOT NULL
    OR NEW."processing_email_sent_at" IS NOT NULL
    OR NEW."invoice_email_send_started_at" IS NOT NULL
    OR NEW."invoice_email_sent_at" IS NOT NULL
    OR NEW."invoice_gmail_message_id" IS NOT NULL
    OR NEW."receipt_gmail_message_id" IS NOT NULL
    OR NULLIF(NEW."invoice_number", '') IS NOT NULL
    OR NULLIF(NEW."invoice_amount", '') IS NOT NULL
    OR NEW."invoice_due_date" IS NOT NULL
    OR NULLIF(NEW."payment_link", '') IS NOT NULL
    OR NEW."payment_date" IS NOT NULL
    OR NULLIF(NEW."payment_method", '') IS NOT NULL;

  UPDATE "market_order_void_fences"
  SET
    "state" = CASE WHEN "state" = 'active' AND v_irreversible THEN 'non_voidable' ELSE "state" END,
    "version" = "version" + CASE WHEN "state" = 'active' AND v_irreversible THEN 1 ELSE 0 END,
    "updated_at" = now()
  WHERE "market_order_id" = NEW."market_order_id"
    AND "order_number" = NEW."order_number"
    AND "state" IN ('active', 'non_voidable')
  RETURNING "state" INTO v_state;

  IF v_state IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_ORDER_VOID_FENCED';
  END IF;

  NEW."market_void_state" := v_state;
  -- 같은 주문의 sibling 감사 상태도 fence SSOT와 맞춘다. void 필드만 바꾸므로
  -- sibling trigger는 위의 pure-audit 분기로 끝나 재귀하지 않는다.
  IF v_state = 'non_voidable' AND OLD."market_void_state" IS DISTINCT FROM 'non_voidable' THEN
    UPDATE "account_requests"
    SET "market_void_state" = 'non_voidable', "updated_at" = now()
    WHERE "external_source" = 'market'
      AND "market_order_id" = NEW."market_order_id"
      AND "id" <> NEW."id"
      AND "market_void_state" IS DISTINCT FROM 'non_voidable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "account_requests_market_void_guard" ON "account_requests";
CREATE TRIGGER "account_requests_market_void_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "account_requests"
FOR EACH ROW EXECUTE FUNCTION "guard_market_account_request_write"();

CREATE OR REPLACE FUNCTION "market_void_request_rows"(p_market_order_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'marketRequestId', ar."market_request_id",
        'externalRequestId', ar."id"::text,
        'state', ar."market_void_state"
      ) ORDER BY ar."id"
    ),
    '[]'::jsonb
  )
  FROM "account_requests" ar
  WHERE ar."external_source" = 'market'
    AND ar."market_order_id" = p_market_order_id;
$$;

-- 묶음 메일도 모든 Market order fence를 먼저 all-or-none으로 선점한다. 한 건이
-- prepared/voided면 앞선 요청만 non_voidable로 남는 부분 선점을 롤백한다.
CREATE OR REPLACE FUNCTION "claim_market_request_side_effects"(p_request_ids integer[])
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_order record;
  v_state text;
  v_expected_count integer;
  v_actual_count integer;
BEGIN
  v_expected_count := COALESCE(cardinality(p_request_ids), 0);
  IF v_expected_count = 0 THEN RETURN false; END IF;
  SELECT COUNT(DISTINCT id)::integer INTO v_actual_count
  FROM unnest(p_request_ids) AS requested(id);
  IF v_actual_count <> v_expected_count THEN RETURN false; END IF;
  SELECT COUNT(*)::integer INTO v_actual_count
  FROM "account_requests" WHERE "id" = ANY(p_request_ids);
  IF v_actual_count <> v_expected_count THEN RETURN false; END IF;

  BEGIN
    FOR v_order IN
      SELECT DISTINCT ar."market_order_id", ar."order_number"
      FROM "account_requests" ar
      WHERE ar."id" = ANY(p_request_ids)
        AND ar."external_source" = 'market'
      ORDER BY ar."market_order_id"
    LOOP
      IF v_order."market_order_id" IS NULL OR v_order."order_number" IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_ORDER_ID_REQUIRED';
      END IF;

      v_state := NULL;
      UPDATE "market_order_void_fences"
      SET
        "state" = CASE WHEN "state" = 'active' THEN 'non_voidable' ELSE "state" END,
        "version" = "version" + CASE WHEN "state" = 'active' THEN 1 ELSE 0 END,
        "updated_at" = now()
      WHERE "market_order_id" = v_order."market_order_id"
        AND "order_number" = v_order."order_number"
        AND "state" IN ('active', 'non_voidable')
      RETURNING "state" INTO v_state;
      IF v_state IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MARKET_ORDER_VOID_FENCED';
      END IF;
    END LOOP;

    UPDATE "account_requests" ar
    SET "market_void_state" = f."state", "updated_at" = now()
    FROM "market_order_void_fences" f
    WHERE ar."external_source" = 'market'
      AND ar."market_order_id" = f."market_order_id"
      AND f."market_order_id" IN (
        SELECT selected."market_order_id"
        FROM "account_requests" selected
        WHERE selected."id" = ANY(p_request_ids)
          AND selected."external_source" = 'market'
      );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    RETURN false;
  END;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION "claim_market_request_side_effect"(p_request_id integer)
RETURNS boolean
LANGUAGE sql
AS $$
  SELECT "claim_market_request_side_effects"(ARRAY[p_request_id]);
$$;

-- prepare/commit/abort 전체를 한 함수 호출(=한 DB 문장/트랜잭션)에서 수행한다.
CREATE OR REPLACE FUNCTION "transition_market_order_void"(
  p_phase text,
  p_operation_id text,
  p_market_order_id text,
  p_order_number text,
  p_reason_code text,
  p_requests jsonb,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_fence "market_order_void_fences"%ROWTYPE;
  v_operation "market_order_void_operations"%ROWTYPE;
  v_operation_found boolean;
  v_fingerprint text;
  v_request_rows jsonb;
BEGIN
  v_fingerprint := md5(p_order_number || E'\n' || p_reason_code || E'\n' || p_requests::text);

  -- 구 writer는 strict Market identity 대신 notes 표식만 남겼다. prepare 전에
  -- 정확한 주문번호 표식이 발견되면 fence/account_request 어느 상태도 바꾸지 않고 닫는다.
  -- 0건은 notes 수정·삭제 때문에 과거 요청 부재를 증명하지 않으며 상위 Market도 별도 fail-closed한다.
  IF p_phase = 'prepare' AND EXISTS (
    SELECT 1
    FROM "account_requests" ar
    WHERE ar."channel" = 'company'
      AND position(('/ 주문번호: ' || p_order_number || ' /') in ar."notes") > 0
      AND (
        ar."external_source" IS DISTINCT FROM 'market'
        OR ar."market_request_id" IS NULL
        OR ar."market_order_id" IS NULL
        OR ar."order_number" IS NULL
        OR ar."idempotency_key" IS NULL
        OR ar."draft_only" IS DISTINCT FROM true
      )
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'MARKET_VOID_LEGACY_ORDER_MATCH'
    );
  END IF;

  INSERT INTO "market_order_void_fences" (
    "market_order_id", "order_number", "state", "created_at", "updated_at"
  ) VALUES (
    p_market_order_id, p_order_number, 'active', now(), now()
  )
  ON CONFLICT ("market_order_id") DO NOTHING;

  -- no-op UPDATE로 현재 fence 행을 잠그고, concurrent UPDATE 뒤의 실제 값을 받는다.
  UPDATE "market_order_void_fences"
  SET "updated_at" = "updated_at"
  WHERE "market_order_id" = p_market_order_id
  RETURNING * INTO v_fence;

  IF v_fence."order_number" IS DISTINCT FROM p_order_number THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'MARKET_VOID_IDENTITY_CONFLICT',
      'state', v_fence."state", 'version', v_fence."version"
    );
  END IF;

  SELECT * INTO v_operation
  FROM "market_order_void_operations"
  WHERE "operation_id" = p_operation_id
  FOR UPDATE;
  v_operation_found := FOUND;

  IF v_operation_found AND (
    v_operation."market_order_id" IS DISTINCT FROM p_market_order_id
    OR v_operation."order_number" IS DISTINCT FROM p_order_number
    OR v_operation."request_fingerprint" IS DISTINCT FROM v_fingerprint
  ) THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'MARKET_VOID_OPERATION_CONFLICT',
      'state', v_fence."state", 'version', v_fence."version"
    );
  END IF;

  IF p_phase <> 'prepare' AND NOT v_operation_found THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'MARKET_VOID_OPERATION_CONFLICT',
      'state', v_fence."state", 'version', v_fence."version"
    );
  END IF;

  IF p_phase = 'prepare' THEN
    IF v_operation_found THEN
      IF v_operation."state" = 'aborted' THEN
        RETURN jsonb_build_object(
          'ok', false, 'code', 'MARKET_VOID_OPERATION_ABORTED',
          'state', v_fence."state", 'version', v_fence."version"
        );
      END IF;
      IF v_fence."state" IN ('prepared', 'voided')
        AND v_fence."operation_id" = p_operation_id THEN
        RETURN jsonb_build_object(
          'ok', true, 'state', v_fence."state", 'version', v_fence."version",
          'idempotent', true, 'requests', "market_void_request_rows"(p_market_order_id)
        );
      END IF;
      RETURN jsonb_build_object(
        'ok', false, 'code', 'MARKET_VOID_OPERATION_CONFLICT',
        'state', v_fence."state", 'version', v_fence."version"
      );
    END IF;

    -- 다른 operation이 이미 fence를 소유하면 새 operation 원장을 만들지 않는다.
    -- 이 가드가 없으면 후속 active CAS 실패 전에 orphan prepared 원장이 남을 수 있다.
    IF v_fence."state" IN ('prepared', 'voided') THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'MARKET_VOID_OPERATION_CONFLICT',
        'state', v_fence."state", 'version', v_fence."version"
      );
    END IF;

    IF v_fence."state" = 'non_voidable' THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'MARKET_VOID_NOT_PREPARABLE',
        'state', v_fence."state", 'version', v_fence."version"
      );
    END IF;

    -- receiver에 존재하는 같은 주문의 모든 행은 Market이 보낸 identity 집합에 있어야 한다.
    IF EXISTS (
      SELECT 1
      FROM "account_requests" ar
      WHERE ar."external_source" = 'market'
        AND ar."market_order_id" = p_market_order_id
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_requests) item
          WHERE item->>'marketRequestId' = ar."market_request_id"
            AND item->>'idempotencyKey' = ar."idempotency_key"
            AND (
              NULLIF(item->>'externalRequestId', '') IS NULL
              OR item->>'externalRequestId' = ar."id"::text
            )
        )
    ) OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_requests) item
      JOIN "account_requests" ar
        ON ar."external_source" = 'market'
       AND (
         ar."market_request_id" = item->>'marketRequestId'
         OR ar."idempotency_key" = item->>'idempotencyKey'
       )
      WHERE ar."market_order_id" IS DISTINCT FROM p_market_order_id
         OR ar."market_request_id" IS DISTINCT FROM item->>'marketRequestId'
         OR ar."idempotency_key" IS DISTINCT FROM item->>'idempotencyKey'
         OR (
           NULLIF(item->>'externalRequestId', '') IS NOT NULL
           AND ar."id"::text IS DISTINCT FROM item->>'externalRequestId'
         )
    ) OR EXISTS (
      -- externalRequestId를 보낸 항목은 이미 receiver에 도착했다는 주장이다.
      -- 해당 숫자 id까지 정확히 일치하는 행이 없으면 지연 create로 취급하지 않는다.
      SELECT 1
      FROM jsonb_array_elements(p_requests) item
      WHERE NULLIF(item->>'externalRequestId', '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "account_requests" ar
          WHERE ar."external_source" = 'market'
            AND ar."market_order_id" = p_market_order_id
            AND ar."market_request_id" = item->>'marketRequestId'
            AND ar."idempotency_key" = item->>'idempotencyKey'
            AND ar."id"::text = item->>'externalRequestId'
        )
    ) THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'MARKET_VOID_IDENTITY_CONFLICT',
        'state', v_fence."state", 'version', v_fence."version"
      );
    END IF;

    -- 백필/수동 SQL로 active fence에 처리 흔적이 남은 비정상 데이터도 fail-closed한다.
    IF EXISTS (
      SELECT 1
      FROM "account_requests" ar
      WHERE ar."external_source" = 'market'
        AND ar."market_order_id" = p_market_order_id
        AND (
          ar."status" <> 'draft'
          OR ar."confirm_token" IS NOT NULL
          OR ar."confirmed_at" IS NOT NULL
          OR ar."processing_email_send_started_at" IS NOT NULL
          OR ar."processing_email_sent_at" IS NOT NULL
          OR ar."invoice_email_send_started_at" IS NOT NULL
          OR ar."invoice_email_sent_at" IS NOT NULL
          OR ar."invoice_gmail_message_id" IS NOT NULL
          OR ar."receipt_gmail_message_id" IS NOT NULL
          OR NULLIF(ar."invoice_number", '') IS NOT NULL
          OR NULLIF(ar."invoice_amount", '') IS NOT NULL
          OR ar."invoice_due_date" IS NOT NULL
          OR NULLIF(ar."payment_link", '') IS NOT NULL
          OR ar."payment_date" IS NOT NULL
          OR NULLIF(ar."payment_method", '') IS NOT NULL
        )
    ) THEN
      UPDATE "market_order_void_fences"
      SET "state" = 'non_voidable', "version" = "version" + 1, "updated_at" = now()
      WHERE "market_order_id" = p_market_order_id AND "state" = 'active'
      RETURNING * INTO v_fence;
      UPDATE "account_requests"
      SET "market_void_state" = 'non_voidable', "updated_at" = now()
      WHERE "external_source" = 'market' AND "market_order_id" = p_market_order_id;
      RETURN jsonb_build_object(
        'ok', false, 'code', 'MARKET_VOID_NOT_PREPARABLE',
        'state', 'non_voidable', 'version', v_fence."version"
      );
    END IF;

    INSERT INTO "market_order_void_operations" (
      "operation_id", "market_order_id", "order_number", "request_fingerprint", "state",
      "prepared_at", "created_at", "updated_at"
    ) VALUES (
      p_operation_id, p_market_order_id, p_order_number, v_fingerprint, 'prepared',
      now(), now(), now()
    )
    ON CONFLICT ("operation_id") DO NOTHING
    RETURNING * INTO v_operation;
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'MARKET_VOID_OPERATION_CONFLICT',
        'state', v_fence."state", 'version', v_fence."version"
      );
    END IF;

    UPDATE "market_order_void_fences"
    SET
      "state" = 'prepared',
      "operation_id" = p_operation_id,
      "reason_code" = p_reason_code,
      "request_fingerprint" = v_fingerprint,
      "version" = "version" + 1,
      "prepared_at" = now(),
      "voided_at" = NULL,
      "aborted_at" = NULL,
      "updated_at" = now()
    WHERE "market_order_id" = p_market_order_id AND "state" = 'active'
    RETURNING * INTO v_fence;

    IF NOT FOUND THEN
      -- v_fence를 먼저 잠그므로 정상 경로에서는 도달하지 않지만, 비정상
      -- trigger/수동 SQL 경합에서도 이번 호출의 orphan prepared 원장을 남기지 않는다.
      DELETE FROM "market_order_void_operations"
      WHERE "operation_id" = p_operation_id
        AND "market_order_id" = p_market_order_id
        AND "state" = 'prepared';
      UPDATE "market_order_void_fences"
      SET "updated_at" = "updated_at"
      WHERE "market_order_id" = p_market_order_id
      RETURNING * INTO v_fence;
      RETURN jsonb_build_object(
        'ok', false, 'code', 'MARKET_VOID_CONCURRENT_CONFLICT',
        'state', v_fence."state", 'version', v_fence."version"
      );
    END IF;

    UPDATE "account_requests"
    SET
      "market_void_state" = 'prepared',
      "market_void_operation_id" = p_operation_id,
      "market_void_prepared_at" = v_fence."prepared_at",
      "market_voided_at" = NULL,
      "updated_at" = now()
    WHERE "external_source" = 'market'
      AND "market_order_id" = p_market_order_id;

  ELSIF p_phase = 'commit' THEN
    IF v_fence."state" = 'voided'
      AND v_fence."operation_id" = p_operation_id
      AND v_fence."request_fingerprint" = v_fingerprint THEN
      RETURN jsonb_build_object(
        'ok', true, 'state', 'voided', 'version', v_fence."version",
        'idempotent', true, 'requests', "market_void_request_rows"(p_market_order_id)
      );
    END IF;
    IF v_fence."state" <> 'prepared'
      OR v_fence."operation_id" IS DISTINCT FROM p_operation_id
      OR v_fence."request_fingerprint" IS DISTINCT FROM v_fingerprint
      OR v_fence."version" IS DISTINCT FROM p_expected_version THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'MARKET_VOID_VERSION_CONFLICT',
        'state', v_fence."state", 'version', v_fence."version"
      );
    END IF;

    UPDATE "market_order_void_fences"
    SET "state" = 'voided', "version" = "version" + 1,
        "voided_at" = now(), "updated_at" = now()
    WHERE "market_order_id" = p_market_order_id
      AND "state" = 'prepared'
      AND "operation_id" = p_operation_id
      AND "version" = p_expected_version
    RETURNING * INTO v_fence;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'MARKET_VOID_CONCURRENT_CONFLICT');
    END IF;

    UPDATE "account_requests"
    SET "market_void_state" = 'voided',
        "market_void_operation_id" = p_operation_id,
        "market_voided_at" = v_fence."voided_at", "updated_at" = now()
    WHERE "external_source" = 'market'
      AND "market_order_id" = p_market_order_id;

    UPDATE "market_order_void_operations"
    SET "state" = 'voided', "voided_at" = v_fence."voided_at", "updated_at" = now()
    WHERE "operation_id" = p_operation_id
      AND "market_order_id" = p_market_order_id
      AND "state" = 'prepared';

  ELSIF p_phase = 'abort' THEN
    IF v_fence."state" = 'active'
      AND v_fence."operation_id" = p_operation_id
      AND v_fence."request_fingerprint" = v_fingerprint
      AND v_fence."aborted_at" IS NOT NULL
      AND v_operation."state" = 'aborted' THEN
      RETURN jsonb_build_object(
        'ok', true, 'state', 'active', 'version', v_fence."version",
        'idempotent', true, 'abortCompleted', true,
        'requests', "market_void_request_rows"(p_market_order_id)
      );
    END IF;
    -- abort DB commit 성공 후 HTTP 응답만 유실되고, 대기 중이던 fulfillment가
    -- active fence를 non_voidable로 선점한 경우다. 실제 상태를 active로 위장하지 않고
    -- 영구 operation 원장+같은 fingerprint+aborted_at이 모두 일치할 때만 abort 완료를 증명한다.
    IF v_fence."state" = 'non_voidable'
      AND v_fence."operation_id" = p_operation_id
      AND v_fence."request_fingerprint" = v_fingerprint
      AND v_fence."aborted_at" IS NOT NULL
      AND v_operation."state" = 'aborted' THEN
      RETURN jsonb_build_object(
        'ok', true, 'state', 'non_voidable', 'version', v_fence."version",
        'idempotent', true, 'abortCompleted', true,
        'requests', "market_void_request_rows"(p_market_order_id)
      );
    END IF;
    IF v_fence."state" = 'voided' THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'MARKET_VOID_ALREADY_COMMITTED',
        'state', v_fence."state", 'version', v_fence."version"
      );
    END IF;
    IF v_fence."state" <> 'prepared'
      OR v_fence."operation_id" IS DISTINCT FROM p_operation_id
      OR v_fence."request_fingerprint" IS DISTINCT FROM v_fingerprint
      OR v_fence."version" IS DISTINCT FROM p_expected_version THEN
      RETURN jsonb_build_object(
        'ok', false, 'code', 'MARKET_VOID_VERSION_CONFLICT',
        'state', v_fence."state", 'version', v_fence."version"
      );
    END IF;

    UPDATE "market_order_void_fences"
    SET "state" = 'active', "version" = "version" + 1,
        "prepared_at" = NULL, "aborted_at" = now(), "updated_at" = now()
    WHERE "market_order_id" = p_market_order_id
      AND "state" = 'prepared'
      AND "operation_id" = p_operation_id
      AND "version" = p_expected_version
    RETURNING * INTO v_fence;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'MARKET_VOID_CONCURRENT_CONFLICT');
    END IF;

    UPDATE "account_requests"
    SET "market_void_state" = 'active',
        "market_void_operation_id" = p_operation_id,
        "market_void_prepared_at" = NULL,
        "market_voided_at" = NULL, "updated_at" = now()
    WHERE "external_source" = 'market'
      AND "market_order_id" = p_market_order_id;

    UPDATE "market_order_void_operations"
    SET "state" = 'aborted', "aborted_at" = v_fence."aborted_at", "updated_at" = now()
    WHERE "operation_id" = p_operation_id
      AND "market_order_id" = p_market_order_id
      AND "state" = 'prepared';
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'MARKET_VOID_INVALID_PHASE');
  END IF;

  v_request_rows := "market_void_request_rows"(p_market_order_id);
  RETURN jsonb_build_object(
    'ok', true,
    'state', v_fence."state",
    'version', v_fence."version",
    'idempotent', false,
    'abortCompleted', CASE WHEN p_phase = 'abort' THEN true ELSE NULL END,
    'requests', v_request_rows
  );
END;
$$;

COMMIT;
