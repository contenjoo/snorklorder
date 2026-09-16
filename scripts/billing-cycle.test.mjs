import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  billingWindowAt,
  buildBillingCycleEmail,
  compareFrozenBillingItems,
} from "../src/lib/billing-cycle.ts";

test("KST 1일·16일 09:00 경계에서 A/B 주기를 정확히 전환한다", () => {
  assert.equal(billingWindowAt(new Date("2026-09-01T00:00:00Z")).code, "2026-09-A");
  assert.equal(billingWindowAt(new Date("2026-09-15T23:59:59Z")).code, "2026-09-A");
  assert.equal(billingWindowAt(new Date("2026-09-16T00:00:00Z")).code, "2026-09-B");
  assert.equal(billingWindowAt(new Date("2026-09-30T23:59:59Z")).code, "2026-09-B");
  assert.equal(billingWindowAt(new Date("2026-10-01T00:00:00Z")).code, "2026-10-A");
});

test("통합 메일은 주기 코드와 모든 요청번호·영문 학교명을 포함한다", () => {
  const email = buildBillingCycleEmail("2026-09-A", [
    { requestId: 230, schoolNameEn: "Asan Elementary School", requestType: "upgrade", accountType: "teacher", quantity: 30, extensionDate: null },
    { requestId: 231, schoolNameEn: "Mirae High School", requestType: "extension", accountType: "teacher", quantity: 2, extensionDate: "2027-09-01" },
  ], "https://example.test/invoice?k=token");
  assert.equal(email.subject, "[Snorkl] Invoice Batch 2026-09-A — 2 requests");
  assert.match(email.body, /\[#230\] Asan Elementary School/);
  assert.match(email.body, /\[#231\] Mirae High School/);
  assert.match(email.body, /https:\/\/example\.test\/invoice\?k=token/);
});

test("동결 목록은 누락·추가·중복·수량 차이를 모두 거절한다", () => {
  const expected = [{ requestId: 1, quantity: 2 }, { requestId: 2, quantity: 1 }];
  assert.deepEqual(compareFrozenBillingItems(expected, expected), { ok: true });
  for (const actual of [
    [{ requestId: 1, quantity: 2 }],
    [...expected, { requestId: 3, quantity: 1 }],
    [...expected, { requestId: 2, quantity: 1 }],
    [{ requestId: 1, quantity: 3 }, { requestId: 2, quantity: 1 }],
  ]) assert.equal(compareFrozenBillingItems(expected, actual).ok, false);
});

test("0021은 상태 제약·전역 중복 청구 방지·Gmail 멱등 키를 추가한다", () => {
  const sql = readFileSync(new URL("../drizzle/0021_billing_cycles.sql", import.meta.url), "utf8");
  assert.match(sql, /billing_cycles_status_check/);
  assert.match(sql, /billing_cycle_items_account_request_unique_idx/);
  assert.match(sql, /billing_cycles_invoice_gmail_message_id_unique_idx/);
  assert.match(sql, /billing_cycles_request_gmail_message_id_unique_idx/);
  assert.match(sql, /billing_cycles_receipt_gmail_message_id_unique_idx/);
  assert.match(sql, /billing_cycle_items_collecting_only/);
  assert.match(sql, /FOR KEY SHARE/);
});

test("공유 API는 토큰·no-store를 유지하고 교사 이메일을 직렬화하지 않는다", () => {
  const source = readFileSync(new URL("../src/app/api/invoice/route.ts", import.meta.url), "utf8");
  assert.match(source, /checkInvoiceViewToken/);
  assert.match(source, /Cache-Control.*no-store/);
  assert.doesNotMatch(source, /teacherEmail|emails:/);
});

test("관리자 발송 API는 인증·same-origin·ready 조건부 선점을 강제한다", () => {
  const route = readFileSync(new URL("../src/app/api/admin/billing-cycles/[id]/send/route.ts", import.meta.url), "utf8");
  const db = readFileSync(new URL("../src/lib/billing-cycle-db.ts", import.meta.url), "utf8");
  assert.match(route, /checkAuth/);
  assert.match(route, /headers\.get\("origin"\).*nextUrl\.origin/);
  assert.match(db, /eq\(billingCycles\.status, "ready"\)/);
  assert.match(db, /status: "send_unknown"/);
});
