import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvoiceEmail,
  invoiceLine,
  invoiceWhat,
  isOpenInvoiceRequest,
  mergeOpenInvoiceItems,
} from "../src/lib/account-email-template.ts";
import { checkInvoiceViewToken } from "../src/lib/invoice-token.ts";

const upgrade = (id, school, qty = 1) => ({
  requestId: id, schoolName: school, schoolNameEn: null,
  type: "upgrade", accountType: "teacher", quantity: qty, extensionDate: null,
});

test("청구 대기 판정은 needsInvoice·번호·상태·취소를 모두 본다", () => {
  const base = { needsInvoice: true, invoiceNumber: null, status: "sent", marketVoidState: "active" };

  assert.equal(isOpenInvoiceRequest(base), true);
  assert.equal(isOpenInvoiceRequest({ ...base, status: "processed" }), true);

  // 계정 정보 변경처럼 돈이 안 드는 건은 Cailie 목록에 뜨면 안 된다
  assert.equal(isOpenInvoiceRequest({ ...base, needsInvoice: false }), false);
  // 번호가 이미 있으면 끝난 것 (Stripe 자동 감지가 꺼진 동안 수동 선기입하는 경우)
  assert.equal(isOpenInvoiceRequest({ ...base, invoiceNumber: "#3D37-0120" }), false);
  // 아직 발송 전이거나 이미 청구가 끝난 상태
  assert.equal(isOpenInvoiceRequest({ ...base, status: "draft" }), false);
  assert.equal(isOpenInvoiceRequest({ ...base, status: "invoiced" }), false);
  assert.equal(isOpenInvoiceRequest({ ...base, status: "paid" }), false);
  // 취소 saga 진행/완료 건
  assert.equal(isOpenInvoiceRequest({ ...base, marketVoidState: "prepared" }), false);
  assert.equal(isOpenInvoiceRequest({ ...base, marketVoidState: "voided" }), false);
  // marketVoidState 가 아예 없는 구 행도 정상 판정되어야 한다
  assert.equal(isOpenInvoiceRequest({ needsInvoice: true, invoiceNumber: null, status: "sent" }), true);
});

test("병합은 중복을 없애고 새 건을 위로, 나머지는 오래된 순으로 세운다", () => {
  const { items, newIds } = mergeOpenInvoiceItems(
    [upgrade(194, "Bucheon Seonggok Middle School")],
    [upgrade(191, "Changmyeong"), upgrade(189, "Hakseong"), upgrade(194, "낡은 사본")],
  );

  assert.deepEqual(items.map((it) => it.requestId), [194, 189, 191]);
  assert.deepEqual([...newIds], [194]);
  // 같은 id 가 양쪽에 있으면 새 건 쪽 내용이 이긴다
  assert.equal(items[0].schoolName, "Bucheon Seonggok Middle School");
});

test("인보이스 메일은 남은 전체를 싣고 새 건만 NEW 로 표시한다", () => {
  const { items, newIds } = mergeOpenInvoiceItems(
    [upgrade(194, "Bucheon")],
    [upgrade(189, "Hakseong"), upgrade(190, "Yongsin", 5)],
  );
  const { subject, body } = buildInvoiceEmail(items, {
    newIds,
    viewUrl: "https://example.test/invoice?k=tok",
  });

  assert.equal(subject, "[Snorkl] Invoice Request — 3 open (1 new)");

  // 이 한 줄이 "이전 메일 뒤지지 마라"는 계약이다
  assert.match(body, /This list replaces my earlier emails/);

  const lines = body.split("\n");
  assert.ok(lines.some((l) => l === `NEW  ${invoiceLine(upgrade(194, "Bucheon"))}`));
  assert.ok(lines.some((l) => l === `     ${invoiceLine(upgrade(189, "Hakseong"))}`));
  // 오래된 건에 NEW 가 붙으면 안 된다
  assert.equal(lines.filter((l) => l.startsWith("NEW")).length, 1);

  assert.match(body, /https:\/\/example\.test\/invoice\?k=tok/);
  assert.match(body, /Jon is handling the account processing separately/);
});

test("전부 새 건이면 제목에 (new) 를 덧붙이지 않는다", () => {
  const items = [upgrade(1, "A"), upgrade(2, "B")];
  const { subject } = buildInvoiceEmail(items);
  assert.equal(subject, "[Snorkl] Invoice Request — 2 open");
});

test("링크가 없으면 안내 줄을 통째로 뺀다", () => {
  const { body } = buildInvoiceEmail([upgrade(1, "A")], { viewUrl: null });
  assert.doesNotMatch(body, /See the live list/);
  assert.doesNotMatch(body, /please ignore that line/);
});

test("남은 게 없으면 목록 대신 다 끝났다고 말한다", () => {
  const { subject, body } = buildInvoiceEmail([], { viewUrl: null });
  assert.equal(subject, "[Snorkl] Invoice Request — 0 open");
  assert.match(body, /you're all caught up/);
  assert.doesNotMatch(body, /This list replaces/);
});

test("청구 내용 문구는 유형별로 갈린다", () => {
  assert.equal(invoiceWhat(upgrade(1, "A")), "Upgrade, 1 teacher account");
  assert.equal(invoiceWhat(upgrade(1, "A", 5)), "Upgrade, 5 teacher accounts");
  assert.equal(
    invoiceWhat({ ...upgrade(1, "A"), accountType: "school" }),
    "School-wide upgrade",
  );
  assert.equal(
    invoiceWhat({ ...upgrade(1, "A"), type: "extension", extensionDate: "2027-08-28" }),
    "Extension through 2027-08-28, 1 teacher account",
  );
});

test("확인 페이지 토큰은 미설정을 통과로 바꾸지 않는다", () => {
  // 환경변수를 빠뜨렸을 때 열리는 게 아니라 닫혀야 한다
  assert.equal(checkInvoiceViewToken("anything", undefined), "not_configured");
  assert.equal(checkInvoiceViewToken("anything", "   "), "not_configured");

  assert.equal(checkInvoiceViewToken("secret", "secret"), "ok");
  assert.equal(checkInvoiceViewToken("secret ", "secret"), "invalid");
  assert.equal(checkInvoiceViewToken("wrong", "secret"), "invalid");
  assert.equal(checkInvoiceViewToken("", "secret"), "invalid");
  assert.equal(checkInvoiceViewToken(null, "secret"), "invalid");
  // 접두사만 맞아도 통과하면 안 된다
  assert.equal(checkInvoiceViewToken("sec", "secret"), "invalid");
  assert.equal(checkInvoiceViewToken("secretsecret", "secret"), "invalid");
});
