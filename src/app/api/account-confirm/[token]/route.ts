export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { eq } from "drizzle-orm";

// GET: 토큰으로 요청 상세 조회 (Jon이 확인 페이지 열었을 때)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [r] = await db
    .select()
    .from(accountRequests)
    .where(eq(accountRequests.confirmToken, token));

  if (!r) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  return NextResponse.json({ request: r });
}

// POST: Jon이 "Upgrade Done" 클릭 → status=processed
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [r] = await db
    .select()
    .from(accountRequests)
    .where(eq(accountRequests.confirmToken, token));

  if (!r) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });
  }

  await db
    .update(accountRequests)
    .set({ status: "processed", confirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(accountRequests.id, r.id));

  return NextResponse.json({ success: true });
}
