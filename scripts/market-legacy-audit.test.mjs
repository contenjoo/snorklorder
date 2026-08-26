import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MARKET_LEGACY_AUDIT_MAX_ORDER_NUMBER_LENGTH,
  MARKET_LEGACY_AUDIT_STATUS_KEYS,
  hasMarketLegacyOrderNote,
  marketLegacyOrderNoteMarker,
  toMarketLegacyAuditResponse,
  validateMarketLegacyAuditOrderNumber,
} from "../src/lib/market-legacy-audit.ts";
import { authorizeMarketStatusRequest } from "../src/lib/market-status.ts";

test("legacy audit orderNumber는 공백 보정 없이 reference 1~200자만 허용한다", () => {
  assert.deepEqual(validateMarketLegacyAuditOrderNumber("ORD-20260825-ABCD"), {
    ok: true,
    value: "ORD-20260825-ABCD",
  });
  for (const value of [undefined, null, "", " ORD-1", "ORD 1", "한글", "A".repeat(201)]) {
    assert.equal(validateMarketLegacyAuditOrderNumber(value).ok, false);
  }
  assert.equal(validateMarketLegacyAuditOrderNumber("A".repeat(200)).ok, true);
  assert.equal(MARKET_LEGACY_AUDIT_MAX_ORDER_NUMBER_LENGTH, 200);
  assert.equal(marketLegacyOrderNoteMarker("ORD-1"), "/ 주문번호: ORD-1 /");
  assert.equal(hasMarketLegacyOrderNote("[자동] 회사몰 결제 완료 / 주문번호: ORD-1 / 결제금액: 1원"), true);
  assert.equal(hasMarketLegacyOrderNote("[자동 draft] 상품 / 주문번호: ORD-1 / 업그레이드: later"), true);
  assert.equal(hasMarketLegacyOrderNote("주문번호: ORD-1"), false);
});

test("legacy audit 응답은 주문번호·총계·고정 status 분포만 반환한다", () => {
  const response = toMarketLegacyAuditResponse("ORD-1", {
    legacyCount: "7",
    draft: 2,
    sent: 1,
    processed: 1,
    invoiced: 1,
    paid: 1,
    other: 1,
  });
  assert.deepEqual(Object.keys(response).sort(), ["legacyCount", "orderNumber", "statuses"]);
  assert.deepEqual(Object.keys(response.statuses), [...MARKET_LEGACY_AUDIT_STATUS_KEYS]);
  assert.equal(response.legacyCount, 7);
  assert.equal("schoolName" in response, false);
  assert.equal("emails" in response, false);
  assert.equal("notes" in response, false);
});

test("legacyCount=0은 exact notes 생존 행 0건일 뿐 과거 요청 부재 증거가 아니다", () => {
  const response = toMarketLegacyAuditResponse("ORD-1", undefined);
  assert.equal(response.legacyCount, 0);
  assert.deepEqual(response.statuses, {
    draft: 0,
    sent: 0,
    processed: 0,
    invoiced: 0,
    paid: 0,
    other: 0,
  });
});

test("legacy audit 인증은 키 미설정 503, 누락·불일치 401로 fail-closed한다", () => {
  assert.equal(authorizeMarketStatusRequest("present", undefined).status, 503);
  assert.equal(authorizeMarketStatusRequest(null, "configured").status, 401);
  assert.equal(authorizeMarketStatusRequest("wrong", "configured").status, 401);
  assert.deepEqual(authorizeMarketStatusRequest("configured", "configured"), { ok: true });
});

