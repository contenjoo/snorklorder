import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// void 로 띄운 작업은 서버리스에서 응답 직후 끊길 수 있다 — 교사 upgraded 반영·완료 메일이 빠졌던 원인.
for (const path of [
  "../src/app/api/account-confirm/[token]/route.ts",
  "../src/app/api/confirm/[token]/route.ts",
  "../src/app/api/domain-confirm/[token]/route.ts",
  "../src/app/api/account-requests/route.ts",
]) {
  test(`${path} runs post-response side effects with after()`, () => {
    const route = read(path);
    assert.match(route, /import \{[^}]*\bafter\b[^}]*\} from "next\/server"/);
    assert.match(route, /after\(/);
    assert.doesNotMatch(route, /void \(async/);
    assert.doesNotMatch(route, /void send[A-Z]/);
  });
}
