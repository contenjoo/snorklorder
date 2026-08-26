export const MARKET_LEGACY_AUDIT_MAX_ORDER_NUMBER_LENGTH = 200;

export const MARKET_LEGACY_AUDIT_STATUS_KEYS = [
  "draft",
  "sent",
  "processed",
  "invoiced",
  "paid",
  "other",
] as const;

export type MarketLegacyAuditStatusKey = (typeof MARKET_LEGACY_AUDIT_STATUS_KEYS)[number];

const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const LEGACY_ORDER_NOTE_PATTERN = /\/ 주문번호: ([A-Za-z0-9][A-Za-z0-9._:/-]{0,199}) \//;

export type MarketLegacyAuditOrderNumberResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export interface MarketLegacyAuditAggregateRow {
  legacyCount: number | string | null;
  draft: number | string | null;
  sent: number | string | null;
  processed: number | string | null;
  invoiced: number | string | null;
  paid: number | string | null;
  other: number | string | null;
}

export interface MarketLegacyAuditResponse {
  orderNumber: string;
  legacyCount: number;
  statuses: Record<MarketLegacyAuditStatusKey, number>;
}

/** 공백 보정 없이 Market reference 문자 1~200자만 받는다. */
export function validateMarketLegacyAuditOrderNumber(
  value: unknown,
): MarketLegacyAuditOrderNumberResult {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > MARKET_LEGACY_AUDIT_MAX_ORDER_NUMBER_LENGTH
    || !ORDER_NUMBER_PATTERN.test(value)
  ) {
    return { ok: false, error: "orderNumber must be a valid 1-200 character reference" };
  }
  return { ok: true, value };
}

/** 구 writer가 notes에 남긴 주문번호 표식과 정확히 같은 substring을 만든다. */
export function marketLegacyOrderNoteMarker(orderNumber: string): string {
  return `/ 주문번호: ${orderNumber} /`;
}

/** stale 구 writer의 Market order notes 표식을 자유문장 전체와 분리해 판정한다. */
export function hasMarketLegacyOrderNote(value: unknown): value is string {
  return typeof value === "string" && LEGACY_ORDER_NOTE_PATTERN.test(value);
}

function toCount(value: number | string | null | undefined): number {
  const count = Number(value ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

/**
 * 응답은 주문번호·총계·고정 status bucket 외 어떤 DB 필드도 내보내지 않는다.
 * legacyCount=0은 현재 남아 있는 exact notes 표식이 없다는 뜻일 뿐, 과거 요청 부재 증거가 아니다.
 */
export function toMarketLegacyAuditResponse(
  orderNumber: string,
  row: MarketLegacyAuditAggregateRow | undefined,
): MarketLegacyAuditResponse {
  return {
    orderNumber,
    legacyCount: toCount(row?.legacyCount),
    statuses: {
      draft: toCount(row?.draft),
      sent: toCount(row?.sent),
      processed: toCount(row?.processed),
      invoiced: toCount(row?.invoiced),
      paid: toCount(row?.paid),
      other: toCount(row?.other),
    },
  };
}
