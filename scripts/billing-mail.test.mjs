import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInvoicePdfText,
  parseQuickBooksPaymentText,
  planInvoiceSync,
  planPaymentSync,
  usDateToIso,
} from "../src/lib/billing-mail.ts";

// 실제 Invoice 1116.pdf (unpdf extractText) 텍스트 — 형식이 바뀌면 이 테스트가 먼저 깨져야 한다.
const INVOICE_1116 = `INVOICE
Snorkl, Inc.
5383 Balboa Ave
San Diego, CA 92117-6913
ar@snorkl.app
Bill to
Learn Today
Invoice details
Invoice no.: 1116
Terms: Net 30
Invoice date: 09/01/2026
Due date: 10/01/2026
# Date Product or service Description Qty Rate Amount
1. Teacher Premium Snorkl Accounts 4 $100.00 $400.00
Ways to pay
Note to customer
NEW [#206] Yedeok Elementary School — Upgrade, 1 teacher
account
[#203] Gwangil High School — Upgrade, 1 teacher account
[#204] Bongeun Middle School — Upgrade, 1 teacher account
[#205] Yeongran Girls’ Middle School — Upgrade, 1 teacher account
View and pay
Subtotal $400.00
Discount 20% -$80.00
Total $320.00
`;

// 실제 QuickBooks 결제 확인 메일 text 파트 (링크는 생략)
const PAYMENT_1116 = `Intuit QuickBooks [https://offcnt.intuit.com/images/quickbooks_logo.png]https://elink.prd.intuit.com/x Manage payment You paid $320.00 to Snorkl, Inc. on 09/01/2026 Payment details Invoice no. 1116 Invoice amount $320.00 Total amount $320.00 Status Paid Payment method MASTERCARD****6135 Authorization ID 13ag04nuvh6a Please don't reply to this email`;
const PAYMENT_1090_PARTIAL = `Intuit QuickBooks Manage payment You paid $320.00 to Snorkl, Inc. on 08/26/2026 Payment details Invoice no. 1090 Invoice amount $480.00 Total amount $320.00 Status Paid Payment method xxxxxxxxxxxx6135 Authorization ID 18af3d8u5o0g`;

const row = (id, over = {}) => ({
  id, status: "processed", invoiceNumber: null, invoiceAmount: null, quantity: 1, marketVoidState: "active", ...over,
});

test("usDateToIso: 미국 날짜 → ISO", () => {
  assert.equal(usDateToIso("09/01/2026"), "2026-09-01");
  assert.equal(usDateToIso("9/1/2026"), "2026-09-01");
  assert.equal(usDateToIso("2026-09-01"), null);
  assert.equal(usDateToIso(""), null);
});

test("parseInvoicePdfText: 번호·날짜·총액(Subtotal 제외)·[#id] 등장 순", () => {
  const inv = parseInvoicePdfText(INVOICE_1116);
  assert.deepEqual(inv, {
    invoiceNumber: "1116",
    invoiceDate: "2026-09-01",
    dueDate: "2026-10-01",
    totalCents: 32000,
    requestIds: [206, 203, 204, 205],
  });
});

test("parseInvoicePdfText: 인보이스가 아닌 PDF 는 null", () => {
  assert.equal(parseInvoicePdfText("Receipt\nThanks for your order [#1]"), null);
});

test("parseQuickBooksPaymentText: 전액 결제", () => {
  assert.deepEqual(parseQuickBooksPaymentText(PAYMENT_1116, "Payment confirmation: Invoice #1116-(Snorkl, Inc.)"), {
    invoiceNumber: "1116",
    paidCents: 32000,
    invoiceCents: 32000,
    paidOn: "2026-09-01",
    paymentMethod: "MASTERCARD ••6135",
  });
});

test("parseQuickBooksPaymentText: 부분 결제는 Total amount(실결제) 를 쓴다", () => {
  const p = parseQuickBooksPaymentText(PAYMENT_1090_PARTIAL);
  assert.equal(p.paidCents, 32000);
  assert.equal(p.invoiceCents, 48000);
  assert.equal(p.paymentMethod, "card ••6135");
});

