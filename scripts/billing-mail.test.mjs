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

test("school backlog invoice preserves the complete cycle code and four school quantities", () => {
  const invoice = parseInvoicePdfText(`Invoice no.: 1158
Note to customer
Billing cycle: BACKLOG-2026-09-16-SCHOOLS
[#235] Muntae High School — School-wide upgrade
[#236] Asan Elementary School — School-wide upgrade
[#237] Samsung Girls' High School — School-wide upgrade
[#238] Hanam High School — School-wide upgrade
View and pay
Total $3200.00`);
  assert.equal(invoice.cycleCode, "BACKLOG-2026-09-16-SCHOOLS");
  assert.equal(invoice.totalCents, 320000);
  assert.deepEqual(invoice.requestItems, [235, 236, 237, 238].map(requestId => ({ requestId, quantity: 1 })));
  for (const code of ["BACKLOG-2026-09-16", "BACKLOG-2026-09-16-SCHOOLS-2", "2026-09-A", "2026-09-B"]) {
    assert.equal(parseInvoicePdfText(`Invoice no.: 1158\nNote to customer\nBilling cycle: ${code}\nTotal $3200.00`).cycleCode, code);
  }
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
    cycleCode: null,
    requestItems: [206, 203, 204, 205].map((requestId) => ({ requestId, quantity: 1 })),
    requestIds: [206, 203, 204, 205],
  });
});

test("parseInvoicePdfText: 인보이스가 아닌 PDF 는 null", () => {
  assert.equal(parseInvoicePdfText("Receipt\nThanks for your order [#1]"), null);
});

test("parseInvoicePdfText: 주기 코드·요청별 수량·중복 요청을 보존한다", () => {
  const parsed = parseInvoicePdfText(`
Invoice no.: 1200
Invoice date: 09/16/2026
Due date: 10/16/2026
Note to customer
Billing cycle: 2026-09-B
[#230] Asan Elementary School — Upgrade, 30 teacher accounts
[#231] Mirae High School — School-wide upgrade
[#231] Mirae High School — School-wide upgrade
Subtotal $2,560.00
Total $2,560.00`);
  assert.equal(parsed?.cycleCode, "2026-09-B");
  assert.deepEqual(parsed?.requestItems, [
    { requestId: 230, quantity: 30 },
    { requestId: 231, quantity: 1 },
    { requestId: 231, quantity: 1 },
  ]);
  assert.deepEqual(parsed?.requestIds, [230, 231]);
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

test("결제 기간 문구는 수량 파싱을 바꾸지 않고, 2년치는 배분에서 두 배를 받는다", () => {
  const inv = parseInvoicePdfText(`Invoice no.: 1170
Note to customer
Billing cycle: 2026-09-B
[#245] Changdong Middle School — Extension through 2028-03-31, 1 teacher account, 1-year license
[#246] Changdong Middle School — Extension through 2028-09-17, 1 teacher account, 2-
year license
[#247] Gusan Middle School — Upgrade, 2 teacher accounts, 2-year license
View and pay
Total $560.00`);
  assert.deepEqual(inv.requestItems, [
    { requestId: 245, quantity: 1 },
    { requestId: 246, quantity: 1 },
    { requestId: 247, quantity: 2 },
  ]);
  const plan = planInvoiceSync(inv, [row(245), row(246, { termYears: 2 }), row(247, { quantity: 2, termYears: 2 })]);
  assert.deepEqual(plan.apply.map((a) => a.invoiceAmount), ["$80.00", "$160.00", "$320.00"]);
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

// Invoice 1195 (2026-10-A) 실제 PDF 추출 텍스트 — 묶음형 메모, 주기 코드 없음, 메모가 금액 칸 뒤로 이어짐.
const INVOICE_1195 = `Invoice no.: 1195
Terms: Net 30
Invoice date: 10/16/2026
Due date: 11/15/2026
# Date Product or service Description Qty Rate Amount
1. Snorkl Premium School Access 1 $1,000.00 $1,000.00
2. Teacher Premium Snorkl Accounts 34 $100.00 $3,400.00
Ways to pay
Note to customer
Summary — 31 requests, all 1-year licenses
Teacher accounts: 34 (33 new upgrades + 1 extension)
School-wide license: 1 school
Teacher upgrades — 33 accounts
Bumyeong Middle School — 1 [#252]
Hwaryeong High School — 1 [#253]
Hakseong Middle School — 1 [#254]
Galmoe Middle School — 1 [#255]
Miseong Elementary School — 1 [#257]
Sejong High School — 5 [#258]
Gaehyeon Elementary School — 1 [#259]
Beopseong High School — 1 [#260]
Yeonyang Elementary School — 1 [#261]
Yeon-eun Elementary School — 1 [#262]
Jochiwon Middle School — 1 [#263]
Geumho Middle School — 1 [#265]
Onam Middle School — 1 [#266]
Hyoyang Middle School — 1 [#267]
Unyang Middle School — 1 [#268]
Unyu Elementary School — 2 [#269, #270]
Mokdong Middle School — 1 [#271]
Chowol Middle School — 2 [#272, #273]
Isol High School — 8 [#274–#281]
Seonbu Middle School — 1 [#282]
Teacher extension — 1 account
Garam Middle School — 1, through 2027-10-21 [#256]
School-wide upgrade — 1 school
Subtotal $4,400.00
Discount 20% -$880.00
Total $3,520.00
Gyeonggi Creative High School [#264]
View and pay`;

test("parseInvoicePdfText: 묶음형 메모(수량 앞·번호 나열·범위·다음 쪽 학교 단위)를 요청별로 읽는다", () => {
  const inv = parseInvoicePdfText(INVOICE_1195);
  assert.equal(inv.invoiceNumber, "1195");
  assert.equal(inv.totalCents, 352000);
  assert.equal(inv.cycleCode, null);
  assert.deepEqual([...inv.requestIds].sort((a, b) => a - b), Array.from({ length: 31 }, (_, i) => 252 + i));
  const qty = Object.fromEntries(inv.requestItems.map((item) => [item.requestId, item.quantity]));
  assert.equal(qty[258], 5);
  assert.equal(qty[269], 1); assert.equal(qty[270], 1);
  for (let id = 274; id <= 281; id++) assert.equal(qty[id], 1);
  assert.equal(qty[256], 1); // 연장 — "1, through 2027-10-21"
  assert.equal(qty[264], 1); // 학교 단위 구간, 수량 표기 없음
  assert.equal(inv.requestItems.reduce((sum, item) => sum + item.quantity, 0), 35);
});

test("parseInvoicePdfText: 메모에 주기 코드가 없으면 메일 제목에서 찾는다", () => {
  assert.equal(parseInvoicePdfText(INVOICE_1195, { subject: "Re: [Snorkl] Invoice Batch 2026-10-A — 31 requests" }).cycleCode, "2026-10-A");
});

test("parseInvoicePdfText: 묶음 수량이 번호 수와 다르면 나누지 않고 null 로 남긴다", () => {
  const inv = parseInvoicePdfText(`Invoice no.: 1300
Note to customer
Teacher upgrades — 5 accounts
X School — 5 [#10, #11]
Total $400.00`);
  assert.deepEqual(inv.requestItems, [{ requestId: 10, quantity: null }, { requestId: 11, quantity: null }]);
});
