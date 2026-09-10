import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { buildProcessingEmail, isOpenProcessingRequest, selectProcessingReminders, isProcessingConfirmed } from "../src/lib/account-processing.ts";

const root = path.resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(import.meta.url);
const row = (id, overrides = {}) => ({
  id, type: "upgrade", accountType: "teacher", applicantType: "school", schoolName: `School ${id}`,
  schoolNameEn: `School ${id}`, emails: `teacher${id}@example.test`, quantity: 1,
  channel: "school_store", partnerLifecycleState: "active", needsInvoice: false, status: "sent", confirmedAt: null,
  confirmToken: `a${id}`, tokenExpiresAt:new Date(Date.now()+86400000), processingEmailSentAt: new Date(`2026-09-${String(id).padStart(2, "0")}T00:00:00Z`),
  processingEmailSendStartedAt: null, invoiceEmailSendStartedAt: null, invoiceEmailSentAt: null,
  marketVoidState: "active", externalSource: null, ...overrides,
});
const fresh = (id, overrides = {}) => row(id, { status: "draft", confirmToken: null, processingEmailSentAt: null, ...overrides });

// Load real TS route handlers with an in-memory DB and SMTP substitute. No env files,
// sockets, real database, or outbound mail are used by this harness.
function harness(initial, options = {}) {
  const rows = structuredClone(initial), mails = [], logs = [], events = [], notifications = [];
  let authenticated = true;
  const tables = {};
  for (const name of ["accountRequests", "teachers", "schools", "marketOrderVoidFences"]) {
    tables[name] = new Proxy({ _name: name }, { get: (target, key) => key in target ? target[key] : { key, table: name } });
  }
  const value = (v, r) => v?.key ? r[v.key] : v;
  const predicate = (fn) => fn;
  const orm = {
    eq: (a, b) => predicate((r) => +value(a, r) === +value(b, r) || value(a, r) === value(b, r)),
    ne: (a, b) => predicate((r) => value(a, r) !== value(b, r)),
    inArray: (a, b) => predicate((r) => b.includes(value(a, r))),
    notInArray: (a, b) => predicate((r) => !b.includes(value(a, r))),
    isNull: (a) => predicate((r) => value(a, r) == null),
    isNotNull: (a) => predicate((r) => value(a, r) != null),
    and: (...p) => predicate((r) => p.filter(Boolean).every((f) => f(r))),
    or: (...p) => predicate((r) => p.filter(Boolean).some((f) => f(r))),
    desc: (a) => a,
    sql: (strings) => {
      if (strings.join("").includes("root_request")) return () => true;
      assert.match(strings.join(""), /CASE WHEN/);
      return strings.join("").includes("THEN 'sent'") ? { finalizeSend: true } : { preserveBilling: true };
    },
  };
  const projected = (r, fields) => fields ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, r[v.key]])) : structuredClone(r);
  let updates = 0;
  const db = {
    select(fields) {
      let table;
      return {
        from(t) { table = t; return this; },
        where(p) {
          if (options.failList && !fields && table === tables.accountRequests) throw new Error("simulated list outage");
          return Promise.resolve((table === tables.accountRequests ? rows : []).filter(p).map((r) => projected(r, fields)));
        },
      };
    },
    update(table) {
      let values, condition;
      const run = (fields) => {
        options.beforeUpdate?.(rows, values);
        const matches = (table === tables.accountRequests ? rows : []).filter(condition);
        for (const r of matches) {
          for (const [k, v] of Object.entries(values)) r[k] = v?.finalizeSend ? (r.status === "draft" ? "sent" : r.status) : v?.preserveBilling ? (["invoiced", "paid"].includes(r.status) ? r.status : "processed") : v;
          updates++;
        }
        return matches.map((r) => projected(r, fields));
      };
      return {
        set(v) { values = v; return this; },
        where(p) { condition = p; return this; },
        returning(fields) { return Promise.resolve(run(fields)); },
        then(resolve, reject) { return Promise.resolve().then(() => run()).then(resolve, reject); },
      };
    },
  };
  const mocks = {
    "next/server": { NextResponse: Response, NextRequest: Request },
    "@/db": { db }, "@/db/schema": tables, "drizzle-orm": orm,
    "@/lib/auth": { checkAuth: async () => authenticated },
    "@/lib/market-account-request": {}, "@/lib/market-status": {},
    "@/lib/security": { parseEmailList: (s) => s.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) },
    "@/lib/account-request-school-name": { hydrateAccountRequestSchoolNames: async (r) => r, needsEnglishSchoolNameForHq: () => false },
    "@/lib/market-legacy-audit-db": { nonLegacyMarketAuditCondition: () => () => true },
    "@/lib/receiver-fulfillment-pause": { getReceiverFulfillmentPausedResponse: () => null },
    "@/lib/market-void-db": { claimAccountRequestSideEffects: async (ids) => {
      events.push(["fence", ...ids]);
      options.onFence?.(rows);
      return !ids.some((id) => !rows.some((r) => r.id === id && !["prepared", "voided"].includes(r.marketVoidState)));
    } },
    "@/lib/invoice-ledger": { invoiceViewUrl: () => null, loadOpenInvoiceItemsForEmail: async (items) => ({ items, newIds: items.map((r) => r.requestId) }) },
    "@/lib/processing-mail-outbox": { sendTrackedProcessingMail: async (transporter, mail) => transporter.sendMail(mail) },
    "@/lib/email": {
      BASE_URL: "https://example.test", HQ_EMAIL: "jon@example.test", HQ_INVOICE_TO: "cailie@example.test",
      getTransporter: () => ({ sendMail: async (mail) => { mails.push(mail); if (options.failSmtp === mails.length) throw new Error("unknown delivery"); } }),
      escapeHtml: (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
      formatLogRecipients: (...args) => args.join(","), logEmail: async (entry) => logs.push(entry),
      sendAccountConfirmNotification: async (entry) => notifications.push(entry),
      sendTeacherUpgradedEmail: async (entry) => { notifications.push(entry); return { success: true }; },
      sendAccountUpgradeCompletion: async (entry) => { notifications.push(entry); return { success: true }; },
    },
  };
  const cache = new Map();
  function load(spec, parent = path.join(root, "entry.ts")) {
    if (mocks[spec]) return mocks[spec];
    if (!spec.startsWith(".") && !spec.startsWith("@/")) return nativeRequire(spec);
    let file = spec.startsWith("@/") ? path.join(root, "src", spec.slice(2)) : path.resolve(path.dirname(parent), spec);
    if (!existsSync(file)) file += ".ts";
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} }; cache.set(file, loadedModule);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(
      (next) => load(next, file), loadedModule, loadedModule.exports,
    );
    return loadedModule.exports;
  }
  return { rows, mails, logs, events, notifications, load, get updates() { return updates; }, setAuth: (v) => { authenticated = v; } };
}
const post = (body) => new Request("https://example.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const send = async (h, ids, batch = false, mode = "send_all") => h.load(batch ? "@/app/api/account-email/batch/route" : "@/app/api/account-email/route").POST(post(batch
  ? { requestIds: ids, sections: ids.map(() => ({ subject: "ignored", body: "ignored" })), mode }
  : { requestId: ids[0], subject: "ignored", body: "ignored", mode }));

