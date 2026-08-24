export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { desc } from "drizzle-orm";
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
      updatedAt: accountRequests.updatedAt,
    })
    .from(accountRequests)
    .orderBy(desc(accountRequests.updatedAt));

  return NextResponse.json({ requests: rows.map(toMarketStatusItem) });
}
