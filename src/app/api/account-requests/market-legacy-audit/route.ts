export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import {
  marketLegacyOrderNoteMarker,
  toMarketLegacyAuditResponse,
  validateMarketLegacyAuditOrderNumber,
  type MarketLegacyAuditAggregateRow,
} from "@/lib/market-legacy-audit";
import { authorizeMarketStatusRequest } from "@/lib/market-status";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

function jsonNoStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

/**
 * 구 Market writer가 notes에만 남긴 주문번호를 PII 없이 집계한다.
 * 세션 쿠키 폴백은 없고, 조회 컬럼도 status별 aggregate로만 제한한다.
 * 양수는 강한 차단 신호지만 0은 notes 수정·삭제 가능성 때문에 과거 요청 부재를 증명하지 않는다.
 */
export async function GET(req: NextRequest) {
  const auth = authorizeMarketStatusRequest(
    req.headers.get("x-api-key"),
    process.env.INTEGRATION_API_KEY,
  );
  if (!auth.ok) {
    return jsonNoStore({ error: auth.error }, auth.status);
  }

  const queryKeys = [...req.nextUrl.searchParams.keys()];
  const orderNumbers = req.nextUrl.searchParams.getAll("orderNumber");
  if (
    queryKeys.length !== 1
    || queryKeys[0] !== "orderNumber"
    || orderNumbers.length !== 1
  ) {
    return jsonNoStore({ error: "Exactly one orderNumber query parameter is required" }, 400);
  }

  const validated = validateMarketLegacyAuditOrderNumber(orderNumbers[0]);
  if (!validated.ok) {
    return jsonNoStore({ error: validated.error }, 400);
  }

  const orderNumber = validated.value;
  const noteMarker = marketLegacyOrderNoteMarker(orderNumber);

  try {
    const [summary] = await db
      .select({
        legacyCount: sql<number>`count(*)::int`,
        draft: sql<number>`count(*) FILTER (WHERE ${accountRequests.status} = 'draft')::int`,
        sent: sql<number>`count(*) FILTER (WHERE ${accountRequests.status} = 'sent')::int`,
        processed: sql<number>`count(*) FILTER (WHERE ${accountRequests.status} = 'processed')::int`,
        invoiced: sql<number>`count(*) FILTER (WHERE ${accountRequests.status} = 'invoiced')::int`,
        paid: sql<number>`count(*) FILTER (WHERE ${accountRequests.status} = 'paid')::int`,
        other: sql<number>`count(*) FILTER (WHERE ${accountRequests.status} NOT IN ('draft', 'sent', 'processed', 'invoiced', 'paid'))::int`,
      })
      .from(accountRequests)
      .where(and(
        eq(accountRequests.channel, "company"),
        sql`POSITION(${noteMarker} IN ${accountRequests.notes}) > 0`,
        // strict Market identity 여섯 필드 중 하나라도 없거나 다르면 구 writer 후보다.
        or(
          isNull(accountRequests.externalSource),
          ne(accountRequests.externalSource, "market"),
          isNull(accountRequests.marketRequestId),
          isNull(accountRequests.marketOrderId),
          isNull(accountRequests.orderNumber),
          isNull(accountRequests.idempotencyKey),
          eq(accountRequests.draftOnly, false),
        ),
      ));

    return jsonNoStore(toMarketLegacyAuditResponse(
      orderNumber,
      summary as MarketLegacyAuditAggregateRow | undefined,
    ));
  } catch {
    console.error("[market-legacy-audit] aggregate query failed");
    return jsonNoStore({ error: "Failed to audit legacy Market requests" }, 500);
  }
}
