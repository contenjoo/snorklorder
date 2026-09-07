import assert from "node:assert/strict";
import test from "node:test";
import { buildLicenseDraft, sanitizeDateInput, validateLicenseDraft, licenseFilename } from "../src/lib/license-certificate.ts";

const request = { id: 17, schoolName: "테스트학교", accountType: "teacher", quantity: 3, type: "upgrade", fromType: null, extensionDate: null };

test("확인서는 요청 수량을 사용하며 실제 사용기간과 학교 공급금액을 추정하지 않는다", () => {
  const draft = buildLicenseDraft({ ...request, invoiceAmount: "USD 150", notes: "내부 메모", emails: "private@example.com" }, new Date("2026-09-06T15:00:00Z"));
  assert.deepEqual(draft.row, { productName: "Snorkl", planText: "Teacher", quantityText: "3계정" });
  assert.deepEqual(draft.period, { start: "", end: "" });
  assert.equal(draft.issuedAt, "2026-09-07");
  assert.equal(draft.amount, "");
  assert.equal(draft.note, "");
  assert.equal(draft.contactName, "");
  assert.equal(draft.showAmount, false);
});

test("학교 플랜과 타입 변경은 맞는 단위와 변경 후 플랜을 표시한다", () => {
  assert.equal(buildLicenseDraft({ ...request, accountType: "school", quantity: 1 }).row.quantityText, "1개교");
  assert.equal(buildLicenseDraft({ ...request, type: "type_change", fromType: "teacher" }).row.planText, "Student");
  assert.equal(buildLicenseDraft({ ...request, quantity: null }).row.quantityText, "");
});

test("연장일은 유효한 날짜일 때만 채우며 윤년과 역전 기간을 검사한다", () => {
  assert.equal(sanitizeDateInput("2026-02-29"), "");
  assert.equal(sanitizeDateInput("2028-02-29"), "2028-02-29");
  assert.equal(buildLicenseDraft({ ...request, extensionDate: "September 30" }).period.end, "");
  const draft = buildLicenseDraft({ ...request, extensionDate: "2027-09-06" });
  assert.ok(validateLicenseDraft(draft));
  draft.period.start = "2026-09-07";
  assert.equal(validateLicenseDraft(draft), null);
  draft.period.start = "2027-09-07";
  assert.match(validateLicenseDraft(draft), /빠를 수/);
});

test("선택 공급금액은 원화 정수만 받고 파일명 경로 문자를 제거한다", () => {
  const draft = buildLicenseDraft(request);
  draft.period = { start: "2026-09-07", end: "2027-09-06" };
  draft.showAmount = true;
  for (const value of ["", "-1", "USD 150", "10.5", "Infinity"]) {
    draft.amount = value;
    assert.ok(validateLicenseDraft(draft));
  }
  draft.amount = "150000";
  assert.equal(validateLicenseDraft(draft), null);
  assert.equal(licenseFilename("학교/테스트"), "라이선스확인서_학교_테스트.pdf");
});
