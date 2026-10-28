import assert from "node:assert/strict";
import test from "node:test";
import {
  generateAccountEmail,
  invoiceLine,
  invoiceWhat,
  invoiceWeight,
} from "../src/lib/account-email-template.ts";
import { parseInvoicePdfText } from "../src/lib/billing-mail.ts";

const renewal = {
  type: "extension",
  applicantType: "school",
  schoolName: "광신방송예술고등학교",
  schoolNameEn: "Gwangshin Broadcasting Arts High School",
  accountType: "school",
  quantity: 1,
  emails: ["school@example.test", "admin@example.test"],
  extensionDate: "2027-10-31",
  termYears: 1,
};

test("학교 단체 연장은 기존 학교 이용권·기존 교사·식별 계정을 구분해 Jon에게 안내한다", () => {
  const email = generateAccountEmail(renewal);
  assert.equal(email.subject, "School-wide Extension Request – Gwangshin Broadcasting Arts High School");
  assert.match(email.body, /renew the existing school-wide license for Gwangshin Broadcasting Arts High School through 2027-10-31/);
  assert.match(email.body, /License term: 1-year license/);
  assert.match(email.body, /keep the school's existing teachers covered/);
  assert.match(email.body, /School identification account\(s\):\n- school@example.test\n- admin@example.test/);
  assert.match(email.body, /renewal covers the whole school/);
  assert.doesNotMatch(email.body, /extend the school@example.test, admin@example.test account/);
});

test("학교 연장의 2년 기간·종료일·메모는 미리보기에 그대로 남는다", () => {
  const email = generateAccountEmail({ ...renewal, termYears: 2, extensionDate: "2028-10-31", notes: "Renewal of last year's school purchase." });
  assert.match(email.body, /through 2028-10-31/);
  assert.match(email.body, /License term: 2-year license/);
  assert.match(email.body, /Note: Renewal of last year's school purchase\./);
});

test("학교 1곳 연장은 식별 이메일 수와 무관하게 학교 1개로 청구하고 기존 PDF 파서가 읽는다", () => {
  const item = { ...renewal, requestId: 901 };
  assert.equal(invoiceWhat(item), "School-wide extension through 2027-10-31, 1 school account, 1-year license");
  assert.equal(invoiceWeight(item), 10);
  const parsed = parseInvoicePdfText(`Invoice no.: 9999\nNote to customer\n${invoiceLine(item)}\nView and pay\nTotal $800.00`);
  assert.deepEqual(parsed.requestItems, [{ requestId: 901, quantity: 1 }]);
});

test("교사·학생 개별 연장의 제목·본문·청구 문구는 유지한다", () => {
  for (const accountType of ["teacher", "student"]) {
    const individual = { ...renewal, accountType, emails: "teacher@example.test", notes: "Existing account." };
    assert.deepEqual(generateAccountEmail(individual), {
      subject: "Account Extension Request – Gwangshin Broadcasting Arts High School",
      body: "Hi Jon,\n\nCould you extend the teacher@example.test account through 2027-10-31?\n\nNote: Existing account.\n\nThanks,\n\nBanghyun",
    });
    assert.equal(invoiceWhat(individual), `Extension through 2027-10-31, 1 ${accountType} account, 1-year license`);
  }
});