test("parseQuickBooksPaymentText: Snorkl 이 아닌 거래처의 QuickBooks 메일은 무시", () => {
  const other = "You paid $50.00 to Acme LLC on 09/01/2026 Payment details Invoice no. 42 Total amount $50.00";
  assert.equal(parseQuickBooksPaymentText(other, "Payment confirmation: Invoice #42-(Acme LLC)"), null);
});

test("planInvoiceSync: 계정 수 비례 배분, 합계 = 총액", () => {
  const inv = parseInvoicePdfText(INVOICE_1116);
  const plan = planInvoiceSync(inv, [row(203), row(204), row(205), row(206)]);
  assert.equal(plan.kind, "apply");
  assert.deepEqual(plan.apply.map((a) => a.id), [206, 203, 204, 205]);
  assert.ok(plan.apply.every((a) => a.invoiceAmount === "$80.00"));

  // 5계정 $400 = 1+2+2 배분 (실제 inv 1101)
  const inv1101 = { invoiceNumber: "1101", invoiceDate: null, dueDate: null, totalCents: 40000, requestIds: [199, 197, 198] };
  const plan1101 = planInvoiceSync(inv1101, [row(199), row(197, { quantity: 2 }), row(198, { quantity: 2 })]);
  assert.deepEqual(plan1101.apply.map((a) => a.invoiceAmount), ["$80.00", "$160.00", "$160.00"]);
});

test("planInvoiceSync: 재실행은 already_synced, 다른 번호가 있으면 손대지 않는다", () => {
  const inv = parseInvoicePdfText(INVOICE_1116);
  const done = [203, 204, 205, 206].map((id) => row(id, { status: "invoiced", invoiceNumber: "1116", invoiceAmount: "$80.00" }));
  assert.equal(planInvoiceSync(inv, done).kind, "already_synced");

  const mixed = [row(203, { invoiceNumber: "1090", status: "invoiced" }), row(204), row(205), row(206)];
  const plan = planInvoiceSync(inv, mixed);
  assert.equal(plan.kind, "apply");
  assert.deepEqual(plan.apply.map((a) => a.id), [206, 204, 205]);
  assert.deepEqual(plan.skipped, [{ id: 203, reason: "다른 인보이스 1090 기록됨" }]);
});

test("planInvoiceSync: 요청이 없거나 상태가 맞지 않으면 unmatched", () => {
  const inv = parseInvoicePdfText(INVOICE_1116);
  assert.equal(planInvoiceSync(inv, [row(203), row(204), row(205)]).kind, "unmatched");
  const drafts = [203, 204, 205, 206].map((id) => row(id, { status: "draft" }));
  const plan = planInvoiceSync(inv, drafts);
  assert.equal(plan.kind, "unmatched");
  assert.match(plan.reason, /#206 상태 draft/);
});

test("planPaymentSync: 미결 청구 합 = 결제액일 때만 전부 paid", () => {
  const p = parseQuickBooksPaymentText(PAYMENT_1116);
  const rows = [203, 204, 205, 206].map((id) => row(id, { status: "invoiced", invoiceNumber: "1116", invoiceAmount: "$80.00" }));
  const plan = planPaymentSync(p, rows);
  assert.equal(plan.kind, "apply");
  assert.deepEqual(plan.ids, [203, 204, 205, 206]);

  // "#1116" 표기도 같은 번호로 본다
  rows[0].invoiceNumber = "#1116";
  assert.equal(planPaymentSync(p, rows).kind, "apply");
});

test("planPaymentSync: 부분 결제·번호 미기록·전부 paid", () => {
  const partial = parseQuickBooksPaymentText(PAYMENT_1090_PARTIAL);
  const rows1090 = [
    row(189, { status: "invoiced", invoiceNumber: "1090", invoiceAmount: "$80.00" }),
    row(190, { status: "invoiced", invoiceNumber: "1090", invoiceAmount: "$400.00", quantity: 5 }),
  ];
  const plan = planPaymentSync(partial, rows1090);
  assert.equal(plan.kind, "unmatched");
  assert.match(plan.reason, /결제 \$320\.00 ≠ 미결 청구 \$480\.00/);

  const p = parseQuickBooksPaymentText(PAYMENT_1116);
  assert.equal(planPaymentSync(p, []).kind, "unmatched");
  const paid = [row(203, { status: "paid", invoiceNumber: "1116", invoiceAmount: "$80.00" })];
  assert.equal(planPaymentSync(p, paid).kind, "already_synced");
});
