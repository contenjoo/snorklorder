import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("new school billing migration links at most one account request per school", () => {
  const sql = read("../drizzle/0025_school_billing_request.sql");
  assert.match(sql, /ALTER TABLE schools/);
  assert.match(sql, /REFERENCES account_requests\(id\) ON DELETE SET NULL/);
  assert.match(sql, /schools_billing_account_request_unique_idx/);
  assert.match(sql, /WHERE billing_account_request_id IS NOT NULL/);
});

test("payment-required approval creates one school billing draft per school, atomically", () => {
  const route = read("../src/app/api/admin/verify-teacher/route.ts");
  assert.match(route, /checkAuth/);
  assert.match(route, /headers\.get\("origin"\).*nextUrl\.origin/);
  assert.match(route, /withBillingTransaction/);
  assert.doesNotMatch(route, /db\.transaction/);
  assert.match(route, /\.for\("update"\)/);
  assert.match(route, /school\.billingAccountRequestId/);
  assert.match(route, /isNull\(schools\.billingAccountRequestId\)/);
  assert.match(route, /accountType: "school"/);
  assert.match(route, /needsInvoice: true/);
  assert.match(route, /status: "draft"/);
  assert.match(route, /New school/);
  // 신규 학교 교사는 청구 요청으로 Jon 에게 가므로 일반 발송 대기에서 빠진다.
  assert.match(route, /set\(\{ status: "sent" \}\)/);
  assert.doesNotMatch(route, /sendMail|sendAccount|sendBilling|sendBatch/);
});

test("approval queue offers a payment-required checkbox only before the school is billed", () => {
  const page = read("../src/app/admin/page.tsx");
  const summary = read("../src/app/api/admin/summary/route.ts");
  assert.match(summary, /schoolBillingAccountRequestId: schools\.billingAccountRequestId/);
  assert.match(page, /결제 필요/);
  assert.match(page, /paymentRequiredIds/);
  assert.match(page, /teacher\.schoolBillingAccountRequestId \?/);
  assert.match(page, /\/admin\/accounts\?focus=\$\{teacher\.schoolBillingAccountRequestId\}/);
});
