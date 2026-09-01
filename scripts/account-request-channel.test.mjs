import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ACCOUNT_REQUEST_CHANNELS,
  ACCOUNT_REQUEST_CHANNEL_VALUES,
  isAccountRequestChannel,
} from "../src/lib/account-request-channel.ts";

test("정산 요청 구매처는 회사몰·학교장터·협력사를 구분한다", () => {
  assert.deepEqual(ACCOUNT_REQUEST_CHANNEL_VALUES, ["company", "school_store", "partner"]);
  assert.deepEqual(
    ACCOUNT_REQUEST_CHANNELS.map(({ value, label }) => ({ value, label })),
    [
      { value: "company", label: "회사몰" },
      { value: "school_store", label: "학교장터" },
      { value: "partner", label: "협력사" },
    ],
  );

  for (const channel of ACCOUNT_REQUEST_CHANNEL_VALUES) {
    assert.equal(isAccountRequestChannel(channel), true);
  }
  for (const invalid of [undefined, null, "", "reseller", "partner ", 1]) {
    assert.equal(isAccountRequestChannel(invalid), false);
  }
});

test("관리자 화면과 API가 공통 구매처 정의를 사용한다", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../src/app/admin/accounts/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/account-requests/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const CHANNELS = ACCOUNT_REQUEST_CHANNELS/);
  assert.match(page, /channelInfo\.value === "partner"/);
  assert.match(page, /\{channelInfo\.label\}/);
  assert.match(route, /isAuthenticated && data\.channel !== undefined && !isAccountRequestChannel\(data\.channel\)/);
  assert.match(route, /if \(data\.channel !== undefined && !isAccountRequestChannel\(data\.channel\)\)/);
  assert.match(route, /const VALID_CHANNELS = \["company", "school_store"\] as const/);
});
