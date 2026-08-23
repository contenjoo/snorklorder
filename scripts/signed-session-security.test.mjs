import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_SESSION_MAX_AGE,
  createAdminSessionToken,
  createPartnerSessionToken,
  verifyAdminSessionToken,
  verifyPartnerSessionToken,
} from "../src/lib/signed-session.ts";

const SECRET_ENV_NAMES = ["ADMIN_SESSION_SECRET", "SCHOOL_SESSION_SECRET", "ADMIN_PASSWORD"];
const originalSecrets = Object.fromEntries(SECRET_ENV_NAMES.map((name) => [name, process.env[name]]));
const originalNodeEnv = process.env.NODE_ENV;

function setTestSecrets() {
  process.env.ADMIN_SESSION_SECRET = "signed-session-test-primary";
  process.env.SCHOOL_SESSION_SECRET = "signed-session-test-secondary";
  process.env.ADMIN_PASSWORD = "signed-session-test-password";
}

function restoreSecrets() {
  for (const name of SECRET_ENV_NAMES) {
    const value = originalSecrets[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
}

test.after(restoreSecrets);

test("admin 토큰은 서명·nonce·만료를 검증하고 고정값/변조를 거부한다", async () => {
  setTestSecrets();
  const now = 1_800_000_000_000;
  const first = await createAdminSessionToken(now);
  const second = await createAdminSessionToken(now);
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second, "nonce 때문에 같은 시각의 토큰도 달라야 한다");
  assert.equal(await verifyAdminSessionToken(first, now), true);
  assert.equal(await verifyPartnerSessionToken(first, now), null, "admin purpose를 partner로 재사용할 수 없다");
  assert.equal(await verifyAdminSessionToken("authenticated", now), false);

  const [payload, signature] = first.split(".");
  const tampered = `${payload}.${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
  assert.equal(await verifyAdminSessionToken(tampered, now), false);
  const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}.${signature}`;
  assert.equal(await verifyAdminSessionToken(tamperedPayload, now), false);
  assert.equal(
    await verifyAdminSessionToken(first, now + ADMIN_SESSION_MAX_AGE * 1000 + 1_000),
    false,
  );
});

test("partner 역할은 purpose-bound 서명 토큰만 허용한다", async () => {
  setTestSecrets();
  const now = 1_800_000_000_000;
  for (const role of ["jon", "jeff", "cailie"]) {
    assert.equal(await verifyPartnerSessionToken(role, now), null, `plain ${role} 쿠키는 거부해야 한다`);
    const token = await createPartnerSessionToken(role, now);
    assert.ok(token);
    assert.equal(await verifyPartnerSessionToken(token, now), role);
    assert.equal(await verifyAdminSessionToken(token, now), false, "partner purpose를 admin으로 재사용할 수 없다");
  }
});

test("secret 우선순위를 지키고 secret이 없으면 production에서 fail closed한다", async () => {
  setTestSecrets();
  const now = 1_800_000_000_000;
  const token = await createAdminSessionToken(now);
  assert.ok(token);

  delete process.env.ADMIN_SESSION_SECRET;
  assert.equal(await verifyAdminSessionToken(token, now), false, "우선순위가 바뀌면 기존 서명은 무효여야 한다");

  delete process.env.SCHOOL_SESSION_SECRET;
  delete process.env.ADMIN_PASSWORD;
  process.env.NODE_ENV = "production";
  assert.equal(await createAdminSessionToken(now), null);
  assert.equal(await createPartnerSessionToken("jon", now), null);
  assert.equal(await verifyAdminSessionToken(token, now), false);
});

test("Proxy와 Route Handler는 plain cookie 비교 없이 공통 verifier를 사용한다", async () => {
  const [sessionModule, proxy, authRoute, partnerAuthRoute, partnerRoute, authLib] = await Promise.all([
    readFile(new URL("../src/lib/signed-session.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/auth/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/partner/auth/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/partner/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/auth.ts", import.meta.url), "utf8"),
  ]);

  assert.match(sessionModule, /globalThis\.crypto\.subtle/);
  assert.doesNotMatch(sessionModule, /from "crypto"|Buffer\./);
  assert.match(proxy, /export async function proxy/);
  assert.match(proxy, /verifyAdminSessionToken/);
  assert.match(proxy, /verifyPartnerSessionToken/);
  assert.doesNotMatch(proxy, /\.value\s*!==\s*"authenticated"/);
  assert.doesNotMatch(proxy, /isPartnerRole\([^)]*\.value/);
  assert.match(authRoute, /createAdminSessionToken/);
  assert.doesNotMatch(authRoute, /cookies\.set\([^,]+,\s*"authenticated"/);
  assert.match(partnerAuthRoute, /createPartnerSessionToken/);
  assert.match(partnerAuthRoute, /verifyPartnerSessionToken/);
  assert.match(partnerRoute, /verifyPartnerSessionToken/);
  assert.doesNotMatch(partnerRoute, /canConfirmUpgrades\(cookie\?\.value\)/);
  assert.match(authLib, /verifyAdminSessionToken/);
  assert.doesNotMatch(authLib, /\.value\s*===\s*"authenticated"/);
});
