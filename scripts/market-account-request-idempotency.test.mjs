import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MARKET_DRAFT_DELIVERY_MODE,
  MARKET_MAX_QUANTITY,
  classifyMarketReplay,
  containsMarketIdentity,
  hashMarketPayload,
  validateLegacyMarketDraft,
  validateMarketEnvelope,
  validateMarketQuantity,
} from "../src/lib/market-account-request.ts";
import {
  isStripeClaimableStatus,
  isStripeMessageAlreadyClaimed,
  isUniqueConstraintViolation,
} from "../src/lib/stripe-sync-claim.ts";

const validEnvelope = {
  externalSource: "market",
  marketRequestId: "req_123",
  marketOrderId: "order_123",
  orderNumber: "ORD-20260823-ABCD",
  idempotencyKey: "market:order_123:snorkl:teacher",
  draftOnly: true,
  status: "draft",
};

test("market 초안 계약만 허용한다", () => {
  assert.equal(validateMarketEnvelope(validEnvelope).ok, true);
  assert.equal(validateMarketEnvelope({ ...validEnvelope, draftOnly: false }).ok, false);
  assert.equal(validateMarketEnvelope({ ...validEnvelope, status: "sent" }).ok, false);
  assert.equal(validateMarketEnvelope({ ...validEnvelope, externalSource: "other" }).ok, false);
  assert.equal(validateMarketEnvelope({ ...validEnvelope, marketOrderId: "" }).ok, false);
  assert.equal(MARKET_DRAFT_DELIVERY_MODE, "manual_only");
});

test("market 수량 계약은 51과 1000을 허용하고 1001을 거절한다", () => {
  assert.deepEqual(validateMarketQuantity(51), { ok: true, value: 51 });
  assert.deepEqual(validateMarketQuantity("1000"), { ok: true, value: 1000 });
  assert.equal(validateMarketQuantity(1001).ok, false);
  assert.equal(validateMarketQuantity(0).ok, false);
  assert.equal(MARKET_MAX_QUANTITY, 1000);
});

test("식별자 없는 기존 market 호출만 임시 draft-only로 허용한다", () => {
  assert.equal(containsMarketIdentity({ status: "draft" }), false);
  assert.equal(validateLegacyMarketDraft({ status: "draft" }).ok, true);
  assert.equal(validateLegacyMarketDraft({}).ok, true);
  assert.equal(validateLegacyMarketDraft({ status: "sent" }).ok, false);
  assert.equal(containsMarketIdentity({ marketOrderId: "order_123" }), true);
  assert.equal(validateMarketEnvelope({ marketOrderId: "order_123" }).ok, false);
});

test("동일 payload는 키 순서와 무관하게 같은 해시가 된다", () => {
  const first = hashMarketPayload({
    schoolName: "K-12 School",
    quantity: 2,
    emails: ["first@example.test", "second@example.test"],
  });
  const reordered = hashMarketPayload({
    emails: ["first@example.test", "second@example.test"],
    quantity: 2,
    schoolName: "K-12 School",
  });
  assert.equal(first, reordered);
  assert.equal(classifyMarketReplay(first, reordered), "duplicate");
});

test("같은 멱등키의 내용이 달라지면 충돌로 분류한다", () => {
  const first = hashMarketPayload({ quantity: 1, requestType: "upgrade" });
  const changed = hashMarketPayload({ quantity: 2, requestType: "upgrade" });
  assert.equal(classifyMarketReplay(first, changed), "conflict");
  assert.equal(classifyMarketReplay(null, changed), "conflict");
});

test("market 수신 Route Handler는 자동 메일 모듈을 호출하지 않는다", async () => {
  const source = await readFile(
    new URL("../src/app/api/account-requests/route.ts", import.meta.url),
    "utf8",
  );
  const createBranch = source.slice(
    source.indexOf('if (action === "create")'),
    source.indexOf('if (action === "update"'),
  );
  assert.doesNotMatch(createBranch, /sendAccount|sendEmail|account-email/);
  assert.match(createBranch, /MARKET_DRAFT_DELIVERY_MODE/);
  assert.match(createBranch, /legacy draft-only request accepted without idempotency metadata/);
});

test("teacher-reg가 공급사 Stripe 자동 동기화 원장을 유지한다", async () => {
  const config = JSON.parse(
    await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
  );
  const stripeCron = config.crons.find(
    (cron) => cron.path === "/api/cron/sync-stripe",
  );
  assert.deepEqual(stripeCron, {
    path: "/api/cron/sync-stripe",
    schedule: "50 23 * * *",
  });
});

test("Stripe 메시지는 종류별 상태와 메시지 ID로 독립 선점한다", () => {
  const rows = [{
    status: "invoiced",
    invoiceGmailMessageId: "invoice-message-1",
    receiptGmailMessageId: null,
  }];

  assert.equal(isStripeMessageAlreadyClaimed("invoice", "invoice-message-1", rows), true);
  assert.equal(isStripeMessageAlreadyClaimed("receipt", "receipt-message-1", rows), false);
  assert.equal(isStripeClaimableStatus("invoice", "sent"), true);
  assert.equal(isStripeClaimableStatus("invoice", "processed"), true);
  assert.equal(isStripeClaimableStatus("invoice", "invoiced"), false);
  assert.equal(isStripeClaimableStatus("receipt", "invoiced"), true);
  assert.equal(isStripeClaimableStatus("receipt", "paid"), false);
  assert.equal(isUniqueConstraintViolation({ code: "23505" }), true);
  assert.equal(isUniqueConstraintViolation({ cause: { code: "23505" } }), true);
  assert.equal(isUniqueConstraintViolation({ code: "OTHER" }), false);
});

test("Stripe Route Handler가 CAS 성공 후에만 동기화하며 PII를 로그에 넣지 않는다", async () => {
  const route = await readFile(
    new URL("../src/app/api/cron/sync-stripe/route.ts", import.meta.url),
    "utf8",
  );
  const schema = await readFile(new URL("../src/db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../drizzle/0015_add_stripe_message_claims.sql", import.meta.url),
    "utf8",
  );

  assert.match(route, /inArray\(accountRequests\.status, \["sent", "processed"\]\)/);
  assert.match(route, /eq\(accountRequests\.status, "invoiced"\)/);
  assert.match(route, /isNull\(accountRequests\.invoiceGmailMessageId\)/);
  assert.match(route, /isNull\(accountRequests\.receiptGmailMessageId\)/);
  assert.equal(route.match(/\.returning\(\{ id: accountRequests\.id \}\)/g)?.length, 2);
  assert.match(route, /if \(claimed\.length === 0\)/);
  assert.equal(route.match(/if \(dryRun\) \{\s*wouldSync\+\+;\s*\} else \{\s*synced\+\+;/g)?.length, 2);
  assert.doesNotMatch(route, /console\.(?:warn|error)\(`[^`]*\$\{/);

  assert.match(schema, /invoiceGmailMessageId: text\("invoice_gmail_message_id"\)/);
  assert.match(schema, /receiptGmailMessageId: text\("receipt_gmail_message_id"\)/);
  assert.match(migration, /UNIQUE INDEX[^;]+invoice_gmail_message_id/s);
  assert.match(migration, /UNIQUE INDEX[^;]+receipt_gmail_message_id/s);
  assert.doesNotMatch(migration, /UNIQUE INDEX[^;]+gmail_thread_id/s);
});
