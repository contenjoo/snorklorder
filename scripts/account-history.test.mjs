import assert from "node:assert/strict";
import test from "node:test";
import { matchAccountHistory, historyMessage } from "../src/lib/account-history.ts";
import { buildProcessingEmail } from "../src/lib/account-processing.ts";

const email = "same@example.test";
const before = new Date("2026-01-01");
const now = new Date("2026-11-26");
const base = { id: 3, emails: email, type: "extension", accountType: "school", status: "processed",
  confirmedAt: before, createdAt: before, extensionDate: "2027-05-08" };
const order = { id: 9, createdAt: now, emails: [email.toUpperCase(), "new@example.test", "member@example.test"] };

test("batch lookup matches full addresses, prior registrations and confirmed renewals independently", () => {
  const records = [
    { ...base, emails: "other@example.test; SAME@example.test\nthree@example.test" },
    { ...base, id: 5, status: "paid", confirmedAt: null, extensionDate: "2099-01-01" },
    { ...base, id: 9, emails: "new@example.test" }, // current request
    { ...base, id: 10, emails: "new@example.test" }, // later order
    { ...base, id: 2, emails: "anew@example.test" }, // substring
  ];
  const [matches] = matchAccountHistory([order], records, [
    { email: " MEMBER@example.test ", createdAt: before },
    { email: "new@example.test", createdAt: new Date("2030-01-01") },
  ]);
  assert.deepEqual(matches, [
    { email, expiry: "2027-05-08", pending: true, schoolWide: true },
    { email: "member@example.test", expiry: null, pending: false, schoolWide: false },
  ]);
  for (const batch of [true, false]) {
    const mail = buildProcessingEmail([{ ...order, type: "extension", schoolName: "Example", history: matches }], [], { baseUrl: "https://example.test", batch });
    assert.match(mail.body, /same@example.test — Previous school-wide extension through 2027-05-08/);
    assert.match(mail.body, /member@example.test — Previous record found/);
    assert.doesNotMatch(mail.body, /2099/);
  }
});

test("unconfirmed orders and invalid dates never supply an expiry; latest confirmed correction wins", () => {
  const run = rows => matchAccountHistory([order], rows, [])[0][0];
  assert.equal(run([{ ...base, status: "draft", confirmedAt: null }]).expiry, null);
  assert.equal(run([{ ...base, extensionDate: "2027-02-30" }]).expiry, null);
  const corrected = run([base, { ...base, id: 4, accountType: "teacher", confirmedAt: now, extensionDate: "2027-04-01" }]);
  assert.equal(corrected.expiry, "2027-04-01");
  assert.match(historyMessage(corrected, "ko"), /종료일 2027-04-01/);
});