test("selection excludes completed, unrelated, cancelled, unknown and legacy audit; billing alone stays pending", () => {
  const cases = [row(1), row(2, { accountType: "student", applicantType: "individual" }),
    row(3, { status: "invoiced" }), row(4, { status: "paid" }), row(5, { confirmedAt: new Date() }),
    row(6, { status: "processed" }), row(7, { type: "extension" }), row(8, { accountType: "school" }),
    row(9, { marketVoidState: "prepared" }), row(10, { marketVoidState: "voided" }),
    row(11, { processingEmailSendStartedAt: new Date() }), row(12, { invoiceEmailSendStartedAt: new Date() }),
    row(13, { processingEmailSentAt: null }), row(14, { confirmToken: null }),
    row(15, { channel: "company", notes: "/ 주문번호: OLD-1 /" }), fresh(16)];
  const selected = selectProcessingReminders([fresh(17)], cases);
  assert.deepEqual(selected.reminders.map((r) => r.id), [1, 2, 3, 4]);
  assert.deepEqual(selected.manualReview.map((r) => r.requestId), [11, 12, 14]);
  assert.equal(isProcessingConfirmed(row(3, { status: "invoiced" })), false);
  assert.equal(isOpenProcessingRequest(row(1)), true);
});

test("A/B → C → confirm A → D keeps B/C and request identity even with the same email", async () => {
  const h = harness([fresh(1), fresh(2), fresh(3), fresh(4)]);
  assert.equal((await send(h, [1, 2], true)).status, 200);
  assert.equal((await send(h, [3])).status, 200);
  assert.match(h.mails[1].subject, /1 new, 2 awaiting/);
  for (const id of [1, 2, 3]) assert.match(h.mails[1].text, new RegExp(`\\[#${id}\\]`));
  const originalSentAt = h.rows[0].processingEmailSentAt;
  const originalToken = h.rows[0].confirmToken;
  const confirm = h.load("@/app/api/account-confirm/[token]/route");
  assert.equal((await confirm.POST(post({}), { params: Promise.resolve({ token: originalToken }) })).status, 200);
  assert.equal((await send(h, [4])).status, 200);
  const last = h.mails.at(-1).text;
  assert.doesNotMatch(last, /\[#1\]/);
  assert.match(last, /\[#2\]/); assert.match(last, /\[#3\]/); assert.match(last, /\[#4\]/);
  assert.equal(h.rows[0].processingEmailSentAt, originalSentAt);
  assert.equal(h.rows[0].confirmToken, originalToken);
  const sameEmail = buildProcessingEmail([fresh(3)], [row(1), row(2, { emails: row(1).emails }), row(1)], { baseUrl: "https://example.test" });
  assert.equal(sameEmail.pendingCount, 2);
  assert.equal((sameEmail.body.match(/\[#1\]/g) || []).length, 1);
});

for (const batch of [false, true]) {
  test(`${batch ? "batch" : "single"} preview is read-only and matches SMTP except a new token placeholder`, async () => {
    const h = harness([row(1), row(2, { status: "paid" }), fresh(3), fresh(4, { type: "extension" })]);
    const ids = batch ? [3, 4] : [3];
    const previewRoute = h.load("@/app/api/account-email/preview/route");
    h.setAuth(false);
    assert.equal((await previewRoute.POST(post({ requestIds: ids, batch }))).status, 401);
    h.setAuth(true);
    const preview = await (await previewRoute.POST(post({ requestIds: ids, batch }))).json();
    assert.equal(h.updates, 0); assert.equal(h.events.length, 0); assert.equal(h.mails.length, 0);
    assert.equal((await send(h, ids, batch)).status, 200);
    assert.equal(h.mails[0].subject, preview.subject);
    let expected = preview.body;
    for (const id of ids) expected = expected.replace("(The confirmation link will be added when this request is sent.)", `Once done, confirm: https://example.test/account-confirm/${h.rows.find((r) => r.id === id).confirmToken}`);
    assert.equal(h.mails[0].text, expected);
    assert.deepEqual(h.events[0].slice(1), [...ids, 1, 2]);
  });
  test(`${batch ? "batch" : "single"} list failure and cancellation race never reach SMTP or a delivery claim`, async () => {
    for (const options of [{ failList: true }, { onFence: (rows) => { rows[0].marketVoidState = "prepared"; } }]) {
      const h = harness([row(1), fresh(3)], options);
      const response = await send(h, [3], batch);
      assert.ok([503, 409].includes(response.status));
      assert.equal(h.mails.length, 0); assert.equal(h.updates, 0);
      assert.equal(h.rows[1].processingEmailSendStartedAt, null);
    }
  });
  test(`${batch ? "batch" : "single"} SMTP uncertainty blocks retry; invoice-only never resends Jon/reminders`, async () => {
    const h = harness([row(1), fresh(3, { needsInvoice: true })], { failSmtp: 2 });
    assert.equal((await send(h, [3], batch)).status, 502);
    assert.equal(h.mails.length, 2);
    assert.match(h.mails[0].text, /\[#1\]/);
    assert.doesNotMatch(h.mails[1].text, /\[#1\]/);
    assert.equal((await send(h, [3], batch)).status, 409);
    assert.equal((await send(h, [3], batch, "invoice_only")).status, 409);
    assert.equal(h.mails.length, 2);
    // Explicit audit resolution: a not-delivered invoice claim is cleared before retry.
    h.rows[1].invoiceEmailSendStartedAt = null;
    assert.equal((await send(h, [3], batch, "invoice_only")).status, 200);
    assert.equal(h.mails.length, 3); assert.equal(h.mails[2].to, "cailie@example.test");
    assert.equal(h.rows[0].invoiceEmailSentAt, null);
    const unknown = harness([row(1), fresh(3)], { failSmtp: 1 });
    assert.equal((await send(unknown, [3], batch)).status, 502);
    assert.equal((await send(unknown, [3], batch)).status, 409);
    assert.equal(unknown.mails.length, 1);
  });
}

test("confirmation preserves financial state at UPDATE time and sends notifications once", async () => {
  const h = harness([row(1)], { beforeUpdate: (rows, values) => { if (values.confirmedAt) rows[0].status = "paid"; } });
  const api = h.load("@/app/api/account-confirm/[token]/route");
  const request = () => api.POST(post({}), { params: Promise.resolve({ token: "a1" }) });
  await Promise.all([request(), request()]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.rows[0].status, "paid"); assert.ok(h.rows[0].confirmedAt);
  assert.equal(h.notifications.length, 2); // One admin notification, one teacher notification.
  await request(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.notifications.length, 2);
});

test("only new individual upgrades trigger the cumulative list; Market reminders disable manual copies", async () => {
  const h = harness([row(1, { externalSource: "market" }), fresh(3, { accountType: "school" })]);
  assert.equal((await send(h, [3])).status, 200);
  assert.doesNotMatch(h.mails[0].text, /\[#1\]/);
  h.rows.push(fresh(4));
  const preview = await (await h.load("@/app/api/account-email/preview/route").POST(post({ requestIds: [4] }))).json();
  assert.equal(preview.copyAllowed, false); assert.equal(preview.pendingCount, 1);
});

for (const status of ["sent", "invoiced", "paid"]) {
  test(`admin completion records confirmedAt once and preserves ${status} billing`, async () => {
    const h = harness([row(1, { status, invoiceNumber: "INV-1", paymentDate: "2026-09-01" })]);
    const api = h.load("@/app/api/account-requests/route");
    const confirm = () => api.POST(post({ action: "update", id: 1, status: "processed" }));
    await Promise.all([confirm(), confirm()]);
    assert.equal(h.rows[0].status, status === "sent" ? "processed" : status);
    assert.ok(h.rows[0].confirmedAt);
    assert.equal(h.rows[0].invoiceNumber, "INV-1");
    assert.equal(h.rows[0].paymentDate, "2026-09-01");
    assert.equal(h.notifications.length, 1);
    await confirm();
    assert.equal(h.notifications.length, 1);
  });
}

test("send finalization cannot undo concurrent processing completion", async () => {
  for (const batch of [false, true]) {
    const h = harness([fresh(3)], { beforeUpdate: (rows, values) => {
      if (values.processingEmailSentAt) { rows[0].status = "processed"; rows[0].confirmedAt = new Date(); }
    } });
    assert.equal((await send(h, [3], batch)).status, 200);
    assert.equal(h.rows[0].status, "processed");
    assert.ok(h.rows[0].confirmedAt);
  }
});

test("concurrent requests share one durable confirmation token and one SMTP send", async () => {
  for (const batch of [false, true]) {
    const h = harness([fresh(3)]);
    const results = await Promise.all([send(h, [3], batch), send(h, [3], batch)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(h.mails.length, 1);
    assert.ok(h.mails[0].text.includes(`/account-confirm/${h.rows[0].confirmToken}`));
  }
});


test("partner confirmation keeps application boundaries and does not mail teachers directly", async () => {
  const h = harness([
    row(1, { channel: "partner", partnerRequestId: "partner-one" }),
    row(2, { channel: "partner", partnerRequestId: "partner-two", schoolName: "School 1" }),
    row(3, { channel: "partner", partnerRequestId: "partner-one", schoolName: "School 1", partnerLifecycleState: "cancelled" }),
  ]);
  const response = await h.load("@/app/api/account-confirm/[token]/route").POST(post({ alsoConfirmIds: [2, 3] }), { params: Promise.resolve({ token: "a1" }) });
  assert.equal(response.status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.rows[0].confirmedAt);
  assert.equal(h.rows[1].confirmedAt, null); assert.equal(h.rows[2].confirmedAt, null);
  assert.equal(h.notifications.length, 1);
  assert.equal(isOpenProcessingRequest(h.rows[2]), false);
});


test("legacy records without a delivery ledger stay quiet while genuine delivery uncertainty remains visible", () => {
  const legacy = ["sent", "invoiced", "paid"].map((status, i) => row(i + 1, {
    status, processingEmailSentAt: null, confirmToken: null,
  }));
  const before = structuredClone(legacy);
  const unknown = row(4, { processingEmailSentAt: null, processingEmailSendStartedAt: new Date() });
  const inconsistent = row(5, { processingEmailSentAt: null, invoiceEmailSentAt: new Date() });
  const invoiceUnknown = row(6, { processingEmailSentAt: null, invoiceEmailSendStartedAt: new Date() });
  const selected = selectProcessingReminders([fresh(8)], [...legacy, unknown, inconsistent, invoiceUnknown, row(7)]);
  assert.deepEqual(selected.reminders.map((r) => r.id), [7]);
  assert.deepEqual(selected.manualReview, [
    { requestId: 4, reason: "발송 결과 확인 필요" },
    { requestId: 5, reason: "처리 메일 발송 기록 확인 필요" },
    { requestId: 6, reason: "발송 결과 확인 필요" },
  ]);
  assert.deepEqual(legacy, before);
  assert.ok(legacy.every((r) => !isProcessingConfirmed(r)));
});
