import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual route with billing/IMAP and authentication mocked.
// No production database, environment files, or outbound mail are accessed.
function harness({ authenticated = true, failure = false } = {}) {
  const calls = [], logs = [];
  const exports = {};
  const source = readFileSync(new URL("../src/app/api/admin/sync-billing/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, {
    exports,
    console: { error: (...args) => logs.push(args) },
    require(name) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@/lib/auth") return { checkAuth: async () => authenticated };
      if (name === "@/lib/billing-sync") return { runBillingSync: async (options) => {
        calls.push({ ...options });
        if (failure) throw new Error("private IMAP details");
        return { scanned: 0, dryRun: options.dryRun };
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { calls, logs, post: (body) => exports.POST(new Request("https://example.test/api/admin/sync-billing", {
    method: "POST", ...(body === undefined ? {} : { body }),
  })) };
}

for (const body of [undefined, "", "{}", '{"dryRun":false}']) {
  test(`billing sync accepts existing button request / default options: ${String(body)}`, async () => {
    const h = harness();
    assert.equal((await h.post(body)).status, 200);
    assert.deepEqual(h.calls, [{ dryRun: false }]);
  });
}
test("billing sync preserves explicit dry run", async () => {
  const h = harness();
  assert.equal((await h.post('{"dryRun":true}')).status, 200);
  assert.deepEqual(h.calls, [{ dryRun: true }]);
});
for (const body of [" ", "{", "null", "[]", '"text"', "42", '{"dryRun":"true"}', '{"dryRun":null}', '{"dryRun":1}']) {
  test(`billing sync rejects malformed input before any sync: ${body}`, async () => {
    const h = harness();
    assert.equal((await h.post(body)).status, 400);
    assert.equal(h.calls.length, 0);
  });
}
test("billing sync requires admin authentication even with no body", async () => {
  const h = harness({ authenticated: false });
  assert.equal((await h.post()).status, 401);
  assert.equal(h.calls.length, 0);
});
test("billing sync logs internal failures without exposing details", async () => {
  const h = harness({ failure: true });
  const result = await h.post("{}");
  assert.equal(result.status, 500);
  assert.doesNotMatch(await result.text(), /private IMAP/);
  assert.equal(h.logs.length, 1);
});
