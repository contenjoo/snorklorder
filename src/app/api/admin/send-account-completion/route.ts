export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { checkAuth } from "@/lib/auth";
import { sendAccountUpgradeCompletion } from "@/lib/email";
import { claimAccountRequestSideEffects } from "@/lib/market-void-db";
import { getReceiverFulfillmentPausedResponse } from "@/lib/receiver-fulfillment-pause";

// 정산(account_requests) 건의 교사들에게 활성화 완료 메일 수동 발송/재발송
export async function POST(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pausedResponse = getReceiverFulfillmentPausedResponse();
  if (pausedResponse) return pausedResponse;

  const body = await req.json();
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id required" }, { status: 400 });

  const [item] = await db.select().from(accountRequests).where(eq(accountRequests.id, id));
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await claimAccountRequestSideEffects([item.id]))) {
    return NextResponse.json({
      code: "MARKET_VOID_FENCED",
      error: "This Market order is being cancelled or has already been voided.",
    }, { status: 409 });
  }

  const result = await sendAccountUpgradeCompletion({
    emails: item.emails,
    schoolName: item.schoolName,
    schoolNameEn: item.schoolNameEn,
  });
  return NextResponse.json({ ok: true, ...result });
}
