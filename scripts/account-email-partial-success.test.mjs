import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getAccountEmailDeliveryState,
  invoiceDeliveryFailureMessage,
  isValidAccountEmailRequestId,
  parseAccountEmailSendMode,
} from "../src/lib/account-email-delivery.ts";

test("Jon과 Cailie 발송 상태에 unknown claim 경계를 포함한다", () => {
  assert.equal(getAccountEmailDeliveryState({
    status: "draft",
    needsInvoice: true,
    processingEmailSendStartedAt: null,
    processingEmailSentAt: null,
    invoiceEmailSendStartedAt: null,
    invoiceEmailSentAt: null,
  }), "ready");
  assert.equal(getAccountEmailDeliveryState({
    status: "draft",
    needsInvoice: true,
    processingEmailSendStartedAt: "2026-08-23T00:00:00.000Z",
    processingEmailSentAt: null,
    invoiceEmailSendStartedAt: null,
    invoiceEmailSentAt: null,
  }), "processing_unknown");
  assert.equal(getAccountEmailDeliveryState({
    status: "sent",
    needsInvoice: true,
    processingEmailSendStartedAt: null,
    processingEmailSentAt: "2026-08-23T00:00:00.000Z",
    invoiceEmailSendStartedAt: null,
    invoiceEmailSentAt: null,
  }), "invoice_retry");
  assert.equal(getAccountEmailDeliveryState({
    status: "sent",
    needsInvoice: true,
    processingEmailSendStartedAt: null,
    processingEmailSentAt: "2026-08-23T00:00:00.000Z",
    invoiceEmailSendStartedAt: "2026-08-23T00:01:00.000Z",
    invoiceEmailSentAt: null,
  }), "invoice_unknown");
  assert.equal(getAccountEmailDeliveryState({
    status: "invoiced",
    needsInvoice: true,
    processingEmailSendStartedAt: null,
    processingEmailSentAt: "2026-08-23T00:00:00.000Z",
    invoiceEmailSendStartedAt: null,
    invoiceEmailSentAt: "2026-08-23T00:01:00.000Z",
  }), "complete");
  assert.equal(getAccountEmailDeliveryState({
    status: "processed",
    needsInvoice: false,
    processingEmailSendStartedAt: null,
    processingEmailSentAt: "2026-08-23T00:00:00.000Z",
    invoiceEmailSendStartedAt: null,
    invoiceEmailSentAt: null,
  }), "complete");
  for (const status of ["sent", "processed", "invoiced", "paid"]) {
    assert.equal(getAccountEmailDeliveryState({
      status,
      needsInvoice: true,
      processingEmailSendStartedAt: null,
      processingEmailSentAt: null,
      invoiceEmailSendStartedAt: null,
      invoiceEmailSentAt: null,
    }), "legacy_complete");
  }
  assert.equal(parseAccountEmailSendMode(undefined), "send_all");
  assert.equal(parseAccountEmailSendMode("invoice_only"), "invoice_only");
  assert.equal(parseAccountEmailSendMode("invalid"), null);
  assert.equal(invoiceDeliveryFailureMessage(), "Cailie invoice email delivery failed");
  for (const invalid of [undefined, null, 0, -1, 1.5, "1"]) {
    assert.equal(isValidAccountEmailRequestId(invalid), false);
  }
  assert.equal(isValidAccountEmailRequestId(1), true);
});

