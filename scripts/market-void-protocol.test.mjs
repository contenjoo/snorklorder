import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MARKET_VOID_REASON_CODE,
  marketVoidErrorMessage,
  validateMarketVoidInput,
} from "../src/lib/market-void.ts";

const base = {
  phase: "prepare",
  operationId: "cancel_order_1_attempt_1",
  marketOrderId: "order_1",
  orderNumber: "ORD-20260825-TEST",
  reasonCode: MARKET_VOID_REASON_CODE,
  requests: [
    { marketRequestId: "request_b", idempotencyKey: "market:order_1:1" },
    { marketRequestId: "request_a", idempotencyKey: "market:order_1:0", externalRequestId: "42" },
  ],
};

test("prepare는 빈 requests tombstone과 정규화된 여러 요청을 허용한다", () => {
  const empty = validateMarketVoidInput({ ...base, requests: [] });
  assert.equal(empty.ok, true);

  const result = validateMarketVoidInput(base);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.value.requests.map((request) => request.marketRequestId),
    ["request_a", "request_b"],
  );
  assert.equal(result.value.expectedVersion, undefined);
});

test("commit/abort는 prepare version을 요구하고 prepare에는 version을 허용하지 않는다", () => {
  assert.equal(validateMarketVoidInput({ ...base, expectedVersion: 1 }).ok, false);
  assert.equal(validateMarketVoidInput({ ...base, phase: "commit" }).ok, false);
  assert.equal(validateMarketVoidInput({ ...base, phase: "abort", expectedVersion: -1 }).ok, false);
  assert.equal(validateMarketVoidInput({ ...base, phase: "commit", expectedVersion: 1 }).ok, true);
  assert.equal(validateMarketVoidInput({ ...base, phase: "abort", expectedVersion: 1 }).ok, true);
});

test("identity 중복·자유 입력 사유·잘못된 외부 ID를 거절한다", () => {
  assert.equal(validateMarketVoidInput({ ...base, reasonCode: "free text" }).ok, false);
  assert.equal(validateMarketVoidInput({
    ...base,
    requests: [
      { marketRequestId: "same", idempotencyKey: "key_1" },
      { marketRequestId: "same", idempotencyKey: "key_2" },
    ],
  }).ok, false);
  assert.equal(validateMarketVoidInput({
    ...base,
    requests: [{ marketRequestId: "request_1", idempotencyKey: "key_1", externalRequestId: "bad id" }],
  }).ok, false);
});

