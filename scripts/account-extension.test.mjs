import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { extensionRequestError } from "../src/lib/account-extension.ts";

const valid = {
  id: 1, type: "extension", accountType: "school", applicantType: "school", quantity: 1,
  extensionDate: "2027-11-01", schoolName: "테스트학교", schoolNameEn: "Test School",
  emails: "reference@example.test", channel: "school_store", status: "draft", needsInvoice: true,
  partnerLifecycleState: "active", externalSource: null, archivedAt: null, notes: null,
};
const createValues = Object.fromEntries(["type", "accountType", "applicantType", "quantity", "extensionDate", "schoolName", "schoolNameEn", "emails", "channel", "needsInvoice"].map((key) => [key, valid[key]]));

test("학교 단체 연장은 실제 종료일과 학교 1곳을 사용한다", () => {
  assert.equal(extensionRequestError(valid), null);
  for (const extensionDate of [null, "", "2027/11/01", "2027-2-01", "2027-02-29", "2027-04-31", "2027-13-01", "2027-11-01T00:00:00Z"]) {
    assert.ok(extensionRequestError({ ...valid, extensionDate }), String(extensionDate));
  }
  assert.equal(extensionRequestError({ ...valid, extensionDate: "2028-02-29" }), null);
  for (const quantity of [undefined, null, 0, -1, 2, 15, "1", 1.5]) {
    assert.ok(extensionRequestError({ ...valid, quantity }), String(quantity));
  }
  assert.ok(extensionRequestError({ ...valid, applicantType: "individual" }));
});

test("개별 계정 연장 수량은 양의 정수이며 다른 요청 유형은 유지한다", () => {
  assert.equal(extensionRequestError({ ...valid, accountType: "teacher", applicantType: "individual", quantity: 3 }), null);
  for (const quantity of [0, -1, 1.5, "2"]) assert.ok(extensionRequestError({ ...valid, accountType: "teacher", quantity }));
  for (const type of ["upgrade", "email_change", "type_change"]) {
    assert.equal(extensionRequestError({ type, extensionDate: null }), null);
  }
});

// Execute real route handlers against isolated substitutes. No environment files,
// production DB connections, or outbound mail are used.
function harness(initial = []) {
  const rows = structuredClone(initial), effects = { inserts: 0, updates: 0, claims: 0, mail: 0 };
  const table = new Proxy({}, { get: (_, key) => ({ key }) });
  const db = {
    select() { return { from() { return this; }, where() { return Promise.resolve(rows); } }; },
    insert() { return { values(value) { return { returning() { effects.inserts++; return Promise.resolve([{ id: 99, ...value }]); } }; } }; },
    update() { return { set(value) { return { where() { return { returning() { effects.updates++; return Promise.resolve([{ ...rows[0], ...value }]); } }; } }; } }; },
  };
  const mocks = {
    "next/server": { NextResponse: Response, after: () => { throw new Error("Unexpected notification"); } },
    "@/db": { db }, "@/db/schema": new Proxy({}, { get: () => table }),
    "drizzle-orm": new Proxy({}, { get: () => () => ({}) }),
    "@/lib/auth": { checkAuth: async () => true },
    "@/lib/security": {
      normalizeText: (value, max) => value.trim().slice(0, max),
      isValidEmail: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      parseEmailList: (value) => value.split(/[,;\n]+/).map((email) => email.trim()).filter(Boolean),
    },
    "@/lib/account-request-school-name": {
      resolveAccountRequestSchoolNameEn: async () => "Test School",
      hydrateAccountRequestSchoolNames: async (input) => input,
      needsEnglishSchoolNameForHq: () => false,
    },
    "@/lib/market-status": { authorizeMarketStatusRequest: () => ({ ok: false }) },
    "@/lib/receiver-fulfillment-pause": { getReceiverFulfillmentPausedResponse: () => null },
    "@/lib/market-void-db": { claimAccountRequestSideEffects: async () => { effects.claims++; throw new Error("Unexpected claim"); } },
    "@/lib/email": { getTransporter: () => ({ sendMail: async () => { effects.mail++; } }) },
    "@/lib/invoice-ledger": {},
    "@/lib/billing-cycle-db": {},
    "@/lib/processing-ledger": {},
  };
  const root = path.resolve(import.meta.dirname, ".."), nativeRequire = createRequire(import.meta.url), cache = new Map();
  function load(spec, parent = path.join(root, "entry.ts")) {
    if (mocks[spec]) return mocks[spec];
    if (!spec.startsWith(".") && !spec.startsWith("@/")) return nativeRequire(spec);
    let file = spec.startsWith("@/") ? path.join(root, "src", spec.slice(2)) : path.resolve(path.dirname(parent), spec);
    if (!existsSync(file)) file += ".ts";
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })((next) => load(next, file), mod, mod.exports);
    return mod.exports;
  }
  return {
    effects,
    async post(route, body) {
      return load(`@/app/api/${route}/route`).POST(new Request("https://example.test/api", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }));
    },
  };
}

test("생성·수정은 누락 종료일과 학교 인원수를 DB 기록 전에 거절한다", async () => {
  for (const change of [{ extensionDate: null }, { extensionDate: "2027-02-29" }, { quantity: 15 }, { quantity: 0 }, { applicantType: "individual" }]) {
    const create = harness();
    assert.equal((await create.post("account-requests", { action: "create", ...createValues, ...change })).status, 400);
    assert.equal(create.effects.inserts, 0);
    const update = harness([valid]);
    assert.equal((await update.post("account-requests", { action: "update", id: 1, ...change })).status, 400);
    assert.equal(update.effects.updates, 0);
  }
  const create = harness();
  assert.equal((await create.post("account-requests", { action: "create", ...createValues })).status, 200);
  assert.equal(create.effects.inserts, 1);
});

test("이전 연장 건의 결제 상태만 갱신할 때는 새 입력 검증으로 차단하지 않는다", async () => {
  const h = harness([{ ...valid, extensionDate: null, status: "invoiced" }]);
  assert.equal((await h.post("account-requests", { action: "update", id: 1, status: "paid" })).status, 200);
  assert.equal(h.effects.updates, 1);
});

test("상태만 바꿔도 날짜 없는 연장 초안이 본사 화면에 새로 게시되지 않는다", async () => {
  for (const status of ["sent", "processed", "invoiced"]) {
    const h = harness([{ ...valid, extensionDate: null }]);
    assert.equal((await h.post("account-requests", { action: "update", id: 1, status })).status, 400);
    assert.deepEqual(h.effects, { inserts: 0, updates: 0, claims: 0, mail: 0 });
  }
  const h = harness([valid]);
  assert.equal((await h.post("account-requests", { action: "update", id: 1, status: "sent" })).status, 200);
  assert.equal(h.effects.updates, 1);
});

test("단건·묶음 본사 게시 모두 잘못된 연장을 토큰·청구·메일 변경 전에 거절한다", async () => {
  for (const change of [{ extensionDate: null }, { quantity: 15 }]) {
    for (const batch of [false, true]) {
      const h = harness([{ ...valid, ...change }]);
      const response = await h.post(batch ? "account-email/batch" : "account-email", batch
        ? { requestIds: [1], sections: [{ subject: "preview", body: "preview" }], mode: "send_all" }
        : { requestId: 1, subject: "preview", body: "preview", mode: "send_all" });
      assert.equal(response.status, 400);
      assert.deepEqual(h.effects, { inserts: 0, updates: 0, claims: 0, mail: 0 });
    }
  }
});
