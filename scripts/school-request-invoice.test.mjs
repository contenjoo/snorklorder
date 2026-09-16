import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("school request billing migration links one account request and safely clears deleted drafts", () => {
  const sql = readFileSync(new URL("../drizzle/0022_school_request_invoice.sql", import.meta.url), "utf8");
  assert.match(sql, /REFERENCES account_requests\(id\) ON DELETE SET NULL/);
  assert.match(sql, /school_requests_account_request_unique_idx/);
  assert.match(sql, /WHERE account_request_id IS NOT NULL/);
});

test("school billing request creation is authenticated, same-origin, explicit, and idempotent", () => {
  const route = readFileSync(new URL("../src/app/api/school-requests/account-request/route.ts", import.meta.url), "utf8");
  assert.match(route, /checkAuth/);
  assert.match(route, /headers\.get\("origin"\).*nextUrl\.origin/);
  assert.match(route, /schoolRequest\.status !== "approved"/);
  assert.match(route, /schoolRequest\.accountRequestId/);
  assert.match(route, /\.for\("update"\)/);
  assert.match(route, /accountType: "school"/);
  assert.match(route, /needsInvoice: true/);
  assert.match(route, /status: "draft"/);
  assert.match(route, /isValidEmail/);
  assert.doesNotMatch(route, /sendMail|sendAccount|sendBilling/);
});

test("school request admin shows a deliberate billing action and the linked request", () => {
  const page = readFileSync(new URL("../src/app/admin/requests/page.tsx", import.meta.url), "utf8");
  assert.match(page, /계정·청구 요청 생성/);
  assert.match(page, /\/api\/school-requests\/account-request/);
  assert.match(page, /\/admin\/accounts\?focus=/);
});