test("route는 세션 폴백 없이 DB 함수 한 문장으로 전이한다", async () => {
  const route = await readFile(
    new URL("../src/app/api/account-requests/market-void/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /authorizeMarketStatusRequest/);
  assert.match(route, /x-api-key/);
  assert.doesNotMatch(route, /checkAuth|session/);
  assert.match(route, /db\.execute/);
  assert.match(route, /transition_market_order_void/);
  assert.equal(route.match(/db\.execute/g)?.length, 1);
  assert.doesNotMatch(route, /db\.transaction|\.transaction\(/);
  assert.match(route, /hasDatabaseCode\(error, "23505"\)/);
  assert.match(route, /MARKET_VOID_OPERATION_CONFLICT/);
  assert.match(route, /status: 409/);
  assert.match(route, /status: 500/);
});

test("migration은 order fence·late create·writer CAS·멱등 버전을 DB에서 강제한다", async () => {
  const migration = await readFile(
    new URL("../drizzle/0017_add_market_order_void_fence.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /^BEGIN;$/m);
  assert.match(migration, /\$\$;\n\nCOMMIT;\s*$/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "market_order_void_fences"/);
  assert.match(migration, /"market_order_id" text PRIMARY KEY/);
  assert.match(migration, /operation_id_unique_idx/);
  assert.match(migration, /WHERE "operation_id" IS NOT NULL/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "market_order_void_operations"/);
  assert.match(migration, /"operation_id" text PRIMARY KEY/);
  assert.match(migration, /market_order_void_operations_state_check/);
  assert.match(migration, /external_source" = 'market'[\s\S]*market_order_id" IS NOT NULL[\s\S]*GROUP BY ar\."market_order_id"/);
  assert.match(migration, /CREATE TRIGGER "account_requests_market_void_guard"/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(migration, /MARKET_REQUEST_DELETE_BLOCKED/);
  assert.match(migration, /MARKET_ORDER_VOID_FENCED/);
  assert.match(
    migration,
    /TG_OP = 'INSERT'[\s\S]*"state" IN \('active', 'non_voidable'\)[\s\S]*NEW\."market_void_state" := v_state/,
  );
  assert.match(migration, /'active', 'non_voidable', 'prepared', 'voided'/);
  assert.match(migration, /"state" = 'prepared'/);
  assert.match(migration, /"state" = 'voided'/);
  assert.match(migration, /"state" = 'active'[\s\S]*"aborted_at" = now\(\)/);
  assert.match(migration, /v_operation\."state" = 'aborted'[\s\S]*MARKET_VOID_OPERATION_ABORTED/);
  assert.match(migration, /SET "state" = 'aborted', "aborted_at" = v_fence\."aborted_at"/);
  assert.match(migration, /ON CONFLICT \("operation_id"\) DO NOTHING/);
  assert.match(migration, /v_fence\."state" IN \('prepared', 'voided'\)[\s\S]*MARKET_VOID_OPERATION_CONFLICT/);
  assert.match(migration, /IF NOT FOUND THEN[\s\S]*DELETE FROM "market_order_void_operations"/);
  assert.match(
    migration,
    /v_fence\."state" = 'non_voidable'[\s\S]*v_fence\."operation_id" = p_operation_id[\s\S]*v_operation\."state" = 'aborted'[\s\S]*'abortCompleted', true/,
  );
  assert.match(migration, /"version" = "version" \+ 1/);
  assert.match(migration, /claim_market_request_side_effects/);
  assert.match(migration, /EXCEPTION WHEN SQLSTATE 'P0001'/);
  assert.match(migration, /externalRequestId/);
  const transitionStart = migration.indexOf('CREATE OR REPLACE FUNCTION "transition_market_order_void"');
  const legacyGuard = migration.indexOf("MARKET_VOID_LEGACY_ORDER_MATCH", transitionStart);
  const fenceInsert = migration.indexOf('INSERT INTO "market_order_void_fences" (', transitionStart);
  assert.ok(legacyGuard > transitionStart && legacyGuard < fenceInsert);
  assert.match(migration, /"channel" = 'company'/);
  assert.match(migration, /position\(\('\/ 주문번호: ' \|\| p_order_number \|\| ' \/'\) in ar\."notes"\) > 0/);
  assert.match(migration, /ar\."external_source" IS DISTINCT FROM 'market'/);
  assert.match(migration, /ar\."draft_only" IS DISTINCT FROM true/);
  assert.match(marketVoidErrorMessage("MARKET_VOID_LEGACY_ORDER_MATCH"), /Manual audit is required/);
});

test("abort된 모든 operationId는 영구 원장으로 ABA 부활과 다른 주문 재사용을 막는다", async () => {
  const migration = await readFile(
    new URL("../drizzle/0017_add_market_order_void_fence.sql", import.meta.url),
    "utf8",
  );
  const route = await readFile(
    new URL("../src/app/api/account-requests/market-void/route.ts", import.meta.url),
    "utf8",
  );
  const contract = await readFile(new URL("../src/lib/market-void.ts", import.meta.url), "utf8");
  assert.match(migration, /FROM "market_order_void_operations"[\s\S]*WHERE "operation_id" = p_operation_id[\s\S]*FOR UPDATE/);
  assert.match(migration, /v_operation\."market_order_id" IS DISTINCT FROM p_market_order_id/);
  assert.match(migration, /v_operation\."request_fingerprint" IS DISTINCT FROM v_fingerprint/);
  assert.match(route, /!result\.ok[\s\S]*status: 409/);
  assert.match(route, /input\.phase === "abort"[\s\S]*abortCompleted: result\.abortCompleted === true/);
  assert.match(contract, /case "MARKET_VOID_OPERATION_ABORTED"/);
  assert.match(contract, /already aborted and cannot be prepared again/);
});

test("메일·확인·완료 알림은 외부 side effect보다 먼저 all-or-none fence를 선점한다", async () => {
  const single = await readFile(new URL("../src/app/api/account-email/route.ts", import.meta.url), "utf8");
  const batch = await readFile(new URL("../src/app/api/account-email/batch/route.ts", import.meta.url), "utf8");
  const confirm = await readFile(new URL("../src/app/api/account-confirm/[token]/route.ts", import.meta.url), "utf8");
  const completion = await readFile(new URL("../src/app/api/admin/send-account-completion/route.ts", import.meta.url), "utf8");

  assert.ok(single.indexOf("claimAccountRequestSideEffects") < single.indexOf("randomBytes(16)"));
  assert.ok(single.indexOf("claimAccountRequestSideEffects") < single.indexOf("transporter.sendMail"));
  assert.ok(batch.lastIndexOf("claimAccountRequestSideEffects") < batch.indexOf("const tokenMap"));
  assert.ok(batch.lastIndexOf("claimAccountRequestSideEffects") < batch.indexOf("transporter.sendMail"));
  assert.ok(confirm.lastIndexOf("claimAccountRequestSideEffects") < confirm.indexOf(".update(accountRequests)"));
  assert.ok(completion.lastIndexOf("claimAccountRequestSideEffects") < completion.indexOf("sendAccountUpgradeCompletion({"));
});

test("Market 관리자 UI는 mailto·복사·미리보기 대신 fence를 거치는 서버 발송만 노출한다", async () => {
  const page = await readFile(new URL("../src/app/admin/accounts/page.tsx", import.meta.url), "utf8");
  assert.match(page, /function isMarketManaged/);
  assert.match(page, /if \(isMarketManaged\(r\)\)[\s\S]{0,180}서버 발송만 허용/);
  assert.match(page, /marketManaged \? \([\s\S]{0,600}sendToJon\(r\)/);
  assert.match(page, /emailPreview && !isMarketManaged\(emailPreview\)/);
  assert.match(page, /const selectableFiltered = filtered\.filter/);
  assert.match(page, /!isMarketManaged\(request\) && !isLegacyMarketAudit\(request\)/);
  assert.match(page, /Market 주문은 미리보기 없는 개별 서버 발송만 허용/);
});

test("구 Market marker 행은 UI와 단건·배치 API에서 수동 감사 전용으로 고정한다", async () => {
  const page = await readFile(new URL("../src/app/admin/accounts/page.tsx", import.meta.url), "utf8");
  const single = await readFile(new URL("../src/app/api/account-email/route.ts", import.meta.url), "utf8");
  const batch = await readFile(new URL("../src/app/api/account-email/batch/route.ts", import.meta.url), "utf8");

  assert.match(
    page,
    /function isLegacyMarketAudit[\s\S]{0,240}channel \|\| "company"[\s\S]{0,160}!isMarketManaged\(request\)[\s\S]{0,120}hasMarketLegacyOrderNote\(request\.notes\)/,
  );
  assert.ok((page.match(/if \(isLegacyMarketAudit\(/g) || []).length >= 5);
  assert.ok((page.match(/isLegacyMarketAudit\(request\)/g) || []).length >= 5);
  assert.match(page, /selectedRequests\.some\(isLegacyMarketAudit\)[\s\S]{0,180}묶음 발송을 차단/);
  assert.match(page, /selectedRequests\.some\(isLegacyMarketAudit\)\) return null/);
  assert.match(page, /emailPreview && !isMarketManaged\(emailPreview\) && !isLegacyMarketAudit\(emailPreview\)/);
  assert.match(page, /disabled=\{marketManaged \|\| legacyMarketAudit\}/);
  assert.match(page, /disabled=\{marketVoidFenced \|\| legacyMarketAudit\}/);
  assert.match(page, /!marketManaged && !legacyMarketAudit/);
  assert.match(page, /구 Market 주문 수동 감사 필요/);
  assert.match(page, /const operationalRequests = requests\.filter[\s\S]{0,160}!isLegacyMarketAudit\(request\)/);

  assert.match(single, /code: "MARKET_LEGACY_MANUAL_AUDIT_REQUIRED"/);
  assert.ok(single.indexOf("hasMarketLegacyOrderNote(existing.notes)") < single.indexOf("await claimAccountRequestSideEffects"));
  assert.ok(single.indexOf("hasMarketLegacyOrderNote(existing.notes)") < single.indexOf("transporter.sendMail"));
  assert.match(batch, /code: "MARKET_LEGACY_MANUAL_AUDIT_REQUIRED"/);
  assert.ok(batch.indexOf("hasMarketLegacyOrderNote(row.notes)") < batch.indexOf("await claimAccountRequestSideEffects"));
  assert.ok(batch.indexOf("hasMarketLegacyOrderNote(row.notes)") < batch.indexOf("transporter.sendMail"));
});

test("prepared/voided 감사 행은 후속 후보·집계·교사 인원에서 제외한다", async () => {
  const paths = [
    "../src/app/api/admin/summary/route.ts",
    "../src/app/api/admin/insights/route.ts",
    "../src/app/api/partner/route.ts",
    "../src/app/api/school/summary/route.ts",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /notInArray\(accountRequests\.marketVoidState, \["prepared", "voided"\]\)/);
  }

  const teachers = await readFile(new URL("../src/app/admin/teachers/page.tsx", import.meta.url), "utf8");
  assert.match(teachers, /externalSource === "market"[\s\S]{0,120}\["prepared", "voided"\]\.includes\(r\.marketVoidState\)/);

  const accounts = await readFile(new URL("../src/app/admin/accounts/page.tsx", import.meta.url), "utf8");
  assert.match(accounts, /const operationalRequests = requests\.filter[\s\S]{0,160}!isMarketVoidFenced\(request\)[\s\S]{0,100}!isLegacyMarketAudit\(request\)/);
  assert.match(accounts, /statusCounts[\s\S]{0,180}operationalRequests\.filter/);
  assert.match(accounts, /emailCount = operationalRequests\.reduce/);

  const adminSearch = await readFile(new URL("../src/app/api/admin/search/route.ts", import.meta.url), "utf8");
  assert.match(adminSearch, /notInArray\(accountRequests\.marketVoidState, \["prepared", "voided"\]\)/);
});
