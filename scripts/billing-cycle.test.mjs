import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  billingWindowAt,
  billingCycleExpectedAmount,
  buildBillingCycleEmail,
  compareFrozenBillingItems,
  formatRequestIds,
} from "../src/lib/billing-cycle.ts";

test("KST 1일·16일 09:00 경계에서 A/B 주기를 정확히 전환한다", () => {
  assert.equal(billingWindowAt(new Date("2026-09-01T00:00:00Z")).code, "2026-09-A");
  assert.equal(billingWindowAt(new Date("2026-09-15T23:59:59Z")).code, "2026-09-A");
  assert.equal(billingWindowAt(new Date("2026-09-16T00:00:00Z")).code, "2026-09-B");
  assert.equal(billingWindowAt(new Date("2026-09-30T23:59:59Z")).code, "2026-09-B");
  assert.equal(billingWindowAt(new Date("2026-10-01T00:00:00Z")).code, "2026-10-A");
});

test("통합 메일은 주기 코드와 모든 요청번호·영문 학교명을 종류별로 묶어 포함한다", () => {
  const email = buildBillingCycleEmail("2026-09-A", [
    { requestId: 230, schoolNameEn: "Asan Elementary School", requestType: "upgrade", accountType: "teacher", quantity: 30, extensionDate: null },
    { requestId: 231, schoolNameEn: "Mirae High School", requestType: "extension", accountType: "teacher", quantity: 2, extensionDate: "2027-09-01", termYears: 2 },
  ], "https://example.test/invoice?k=token");
  assert.equal(email.subject, "[Snorkl] Invoice Batch 2026-09-A — 2 requests");
  assert.match(email.body, /Summary — Billing cycle 2026-09-A, 2 requests, 1- and 2-year licenses/);
  assert.match(email.body, /Teacher upgrades — 30 accounts\n- Asan Elementary School — 30, 1-year \[#230\]/);
  assert.match(email.body, /Teacher extensions — 2 accounts\n- Mirae High School — 2, through 2027-09-01, 2-year \[#231\]/);
  assert.match(email.body, /including the billing cycle code and each \[#request\] reference, into the invoice note/);
  assert.match(email.body, /https:\/\/example\.test\/invoice\?k=token/);
});

test("같은 학교는 한 줄로 합치고 3건 이상 연속 번호만 범위로 줄인다", () => {
  assert.equal(formatRequestIds([281, 274, 275, 276, 277, 278, 279, 280]), "[#274–#281]");
  assert.equal(formatRequestIds([269, 270]), "[#269, #270]");
  assert.equal(formatRequestIds([1, 2, 3, 7]), "[#1–#3, #7]");
  const items = [272, 273].map((requestId) => ({ requestId, schoolNameEn: "Chowol Middle School", requestType: "upgrade", accountType: "teacher", quantity: 1, extensionDate: null, termYears: 1 }));
  const body = buildBillingCycleEmail("2026-10-A", items, null).body;
  assert.match(body, /- Chowol Middle School — 2 \[#272, #273\]/);
  assert.match(body, /all 1-year licenses/);
  // 요약만 인보이스 메모에 옮겨도 자동 대조가 주기를 찾는다(billing-mail 의 주기 코드 패턴).
  const summaryFirstLine = body.split("\n").find((line) => line.startsWith("Summary —"));
  assert.match(summaryFirstLine, /Billing\s+cycle\s*:?\s*2026-10-A\b/);
});

test("예상 금액은 교사 $100·학교 $1,000 정가에 20% 할인, 2년은 두 배", () => {
  const item = (requestId, accountType, quantity, termYears = 1, requestType = "upgrade") =>
    ({ requestId, schoolNameEn: "X School", requestType, accountType, quantity, extensionDate: null, termYears });
  // 2026-10-A 실제 묶음: 교사 34계정(연장 1 포함) + 학교 단위 1곳
  const batch = [...Array.from({ length: 28 }, (_, i) => item(i + 1, "teacher", 1)), item(29, "teacher", 5), item(30, "teacher", 1, 1, "extension"), item(31, "school", 1)];
  const amount = billingCycleExpectedAmount(batch);
  assert.deepEqual(amount.rows.map((r) => [r.label, r.list, r.net, r.qty, r.subtotal]), [
    ["Teacher account (1-year)", 100, 80, 34, 2720],
    ["School-wide (1-year)", 1000, 800, 1, 800],
  ]);
  assert.equal(amount.total, 3520);
  assert.equal(amount.listTotal, 4400);
  assert.equal(amount.discount, 880);
  const body = buildBillingCycleEmail("2026-10-A", batch, null).body;
  assert.match(body, /- Teacher account \(1-year\): \$100 → \$80 after 20% off × 34 = \$2,720/);
  assert.match(body, /- Total: \$3,520 \(list \$4,400 − 20% \$880\)/);

  const twoYear = billingCycleExpectedAmount([item(1, "teacher", 3, 2), item(2, "school", 1, 2)]);
  assert.deepEqual(twoYear.rows.map((r) => [r.label, r.net, r.subtotal]), [["Teacher account (2-year)", 160, 480], ["School-wide (2-year)", 1600, 1600]]);

  // 단가가 없는 학생 계정이 섞이면 금액을 추정하지 않는다
  assert.equal(billingCycleExpectedAmount([item(1, "student", 10)]), null);
  assert.match(buildBillingCycleEmail("2026-10-A", [item(1, "student", 10)], null).body, /Expected amount — not included/);
});

test("0024는 결제 기간을 1·2년으로 제한하고 기존 행을 1년으로 둔다", () => {
  const sql = readFileSync(new URL("../drizzle/0024_term_years.sql", import.meta.url), "utf8");
  for (const table of ["account_requests", "billing_cycle_items"]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table}\\s+ADD COLUMN IF NOT EXISTS term_years integer NOT NULL DEFAULT 1`));
    assert.match(sql, new RegExp(`${table}_term_years_check CHECK \\(term_years IN \\(1, 2\\)\\)`));
  }
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
