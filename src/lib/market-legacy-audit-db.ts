import { sql } from "drizzle-orm";
import { accountRequests } from "@/db/schema";
import { MARKET_LEGACY_ORDER_NOTE_PATTERN_SOURCE } from "@/lib/market-legacy-audit";

export function marketLegacyCompanyChannelCondition() {
  return sql<boolean>`COALESCE(NULLIF(${accountRequests.channel}, ''), 'company') = 'company'`;
}

export function marketLegacyIdentityMissingCondition() {
  return sql<boolean>`(
    ${accountRequests.externalSource} IS DISTINCT FROM 'market'
    OR NULLIF(BTRIM(${accountRequests.marketRequestId}), '') IS NULL
    OR NULLIF(BTRIM(${accountRequests.marketOrderId}), '') IS NULL
    OR NULLIF(BTRIM(${accountRequests.orderNumber}), '') IS NULL
    OR NULLIF(BTRIM(${accountRequests.idempotencyKey}), '') IS NULL
    OR ${accountRequests.draftOnly} IS DISTINCT FROM true
  )`;
}

/**
 * legacy Market 감사 행을 운영 후보·집계에서 빼는 DB 조건.
 *
 * 원본 행은 account-requests 감사 목록에 남겨야 하므로 전역 숨김이 아니라,
 * 메일·인보이스·파트너/학교 현황처럼 "처리 가능" 데이터에만 적용한다.
 */
export function nonLegacyMarketAuditCondition() {
  return sql<boolean>`NOT (
    ${marketLegacyCompanyChannelCondition()}
    AND COALESCE(
      ${accountRequests.notes} ~ ${MARKET_LEGACY_ORDER_NOTE_PATTERN_SOURCE},
      false
    )
    AND ${marketLegacyIdentityMissingCondition()}
  )`;
}
