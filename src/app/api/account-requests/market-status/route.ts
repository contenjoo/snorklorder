export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests, marketOrderVoidFences } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  authorizeMarketStatusRequest,
  toMarketStatusItem,
} from "@/lib/market-status";

/**
 * Market 전용 상태 되읽기 — 읽기 전용, 기계 전용(x-api-key).
 *
 * 관리자 세션 쿠키용 GET /api/account-requests 와는 별개 경로이며 세션 폴백이 없다.
 * 응답 필드는 lib/market-status 의 화이트리스트로 제한한다 — 그 외 컬럼은
 * select 단계에서부터 배제해 어떤 경로로도 응답에 실리지 않게 한다.
 */
export async function GET(req: NextRequest) {
  const auth = authorizeMarketStatusRequest(
    req.headers.get("x-api-key"),
    process.env.INTEGRATION_API_KEY,
  );
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const marketOrderId = req.nextUrl.searchParams.get("marketOrderId")?.trim() || null;
  const voidState = req.nextUrl.searchParams.get("voidState")?.trim() || null;
  if (marketOrderId && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(marketOrderId)) {
    return NextResponse.json({ error: "Invalid marketOrderId" }, { status: 400 });
  }
  if (voidState && !["active", "non_voidable", "prepared", "voided"].includes(voidState)) {
    return NextResponse.json({ error: "Invalid voidState" }, { status: 400 });
  }

  const effectiveVoidState = sql<string>`COALESCE(
    ${marketOrderVoidFences.state},
    ${accountRequests.marketVoidState}
  )`;

  const rows = await db
    .select({
      id: accountRequests.id,
      status: accountRequests.status,
      type: accountRequests.type,
      schoolName: accountRequests.schoolName,
      emails: accountRequests.emails,
      applicantType: accountRequests.applicantType,
      externalSource: accountRequests.externalSource,
      marketRequestId: accountRequests.marketRequestId,
      marketOrderId: accountRequests.marketOrderId,
      orderNumber: accountRequests.orderNumber,
      idempotencyKey: accountRequests.idempotencyKey,
      marketVoidState: effectiveVoidState,
      marketVoidOperationId: marketOrderVoidFences.operationId,
      marketVoidVersion: sql<number>`COALESCE(${marketOrderVoidFences.version}, 0)`,
      marketVoidPreparedAt: sql<Date | null>`COALESCE(
        ${marketOrderVoidFences.preparedAt},
        ${accountRequests.marketVoidPreparedAt}
      )`,
      marketVoidedAt: sql<Date | null>`COALESCE(
        ${marketOrderVoidFences.voidedAt},
        ${accountRequests.marketVoidedAt}
      )`,
      updatedAt: accountRequests.updatedAt,
    })
    .from(accountRequests)
    .leftJoin(
      marketOrderVoidFences,
      eq(marketOrderVoidFences.marketOrderId, accountRequests.marketOrderId),
    )
    .where(and(
      eq(accountRequests.externalSource, "market"),
      ...(marketOrderId ? [eq(accountRequests.marketOrderId, marketOrderId)] : []),
      ...(voidState ? [eq(effectiveVoidState, voidState)] : []),
    ))
    .orderBy(desc(accountRequests.updatedAt));

  return NextResponse.json({ requests: rows.map(toMarketStatusItem) });
}
