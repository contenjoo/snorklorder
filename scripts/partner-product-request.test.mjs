import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsePartnerBatch } from "../src/lib/partner-product-request.ts";

const valid = {
  requestKind: "partner_product",
  channel: "partner",
  operationId: "partner-product:request-12345678:1:upsert",
  revision: 1,
  mode: "upsert",
  schoolName: "테스트초등학교",
  schoolNameEn: "Test Elementary School",
  items: [
    { itemId: "teacher-item-0001", teacherName: "김교사", accountEmail: "KIM@SCHOOL.KR", subject: "수학" },
    { itemId: "teacher-item-0002", teacherName: "이교사", accountEmail: "lee@school.kr", subject: "과학" },
  ],
};

test("협력사 배치 계약은 학교와 여러 교사 행을 정규화한다", () => {
  const parsed = parsePartnerBatch(valid);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.items.length, 2);
  assert.equal(parsed.value.items[0].accountEmail, "kim@school.kr");
  assert.equal(parsed.value.requestKind, "partner_product");
  assert.equal(parsed.value.channel, "partner");
  assert.equal(parsed.value.schoolNameEn, "Test Elementary School");
  assert.match(parsed.value.payloadHash, /^[a-f0-9]{64}$/);
});

test("중복 이메일·중복 항목·빈 과목과 다른 채널을 거절한다", () => {
  const duplicateEmail = structuredClone(valid);
  duplicateEmail.items[1].accountEmail = "kim@school.kr";
  assert.equal(parsePartnerBatch(duplicateEmail).ok, false);

  const duplicateItem = structuredClone(valid);
  duplicateItem.items[1].itemId = duplicateItem.items[0].itemId;
  assert.equal(parsePartnerBatch(duplicateItem).ok, false);

  const emptySubject = structuredClone(valid);
  emptySubject.items[0].subject = " ";
  assert.equal(parsePartnerBatch(emptySubject).ok, false);

  assert.equal(parsePartnerBatch({ ...valid, channel: "company" }).ok, false);
  assert.equal(parsePartnerBatch({ ...valid, schoolNameEn: "테스트초등학교" }).ok, false);
});

test("취소 계약은 빈 항목만 허용하고 revision과 payload를 고정한다", () => {
  const cancel = parsePartnerBatch({ ...valid, operationId: "partner-product:request-12345678:2:cancel", revision: 2, mode: "cancel", items: [] });
  assert.equal(cancel.ok, true);
  assert.equal(parsePartnerBatch({ ...valid, mode: "cancel" }).ok, false);
});

test("수신 route는 인증·트랜잭션·revision 충돌·초안·인보이스·멱등 원장을 강제한다", async () => {
  const source = await readFile(new URL("../src/app/api/account-requests/market-partner/[partnerRequestId]/route.ts", import.meta.url), "utf8");
  assert.match(source, /authorizeMarketStatusRequest/);
  assert.match(source, /createPartnerTransactionDb/);
  assert.match(source, /const db = createPartnerTransactionDb\(\)/);
  assert.match(source, /db\.transaction/);
  assert.match(source, /db\.\$client\.end\(\)/);
  assert.match(source, /partnerRequestOperations/);
  assert.match(source, /latestOperation/);
  assert.match(source, /desc\(partnerRequestOperations\.revision\)/);
  assert.match(source, /latestOperation\.revision > batch\.revision/);
  assert.match(source, /latestOperation\?\.mode === 'cancel' && batch\.mode === 'upsert'/);
  assert.match(source, /CANCELLED_REQUEST/);
  assert.match(source, /STALE_REVISION/);
  assert.match(source, /REVISION_PAYLOAD_CONFLICT/);
  assert.match(source, /HQ_DELIVERY_STARTED/);
  assert.match(source, /needsInvoice:\s*true/);
  assert.match(source, /schoolNameEn:\s*batch\.schoolNameEn/);
  assert.match(source, /status:\s*'draft'/);
  assert.match(source, /externalSource:\s*'market_partner'/);
  assert.doesNotMatch(source, /partnerEmail|partnerName|recipientEmail/);
});

test("협력사 배치 트랜잭션은 neon-http가 아닌 WebSocket 드라이버를 사용한다", async () => {
  const source = await readFile(new URL("../src/db/transaction.ts", import.meta.url), "utf8");
  const nextConfig = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(source, /drizzle-orm\/neon-serverless/);
  assert.match(source, /ws:\s*WebSocket/);
  assert.doesNotMatch(source, /drizzle-orm\/neon-http/);
  assert.match(nextConfig, /serverExternalPackages:[\s\S]*"ws"/);
});

test("DB migration은 신청 항목 유일성·소프트 취소·operation 멱등성을 보존한다", async () => {
  const sql = await readFile(new URL("../drizzle/0018_partner_product_requests.sql", import.meta.url), "utf8");
  assert.match(sql, /BEGIN;/);
  assert.match(sql, /partner_lifecycle_state IN \('active', 'cancelled'\)/);
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS account_requests_partner_item_unique_idx/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS partner_request_operations/);
  assert.match(sql, /operation_id text PRIMARY KEY/);
  assert.match(sql, /COMMIT;/);

  const apply = await readFile(new URL("./apply-0018.mjs", import.meta.url), "utf8");
  assert.match(apply, /PARTNER_PRODUCT_MIGRATION_APPLY === "YES_0018"/);
  assert.match(apply, /process\.argv\.includes\("--apply"\)/);
  assert.match(apply, /DB 변경 없음/);
  assert.match(apply, /row count/);
});

test("Jon 승인 route는 발송 전 draft와 다른 신청 혼입을 막고 협력사 교사 메일을 억제한다", async () => {
  const source = await readFile(new URL("../src/app/api/account-confirm/[token]/route.ts", import.meta.url), "utf8");
  assert.match(source, /Request has not been sent to HQ/);
  assert.match(source, /s\.channel === 'partner'/);
  assert.match(source, /s\.partnerRequestId === r\.partnerRequestId/);
  assert.match(source, /s\.processingEmailSentAt/);
  assert.match(source, /r\.channel === 'partner'\s*\? \[\]/);
  assert.match(source, /confirmedAt:\s*confirmationAt/);
});

test("관리자 UI는 협력사 태그·신청 묶음·본사 발송 미리보기를 제공한다", async () => {
  const source = await readFile(new URL("../src/app/admin/accounts/page.tsx", import.meta.url), "utf8");
  assert.match(source, /협력사 신청 묶음/);
  assert.match(source, /본사 발송 미리보기/);
  assert.match(source, /partnerRequestId/);
  assert.match(source, /teacherName/);
  assert.match(source, /subject/);
  assert.match(source, /externalSource === "market_partner"/);
});

test("메일 stream 운송은 비운영 E2E에서만 허용한다", async () => {
  const source = await readFile(new URL("../src/lib/email.ts", import.meta.url), "utf8");
  assert.match(source, /process\.env\.NODE_ENV !== "production"/);
  assert.match(source, /process\.env\.EMAIL_TRANSPORT_MODE === "stream"/);
  assert.match(source, /streamTransport:\s*true/);
});
