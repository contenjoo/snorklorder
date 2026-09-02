import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MARKET_STATUS_FIELDS,
  authorizeMarketStatusRequest,
  toMarketStatusItem,
} from "../src/lib/market-status.ts";

const FORBIDDEN_FIELDS = [
  "quantity",
  "accountType",
  "oldEmail",
  "fromType",
  "extensionDate",
  "notes",
  "needsInvoice",
  "invoiceNumber",
  "invoiceAmount",
  "invoiceDueDate",
  "paymentLink",
  "paymentDate",
  "paymentMethod",
  "invoiceGmailMessageId",
  "invoiceGmailThreadId",
  "receiptGmailMessageId",
  "receiptGmailThreadId",
  "processingEmailSendStartedAt",
  "invoiceEmailSendStartedAt",
  "invoiceEmailSentAt",
  "invoiceEmailLastError",
  "confirmToken",
  "externalPayloadHash",
  "draftOnly",
  "schoolNameEn",
  "createdAt",
];

test("INTEGRATION_API_KEY 미설정이면 키가 와도 503 integration not configured", () => {
  assert.deepEqual(authorizeMarketStatusRequest("any-key", undefined), {
    ok: false,
    status: 503,
    error: "integration not configured",
  });
  // 빈 문자열 키는 미설정으로 취급해 "" === "" 우회를 막는다
  assert.deepEqual(authorizeMarketStatusRequest("", ""), {
    ok: false,
    status: 503,
    error: "integration not configured",
  });
});

test("키 누락/불일치는 401이며 세션 폴백이 없다", () => {
  assert.deepEqual(authorizeMarketStatusRequest(null, "secret-key"), {
    ok: false,
    status: 401,
    error: "Unauthorized",
  });
  assert.deepEqual(authorizeMarketStatusRequest("", "secret-key"), {
    ok: false,
    status: 401,
    error: "Unauthorized",
  });
  assert.deepEqual(authorizeMarketStatusRequest("wrong-key", "secret-key"), {
    ok: false,
    status: 401,
    error: "Unauthorized",
  });
});

test("정상 키는 통과한다", () => {
  assert.deepEqual(authorizeMarketStatusRequest("secret-key", "secret-key"), { ok: true });
});

const fullRow = {
  // 화이트리스트 값
  id: 42,
  status: "invoiced",
  type: "upgrade",
  schoolName: "테스트초등학교",
  emails: "a@school.kr, b@school.kr",
  applicantType: "school",
  externalSource: "market",
  marketRequestId: "req_1",
  marketOrderId: "order_1",
  orderNumber: "ORD-20260823-ABCD",
  idempotencyKey: "market:order_1:snorkl:teacher",
  channel: "partner",
  partnerRequestId: "partner_request_1",
  partnerItemId: "partner_item_1",
  partnerRevision: 2,
  teacherName: "홍길동",
  subject: "수학",
  partnerLifecycleState: "active",
  confirmedAt: new Date("2026-08-24T00:02:00.000Z"),
  processingEmailSentAt: new Date("2026-08-24T00:01:30.000Z"),
  partnerNotificationSentAt: null,
  marketVoidState: "prepared",
  marketVoidOperationId: "cancel_order_1",
  marketVoidVersion: 3,
  marketVoidPreparedAt: new Date("2026-08-24T00:01:00.000Z"),
  marketVoidedAt: null,
  updatedAt: new Date("2026-08-24T00:00:00.000Z"),
  // 금지 필드 — DB 전체 행이 그대로 넘어와도 응답에 실리면 안 된다
  quantity: 30,
  accountType: "teacher",
  notes: "관리자 메모",
  oldEmail: "old@school.kr",
  needsInvoice: true,
  invoiceNumber: "INV-1",
  invoiceAmount: "1200000",
  invoiceDueDate: "2026-09-01",
  paymentLink: "https://pay.example.test/x",
  invoiceGmailMessageId: "gmail-msg-1",
  invoiceGmailThreadId: "gmail-thread-1",
  receiptGmailMessageId: "gmail-msg-2",
  confirmToken: "tok_secret",
  externalPayloadHash: "hash",
  draftOnly: true,
  schoolNameEn: "Test Elementary",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
};

