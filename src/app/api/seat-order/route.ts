export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { checkRateLimit, createRateLimitResponse, isValidEmail, normalizeText } from "@/lib/security";
import { sendSeatOrderLink } from "@/lib/email";

// 구매자가 1~3인 좌석을 주문 → accountRequest 생성 + 셀프등록 링크 이메일 발송
export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit({
    request: req,
    key: "seat-order",
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (!rateLimit.ok) {
    return createRateLimitResponse("Too many requests. Please try again later.", rateLimit.retryAfter);
  }

  let body: { purchaserEmail?: unknown; schoolName?: unknown; schoolNameEn?: unknown; quantity?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const purchaserEmail = String(body.purchaserEmail || "").trim().toLowerCase();
  const schoolName = normalizeText(String(body.schoolName || ""), 120);
  const schoolNameEn = body.schoolNameEn ? normalizeText(String(body.schoolNameEn), 120) : null;
  const quantity = Number(body.quantity);

  if (!isValidEmail(purchaserEmail)) {
    return NextResponse.json({ error: "유효한 이메일을 입력해주세요." }, { status: 400 });
  }
  if (!schoolName) {
    return NextResponse.json({ error: "학교/소속명을 입력해주세요." }, { status: 400 });
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3) {
    return NextResponse.json({ error: "좌석 수는 1, 2, 3 중에서 선택해주세요." }, { status: 400 });
  }

  const token = randomBytes(16).toString("hex");

  const [item] = await db
    .insert(accountRequests)
    .values({
      channel: "company",
      applicantType: "individual",
      type: "upgrade",
      schoolName,
      schoolNameEn,
      emails: purchaserEmail, // 구매자 이메일 (셀프등록 후 교사 이메일로 교체됨)
      accountType: "teacher",
      quantity,
      notes: `[SEAT_ORDER] Purchaser: ${purchaserEmail}`,
      status: "draft",
      confirmToken: token,
    })
    .returning();

  try {
    const result = await sendSeatOrderLink(purchaserEmail, schoolNameEn || schoolName, quantity, token);
    if (!result.success) {
      // 메일은 실패했지만 요청은 저장됨 → 토큰 반환해서 화면에서 안내
      return NextResponse.json({
        success: true,
        requestId: item.id,
        emailSent: false,
        token,
        warning: result.error || "Email could not be sent",
      });
    }
  } catch (err) {
    // 메일 실패 시 요청 롤백 (관리자 혼선 방지)
    await db.delete(accountRequests).where(eq(accountRequests.id, item.id));
    console.error("Seat order email error:", err);
    return NextResponse.json({ error: "이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요." }, { status: 500 });
  }

  return NextResponse.json({ success: true, requestId: item.id, emailSent: true });
}