test("legacy audit Route Handler는 aggregate-only·API-key-only·no-store GET이다", async () => {
  const route = await readFile(
    new URL("../src/app/api/account-requests/market-legacy-audit/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(route, /authorizeMarketStatusRequest/);
  assert.match(route, /x-api-key/);
  assert.match(route, /INTEGRATION_API_KEY/);
  assert.doesNotMatch(route, /checkAuth|cookies\(/);
  assert.match(route, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(route, /getAll\("orderNumber"\)/);
  assert.match(route, /queryKeys\.length !== 1/);
  assert.match(route, /eq\(accountRequests\.channel, "company"\)/);
  assert.match(route, /POSITION\(\$\{noteMarker\} IN \$\{accountRequests\.notes\}\) > 0/);
  assert.match(route, /isNull\(accountRequests\.marketRequestId\)/);
  assert.match(route, /isNull\(accountRequests\.marketOrderId\)/);
  assert.match(route, /isNull\(accountRequests\.orderNumber\)/);
  assert.match(route, /isNull\(accountRequests\.idempotencyKey\)/);
  assert.match(route, /eq\(accountRequests\.draftOnly, false\)/);
  assert.doesNotMatch(route, /accountRequests\.(?:schoolName|schoolNameEn|emails|invoiceNumber|invoiceAmount|paymentLink|confirmToken)/);
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(/);
});

test("Proxy는 legacy audit exact GET만 API-key 라우트로 통과시킨다", async () => {
  const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.match(
    proxy,
    /pathname === "\/api\/account-requests\/market-legacy-audit" && request\.method === "GET"/,
  );
  assert.doesNotMatch(proxy, /startsWith\("\/api\/account-requests\/market-legacy-audit/);
});

test("account-requests route는 stale API-key/admin writer를 409로 막고 public notes는 저장하지 않는다", async () => {
  const route = await readFile(
    new URL("../src/app/api/account-requests/route.ts", import.meta.url),
    "utf8",
  );
  const createBranch = route.slice(
    route.indexOf('if (action === "create")'),
    route.indexOf('if (action === "update"'),
  );
  assert.match(createBranch, /hasMarketLegacyOrderNote\(data\.notes\)/);
  assert.match(route, /code: "MARKET_LEGACY_IDENTITY_REQUIRED"/);
  assert.match(route, /\}, \{ status: 409 \}\)/);
  assert.ok(
    createBranch.indexOf("hasMarketLegacyOrderNote(data.notes)")
      < createBranch.indexOf("Strict Market identity envelope is required"),
  );
  assert.match(createBranch, /const normalizedNotes = isAuthenticated && typeof data\.notes === "string"/);

  const updateBranch = route.slice(
    route.indexOf('if (action === "update"'),
    route.indexOf('if (action === "delete"'),
  );
  assert.match(updateBranch, /hasMarketLegacyOrderNote\(prev\.notes\)/);
  assert.match(updateBranch, /hasMarketLegacyOrderNote\(updates\.notes\)/);
  const deleteBranch = route.slice(route.indexOf('if (action === "delete"'));
  assert.match(deleteBranch, /MARKET_LEGACY_REQUEST_DELETE_BLOCKED/);
  assert.match(deleteBranch, /hasMarketLegacyOrderNote\(existing\.notes\)/);
});

test("0017 DB trigger가 post-cutover non-strict marker INSERT/UPDATE와 기존 행 DELETE를 영구 차단한다", async () => {
  const migration = await readFile(
    new URL("../drizzle/0017_add_market_order_void_fence.sql", import.meta.url),
    "utf8",
  );
  const triggerStart = migration.indexOf('CREATE OR REPLACE FUNCTION "guard_market_account_request_write"');
  const transitionStart = migration.indexOf('CREATE OR REPLACE FUNCTION "transition_market_order_void"');
  const trigger = migration.slice(triggerStart, transitionStart);
  assert.match(trigger, /TG_OP = 'DELETE'[\s\S]*MARKET_LEGACY_REQUEST_DELETE_BLOCKED/);
  assert.match(trigger, /NEW\."external_source" IS DISTINCT FROM 'market'/);
  assert.match(trigger, /NEW\."notes" ~ '\/ 주문번호:/);
  assert.match(trigger, /OLD\."notes" ~ '\/ 주문번호:/);
  assert.equal((trigger.match(/MARKET_LEGACY_IDENTITY_REQUIRED/g) || []).length, 2);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE/);
  assert.ok(triggerStart > 0 && triggerStart < transitionStart);
});
