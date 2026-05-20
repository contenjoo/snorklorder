export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests, teachers } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { sendTeacherUpgradedEmail } from "@/lib/email";

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

  // 교사 환영 메일은 응답 후 백그라운드로 발송
  const emails = (r.emails || "")
    .split(/[,;\n]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

  if (emails.length > 0) {
    void (async () => {
      try {
        const matched = await db
          .select({ email: teachers.email, name: teachers.name })
          .from(teachers)
          .where(inArray(teachers.email, emails));
        const nameByEmail = new Map(matched.map((t) => [t.email.toLowerCase(), t.name]));

        const results = await Promise.allSettled(
          emails.map((email) =>
            sendTeacherUpgradedEmail({
              name: nameByEmail.get(email) || "선생님",
              email,
              schoolName: r.schoolName,
              schoolNameEn: r.schoolNameEn,
            })
          )
        );
        const failed = results.filter((res) => res.status === "rejected" || (res.status === "fulfilled" && !res.value.success && !res.value.skipped)).length;
        if (failed > 0) console.warn(`[account-confirm] ${failed}/${emails.length} teacher emails failed`);
      } catch (err) {
        console.warn("[account-confirm] notification email failed:", err);
      }
    })();
  }

  return NextResponse.json({ success: true });
}
