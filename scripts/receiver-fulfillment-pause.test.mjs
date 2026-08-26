import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getReceiverFulfillmentPausedResponse,
  isReceiverFulfillmentPaused,
  RECEIVER_FULFILLMENT_PAUSED_CODE,
} from "../src/lib/receiver-fulfillment-pause.ts";

test("pause 환경값은 true, 1, yes만 대소문자·공백을 정규화해 활성화한다", () => {
  for (const value of ["true", "TRUE", " true ", "1", " yes ", "YeS"]) {
    assert.equal(isReceiverFulfillmentPaused(value), true, value);
  }
  for (const value of [undefined, "", "0", "false", "no", "on", "enabled"]) {
    assert.equal(isReceiverFulfillmentPaused(value), false, String(value));
  }
});

test("pause 응답은 캐시되지 않는 retryable 503이다", async () => {
  assert.equal(getReceiverFulfillmentPausedResponse("false"), null);

  const response = getReceiverFulfillmentPausedResponse("yes");
  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "60");
  assert.deepEqual(await response.json(), {
    code: RECEIVER_FULFILLMENT_PAUSED_CODE,
    error: "Receiver fulfillment is temporarily paused. Retry after deployment completes.",
    retryable: true,
  });
});

test("인자를 생략하면 RECEIVER_FULFILLMENT_PAUSED 환경값을 사용한다", () => {
  const previous = process.env.RECEIVER_FULFILLMENT_PAUSED;
  try {
    process.env.RECEIVER_FULFILLMENT_PAUSED = "1";
    assert.equal(isReceiverFulfillmentPaused(), true);
    assert.equal(getReceiverFulfillmentPausedResponse()?.status, 503);
  } finally {
    if (previous === undefined) delete process.env.RECEIVER_FULFILLMENT_PAUSED;
    else process.env.RECEIVER_FULFILLMENT_PAUSED = previous;
  }
});

const guardedRoutes = [
  {
    name: "단건 계정 메일",
    path: "../src/app/api/account-email/route.ts",
    firstSideEffect: "await req.json()",
  },
  {
    name: "일괄 계정 메일",
    path: "../src/app/api/account-email/batch/route.ts",
    firstSideEffect: "await req.json()",
  },
  {
    name: "계정 확인 writer",
    path: "../src/app/api/account-confirm/[token]/route.ts",
    firstSideEffect: "const { token } = await params",
  },
  {
    name: "관리자 완료 메일",
    path: "../src/app/api/admin/send-account-completion/route.ts",
    firstSideEffect: "const body = await req.json()",
  },
];

for (const route of guardedRoutes) {
  test(`${route.name} POST는 입력 파싱·DB writer·메일보다 pause gate를 먼저 검사한다`, async () => {
    const source = await readFile(new URL(route.path, import.meta.url), "utf8");
    assert.match(source, /import \{ getReceiverFulfillmentPausedResponse \}/);

    const postStart = source.indexOf("export async function POST");
    assert.notEqual(postStart, -1);
    const postSource = source.slice(postStart);
    const gateIndex = postSource.indexOf("getReceiverFulfillmentPausedResponse()");
    const returnIndex = postSource.indexOf("if (pausedResponse) return pausedResponse");
    const firstSideEffectIndex = postSource.indexOf(route.firstSideEffect);

    assert.notEqual(gateIndex, -1);
    assert.notEqual(returnIndex, -1);
    assert.notEqual(firstSideEffectIndex, -1);
    assert.ok(gateIndex < returnIndex);
    assert.ok(returnIndex < firstSideEffectIndex);
  });
}

test("관리자 account-request update는 DB 변경·완료 메일 전에 pause gate를 검사하되 create는 열어 둔다", async () => {
  const source = await readFile(
    new URL("../src/app/api/account-requests/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /import \{ getReceiverFulfillmentPausedResponse \}/);

  const createStart = source.indexOf('if (action === "create")');
  const updateStart = source.indexOf('if (action === "update" && id)');
  const deleteStart = source.indexOf('if (action === "delete" && id)');
  assert.notEqual(createStart, -1);
  assert.notEqual(updateStart, -1);
  assert.notEqual(deleteStart, -1);
  assert.doesNotMatch(
    source.slice(createStart, updateStart),
    /getReceiverFulfillmentPausedResponse\(\)/,
  );

  const updateSource = source.slice(updateStart, deleteStart);
  const gateIndex = updateSource.indexOf("getReceiverFulfillmentPausedResponse()");
  const returnIndex = updateSource.indexOf("if (pausedResponse) return pausedResponse");
  const updateBuilderIndex = updateSource.indexOf("const updates:");
  const dbUpdateIndex = updateSource.indexOf(".update(accountRequests)");
  const emailIndex = updateSource.indexOf("sendAccountUpgradeCompletion(");
  for (const index of [gateIndex, returnIndex, updateBuilderIndex, dbUpdateIndex, emailIndex]) {
    assert.notEqual(index, -1);
  }
  assert.ok(gateIndex < returnIndex);
  assert.ok(returnIndex < updateBuilderIndex);
  assert.ok(returnIndex < dbUpdateIndex);
  assert.ok(returnIndex < emailIndex);
});

test("Market void 전이 API는 공급 pause와 무관하게 회수를 진행할 수 있다", async () => {
  const source = await readFile(
    new URL("../src/app/api/account-requests/market-void/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /getReceiverFulfillmentPausedResponse|RECEIVER_FULFILLMENT_PAUSED/);
  assert.match(source, /transition_market_order_void/);
});

test("계정 확인 GET과 Market 상태 조회는 pause gate로 막지 않는다", async () => {
  const confirmSource = await readFile(
    new URL("../src/app/api/account-confirm/[token]/route.ts", import.meta.url),
    "utf8",
  );
  const getStart = confirmSource.indexOf("export async function GET");
  const postStart = confirmSource.indexOf("export async function POST");
  assert.notEqual(getStart, -1);
  assert.notEqual(postStart, -1);
  assert.doesNotMatch(
    confirmSource.slice(getStart, postStart),
    /getReceiverFulfillmentPausedResponse\(\)/,
  );

  const statusSource = await readFile(
    new URL("../src/app/api/account-requests/market-status/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    statusSource,
    /getReceiverFulfillmentPausedResponse|RECEIVER_FULFILLMENT_PAUSED/,
  );
  assert.match(statusSource, /export async function GET/);
});
