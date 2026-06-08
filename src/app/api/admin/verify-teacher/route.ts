export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { teachers } from "@/db/schema";
import { checkAuth } from "@/lib/auth";

// 본사(HQ) 검증 큐 처리: 학교 관리자 부재/타임아웃으로 이관된 교사 승인·거절
export async function POST(req: NextRequest) {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();
  const { ids, action, reason } = body as { ids: number[]; action: "approve" | "reject"; reason?: string };

  const cleanIds = Array.isArray(ids) ? ids.filter((id) => Number.isInteger(id)) : [];
  if (cleanIds.length === 0 || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "ids and valid action required" }, { status: 400 });
  }

  if (action === "approve") {
    await db
      .update(teachers)
      .set({ verificationStatus: "approved", approvedAt: new Date(), approvedBy: "hq" })
      .where(inArray(teachers.id, cleanIds));
  } else {
    await db
      .update(teachers)
      .set({ verificationStatus: "rejected", rejectedReason: reason ? String(reason).slice(0, 500) : null })
      .where(inArray(teachers.id, cleanIds));
  }

  return NextResponse.json({ success: true, updated: cleanIds.length, action });
}
