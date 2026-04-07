export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schoolRequests } from "@/db/schema";
import { desc } from "drizzle-orm";

// POST: 교사가 학교 등록 요청 (public)
export async function POST(req: NextRequest) {
  const { name, nameEn, region, contactName, contactEmail } = await req.json();

  if (!name || !contactName || !contactEmail) {
    return NextResponse.json({ error: "학교명, 담당자 이름, 이메일은 필수입니다." }, { status: 400 });
  }

  const [request] = await db
    .insert(schoolRequests)
    .values({
      name: name.trim(),
      nameEn: nameEn?.trim() || null,
      region: region || null,
      contactName: contactName.trim(),
      contactEmail: contactEmail.trim().toLowerCase(),
    })
    .returning();

  // 관리자에게 알림 이메일 (non-blocking)
  import("@/lib/email").then(({ sendAdminNotification }) => {
    sendAdminNotification(request).catch(console.error);
  });

  return NextResponse.json({ success: true, request });
}

// GET: 관리자용 요청 목록 (admin protected by middleware)
export async function GET() {
  const result = await db
    .select()
    .from(schoolRequests)
    .orderBy(desc(schoolRequests.createdAt));

  return NextResponse.json(result);
}
