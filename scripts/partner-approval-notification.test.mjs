import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Snorkl 관리자 승인 안내 API는 로컬 승인과 같은 신청 항목을 재검증한다", async () => {
  const source = await readFile(new URL("../src/app/api/admin/partner-approval-notification/route.ts", import.meta.url), "utf8");
  assert.match(source, /eq\(accountRequests\.partnerRequestId, partnerRequestId\)/);
  assert.match(source, /!row\.processingEmailSentAt/);
  assert.match(source, /!row\.confirmedAt/);
  assert.match(source, /row\.partnerNotificationSentAt/);
  assert.match(source, /partnerNotificationOperationId: operationId/);
  assert.match(source, /status === "failed" \? null : operationId/);
  assert.match(source, /action: "preview"/);
  assert.match(source, /action: "send"/);
  assert.match(source, /action: "status"/);
  assert.match(source, /action: "review"/);
});

test("Market 콜백은 별도 비밀키만 사용하고 응답 유실 자동 재발송을 하지 않는다", async () => {
  const source = await readFile(new URL("../src/lib/market-partner-notification.ts", import.meta.url), "utf8");
  assert.match(source, /PARTNER_APPROVAL_CALLBACK_SECRET/);
  assert.match(source, /x-callback-secret/);
  assert.match(source, /AbortSignal\.timeout/);
  assert.doesNotMatch(source, /INTEGRATION_API_KEY|ADMIN_PASSWORD/);
});

test("관리자 UI는 승인 교사를 선택해 수신자 미리보기 후 발송하고 결과 불명을 수동 확인한다", async () => {
  const source = await readFile(new URL("../src/app/admin/accounts/page.tsx", import.meta.url), "utf8");
  assert.match(source, /협력사 승인 안내/);
  assert.match(source, /수신자·교사 미리보기/);
  assert.match(source, /확인 후 협력사에 발송/);
  assert.match(source, /Market 상태 확인/);
  assert.match(source, /Gmail에서 발송 확인/);
  assert.match(source, /미발송 확인/);
  assert.match(source, /계정 이메일과 과목은 포함되지 않습니다/);
  assert.doesNotMatch(source, />정산</);
});

test("통보 상태는 기존 0018의 operationId와 sentAt으로 표현해 추가 마이그레이션을 만들지 않는다", async () => {
  const schema = await readFile(new URL("../src/db/schema.ts", import.meta.url), "utf8");
  assert.match(schema, /partnerNotificationOperationId/);
  assert.match(schema, /partnerNotificationSentAt/);
  assert.doesNotMatch(schema, /partnerNotificationState/);
});