test("0016은 부분 성공 상태를 nullable additive 필드로 보존한다", async () => {
  const schema = await readFile(new URL("../src/db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../drizzle/0016_add_account_email_delivery_state.sql", import.meta.url),
    "utf8",
  );

  for (const column of [
    "processing_email_send_started_at",
    "processing_email_sent_at",
    "invoice_email_send_started_at",
    "invoice_email_sent_at",
    "invoice_email_last_error",
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS "${column}"`));
  }
  assert.match(schema, /processingEmailSendStartedAt: timestamp\("processing_email_send_started_at"\)/);
  assert.match(schema, /processingEmailSentAt: timestamp\("processing_email_sent_at"\)/);
  assert.match(schema, /invoiceEmailSendStartedAt: timestamp\("invoice_email_send_started_at"\)/);
  assert.match(schema, /invoiceEmailSentAt: timestamp\("invoice_email_sent_at"\)/);
  assert.match(schema, /invoiceEmailLastError: text\("invoice_email_last_error"\)/);
});

test("단건 API는 Jon 성공을 먼저 기록하고 인보이스 실패를 부분 성공 오류로 반환한다", async () => {
  const route = await readFile(
    new URL("../src/app/api/account-email/route.ts", import.meta.url),
    "utf8",
  );
  const processingWrite = route.indexOf("processingEmailSentAt: sentAt");
  const invoiceSend = route.indexOf("to: HQ_INVOICE_TO");
  const requestIdGuard = route.indexOf("isValidAccountEmailRequestId(requestId)");
  const subjectGuard = route.indexOf('mode === "send_all" && (!subject || !body)');
  const transporterLookup = route.indexOf("const transporter = getTransporter()");

  assert.ok(processingWrite > 0 && invoiceSend > processingWrite);
  assert.ok(requestIdGuard > 0 && requestIdGuard < subjectGuard && requestIdGuard < transporterLookup);
  assert.match(route, /requestId must be a positive integer/);
  assert.match(route, /mode === "send_all" && deliveryState !== "ready"/);
  assert.match(route, /mode === "invoice_only" && deliveryState !== "invoice_retry"/);
  assert.match(route, /deliveryState === "legacy_complete"/);
  assert.match(route, /code: "LEGACY_EMAIL_DELIVERY_COMPLETE"/);
  assert.match(route, /legacyDeliveryBlocked: true/);
  assert.match(route, /code: "INVOICE_DELIVERY_FAILED"/);
  assert.match(route, /success: false,\s*partialSuccess: true/);
  assert.match(route, /invoiceRetryAvailable: true/);
  assert.match(route, /\}, \{ status: 502 \}\)/);
  assert.match(route, /processingEmailSendStartedAt: processingClaimedAt/);
  assert.match(route, /invoiceEmailSendStartedAt: invoiceClaimedAt/);
  assert.match(route, /isNull\(accountRequests\.processingEmailSendStartedAt\)/);
  assert.match(route, /eq\(accountRequests\.status, "draft"\)/);
  assert.match(route, /isNull\(accountRequests\.invoiceEmailSendStartedAt\)/);
  assert.match(route, /\.returning\(\{ id: accountRequests\.id \}\)/);
  assert.match(route, /code: "EMAIL_DELIVERY_UNKNOWN"/);
  assert.match(route, /failed to persist processing email success log/);
  assert.match(route, /failed to persist invoice email success log/);
  assert.match(route, /await transporter\.sendMail\(\{[\s\S]*?html:[\s\S]*?\n\s*\}\);\n\s*\} catch \{/);
  assert.match(route, /await transporter\.sendMail\(\{ from, to: HQ_INVOICE_TO, cc: HQ_EMAIL, subject: inv\.subject, text: inv\.body \}\);\n\s*\} catch \{/);
  assert.doesNotMatch(route, /catch \([^)]*inv[^)]*\)[\s\S]{0,500}success: true/);
});

test("배치 API도 Jon 중복을 차단하고 invoice_only 재시도만 허용한다", async () => {
  const route = await readFile(
    new URL("../src/app/api/account-email/batch/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /const blocked = deliveryStates\.filter\(\(item\) => item\.state !== "ready"\)/);
  assert.match(route, /item\.state === "legacy_complete"/);
  assert.match(route, /code: "LEGACY_EMAIL_DELIVERY_COMPLETE"/);
  assert.match(route, /legacyDeliveryBlocked: true/);
  assert.match(route, /eq\(accountRequests\.status, "draft"\)/);
  assert.match(route, /mode === "invoice_only" \|\| items\[index\]\.needsInvoice/);
  assert.match(route, /processingEmailSentAt: processingSentAt/);
  assert.match(route, /invoiceEmailSentAt: invoiceSentAt/);
  assert.match(route, /success: false,\s*partialSuccess: true/);
  assert.match(route, /processingEmailSendStartedAt: processingClaimedAt/);
  assert.match(route, /invoiceEmailSendStartedAt: invoiceClaimedAt/);
  assert.match(route, /code: "EMAIL_DELIVERY_UNKNOWN"/);
  assert.match(route, /failed to persist processing email success log/);
  assert.match(route, /failed to persist invoice email success log/);
  assert.match(route, /await transporter\.sendMail\(\{ from, to: HQ_EMAIL, subject, text: body \}\);\n\s*\} catch \{/);
  assert.match(route, /requestId: id,/);
});

test("관리자 UI는 부분 성공과 인보이스 전용 재시도를 명시한다", async () => {
  const page = await readFile(
    new URL("../src/app/admin/accounts/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /function needsInvoiceRetry/);
  assert.match(page, /async function retryInvoiceOnly/);
  assert.match(page, /mode: "invoice_only"/);
  assert.match(page, /부분 성공: Jon 처리 메일은 발송됐지만 Cailie 인보이스는 실패했습니다/);
  assert.match(page, /Cailie 인보이스만 재전송/);
  assert.match(page, /Jon 중복 발송 차단/);
  assert.match(page, /인보이스 재시도/);
  assert.match(page, /Gmail 보낸편지함 확인 필요/);
  assert.match(page, /자동 재시도 금지/);
  assert.match(page, /기존 발송 완료\/중복 발송 차단/);
  assert.match(page, /legacyDeliveryComplete/);
  assert.match(page, /legacyDeliveryBlocked/);
});