test("응답 항목은 화이트리스트 필드만 포함한다 (금지 필드 부재)", () => {
  const item = toMarketStatusItem(fullRow);
  assert.deepEqual(Object.keys(item).sort(), [...MARKET_STATUS_FIELDS].sort());
  for (const forbidden of FORBIDDEN_FIELDS) {
    assert.equal(forbidden in item, false, `금지 필드가 응답에 포함됨: ${forbidden}`);
  }
  // market은 externalRequestId를 String(...)으로 저장하므로 id는 문자열 계약이다
  assert.equal(item.id, "42");
  assert.equal(item.status, "invoiced");
  assert.equal(item.marketVoidState, "prepared");
  assert.equal(item.marketVoidVersion, 3);
  assert.equal(item.marketVoidPreparedAt, "2026-08-24T00:01:00.000Z");
  assert.equal(item.marketVoidedAt, null);
  assert.equal(item.updatedAt, "2026-08-24T00:00:00.000Z");
});

test("null 가능 필드는 null 그대로, 문자열 updatedAt도 ISO8601로 정규화한다", () => {
  const item = toMarketStatusItem({
    ...fullRow,
    externalSource: null,
    marketRequestId: null,
    marketOrderId: null,
    orderNumber: null,
    idempotencyKey: null,
    updatedAt: "2026-08-24T01:02:03.000Z",
  });
  assert.equal(item.externalSource, null);
  assert.equal(item.marketRequestId, null);
  assert.equal(item.marketOrderId, null);
  assert.equal(item.orderNumber, null);
  assert.equal(item.idempotencyKey, null);
  assert.equal(item.updatedAt, "2026-08-24T01:02:03.000Z");
});

test("market-status Route Handler는 API 키 전용·읽기 전용이며 화이트리스트 컬럼만 참조한다", async () => {
  const route = await readFile(
    new URL("../src/app/api/account-requests/market-status/route.ts", import.meta.url),
    "utf8",
  );

  // 인증: x-api-key + INTEGRATION_API_KEY 판정 함수 사용, 세션 쿠키 폴백 없음
  assert.match(route, /authorizeMarketStatusRequest/);
  assert.match(route, /x-api-key/);
  assert.match(route, /INTEGRATION_API_KEY/);
  assert.doesNotMatch(route, /checkAuth/);

  // 읽기 전용: 쓰기 계열 쿼리 없음, GET 외 핸들러 없음
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);

  // 직렬화는 화이트리스트 복사 함수를 거친다
  assert.match(route, /toMarketStatusItem/);
  assert.match(route, /orderBy\(desc\(accountRequests\.updatedAt\)\)/);

  // 라우트가 참조하는 accountRequests 컬럼은 화이트리스트 안에만 있어야 한다.
  // operation/version은 fence SSOT에서 읽으므로 accountRequests 참조에는 없다.
  const referencedColumns = new Set(
    [...route.matchAll(/accountRequests\.([A-Za-z0-9]+)/g)].map((m) => m[1]),
  );
  for (const column of referencedColumns) {
    assert.ok(MARKET_STATUS_FIELDS.includes(column), `허용되지 않은 accountRequests 컬럼 참조: ${column}`);
  }
  assert.match(route, /eq\(accountRequests\.externalSource, "market"\)/);
  assert.match(route, /marketOrderId/);
  assert.match(route, /voidState/);
});

test("기존 관리자용 GET /api/account-requests 는 세션 인증 그대로다 (동작 불변)", async () => {
  const route = await readFile(
    new URL("../src/app/api/account-requests/route.ts", import.meta.url),
    "utf8",
  );
  const getBranch = route.slice(
    route.indexOf("export async function GET"),
    route.indexOf("export async function POST"),
  );
  assert.match(getBranch, /checkAuth/);
  assert.doesNotMatch(getBranch, /x-api-key/);
});

test("Proxy는 Market 기계 인증 경로를 정확한 메서드와 경로로만 통과시킨다", async () => {
  const proxy = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
  // 새 예외: 정확 경로 + GET 한정 (라우트 내부의 x-api-key 인증이 실제 게이트)
  assert.match(
    proxy,
    /pathname === "\/api\/account-requests\/market-status" && request\.method === "GET"/,
  );
  // 기존 market 수신 계약 불변: POST /api/account-requests 만 공개
  assert.match(proxy, /pathname === "\/api\/account-requests" && request\.method === "POST"/);
  assert.match(
    proxy,
    /pathname === "\/api\/account-requests\/market-void" && request\.method === "POST"/,
  );
  assert.match(
    proxy,
    /\^\\\/api\\\/account-requests\\\/market-partner\\\/\[\^\/\]\+\$\/\.test\(pathname\)/,
  );
  assert.match(proxy, /request\.method === "PUT"/);
  // prefix 개방 금지 — 관리자용 GET /api/account-requests 는 계속 세션 보호를 받는다
  assert.doesNotMatch(proxy, /startsWith\("\/api\/account-requests/);
});
