/**
 * Market 상태 되읽기(read-back) 계약.
 *
 * market(edumarket)이 이 앱의 계정요청 상태를 폴링해 자기 쪽 상태를 동기화할 때 쓰는
 * 읽기 전용 응답 형태와 API 키 판정을 한 곳에서 정의한다. 이 앱이 단일 진실(SSOT)이다.
 *
 * 필드 화이트리스트가 핵심 — 여기 나열된 필드 외(청구 금액, 결제 링크, 메일 식별자,
 * 확인 토큰, 관리자 메모 등)는 어떤 경우에도 응답에 포함하지 않는다 (개인·금융정보 최소화).
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const MARKET_STATUS_FIELDS = [
  "id",
  "status",
  "type",
  "schoolName",
  "emails",
  "applicantType",
  "externalSource",
  "marketRequestId",
  "marketOrderId",
  "orderNumber",
  "idempotencyKey",
  "channel",
  "partnerRequestId",
  "partnerItemId",
  "partnerRevision",
  "teacherName",
  "subject",
  "partnerLifecycleState",
  "confirmedAt",
  "processingEmailSentAt",
  "partnerNotificationSentAt",
  "marketVoidState",
  "marketVoidOperationId",
  "marketVoidVersion",
  "marketVoidPreparedAt",
  "marketVoidedAt",
  "updatedAt",
] as const;

export type MarketStatusField = (typeof MARKET_STATUS_FIELDS)[number];

export type MarketStatusAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * 기계 전용 인증 — 세션 쿠키 폴백 없음.
 * 키 미설정(503)은 서버 구성 문제, 키 누락/불일치(401)는 호출자 문제로 구분해 응답한다.
 * 빈 문자열 키는 미설정으로 취급해 "" === "" 우회를 막는다 (POST create 계약과 동일한 가드).
 */
export function authorizeMarketStatusRequest(
  providedKey: string | null,
  configuredKey: string | undefined,
): MarketStatusAuthResult {
  if (!configuredKey) {
    return { ok: false, status: 503, error: "integration not configured" };
  }
  if (!providedKey) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const providedDigest = createHash("sha256").update(providedKey).digest();
  const configuredDigest = createHash("sha256").update(configuredKey).digest();
  if (!timingSafeEqual(providedDigest, configuredDigest)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

export interface MarketStatusSourceRow {
  id: number;
  status: string;
  type: string;
  schoolName: string;
  emails: string;
  applicantType: string;
  externalSource: string | null;
  marketRequestId: string | null;
  marketOrderId: string | null;
  orderNumber: string | null;
  idempotencyKey: string | null;
  channel: string;
  partnerRequestId: string | null;
  partnerItemId: string | null;
  partnerRevision: number | null;
  teacherName: string | null;
  subject: string | null;
  partnerLifecycleState: string;
  confirmedAt: Date | string | null;
  processingEmailSentAt: Date | string | null;
  partnerNotificationSentAt: Date | string | null;
  marketVoidState: string;
  marketVoidOperationId: string | null;
  marketVoidVersion: number;
  marketVoidPreparedAt: Date | string | null;
  marketVoidedAt: Date | string | null;
  updatedAt: Date | string;
}

export interface MarketStatusItem {
  id: string;
  status: string;
  type: string;
  schoolName: string;
  emails: string;
  applicantType: string;
  externalSource: string | null;
  marketRequestId: string | null;
  marketOrderId: string | null;
  orderNumber: string | null;
  idempotencyKey: string | null;
  channel: string;
  partnerRequestId: string | null;
  partnerItemId: string | null;
  partnerRevision: number | null;
  teacherName: string | null;
  subject: string | null;
  partnerLifecycleState: string;
  confirmedAt: string | null;
  processingEmailSentAt: string | null;
  partnerNotificationSentAt: string | null;
  marketVoidState: string;
  marketVoidOperationId: string | null;
  marketVoidVersion: number;
  marketVoidPreparedAt: string | null;
  marketVoidedAt: string | null;
  updatedAt: string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNullableIsoString(value: Date | string | null): string | null {
  return value == null ? null : toIsoString(value);
}

/**
 * 화이트리스트 필드만 명시적으로 복사한다 (spread 금지 — 스키마에 컬럼이 늘어나도 새지 않게).
 * id는 market이 externalRequestId를 String(...)으로 저장하므로 문자열로 맞춘다.
 */
export function toMarketStatusItem(row: MarketStatusSourceRow): MarketStatusItem {
  return {
    id: String(row.id),
    status: row.status,
    type: row.type,
    schoolName: row.schoolName,
    emails: row.emails,
    applicantType: row.applicantType,
    externalSource: row.externalSource ?? null,
    marketRequestId: row.marketRequestId ?? null,
    marketOrderId: row.marketOrderId ?? null,
    orderNumber: row.orderNumber ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    channel: row.channel,
    partnerRequestId: row.partnerRequestId ?? null,
    partnerItemId: row.partnerItemId ?? null,
    partnerRevision: row.partnerRevision ?? null,
    teacherName: row.teacherName ?? null,
    subject: row.subject ?? null,
    partnerLifecycleState: row.partnerLifecycleState,
    confirmedAt: toNullableIsoString(row.confirmedAt),
    processingEmailSentAt: toNullableIsoString(row.processingEmailSentAt),
    partnerNotificationSentAt: toNullableIsoString(row.partnerNotificationSentAt),
    marketVoidState: row.marketVoidState,
    marketVoidOperationId: row.marketVoidOperationId ?? null,
    marketVoidVersion: row.marketVoidVersion,
    marketVoidPreparedAt: toNullableIsoString(row.marketVoidPreparedAt),
    marketVoidedAt: toNullableIsoString(row.marketVoidedAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}
