export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isValidEmail, normalizeText } from "@/lib/security";

interface SubmittedTeacher {
  name?: unknown;
  email?: unknown;
  subject?: unknown;
}

function isSeatOrder(notes: string | null) {
  return !!notes && notes.startsWith("[SEAT_ORDER]");
}

// GET: 토큰으로 좌석 주문 정보 조회 (구매자가 셀프등록 페이지 열었을 때)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const [r] = await db
    .select()
    .from(accountRequests)
    .where(eq(accountRequests.confirmToken, token));

  if (!r || !isSeatOrder(r.notes)) {
    return NextResponse.json({ error: "유효하지 않거나 만료된 링크입니다." }, { status: 404 });
  }

  const submitted = r.status !== "draft";

  return NextResponse.json({
    schoolName: r.schoolName,
    schoolNameEn: r.schoolNameEn,
    quantity: r.quantity || 1,
    status: r.status,
    submitted,
    emails: submitted ? r.emails : null,
  });
}

// POST: 구매자가 N명의 교사 정보를 제출
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const [r] = await db
    .select()
    .from(accountRequests)
    .where(eq(accountRequests.confirmToken, token));

  if (!r || !isSeatOrder(r.notes)) {
    return NextResponse.json({ error: "유효하지 않거나 만료된 링크입니다." }, { status: 404 });
  }
  if (r.status !== "draft") {
    return NextResponse.json({ error: "이미 등록이 완료된 링크입니다." }, { status: 409 });
  }

  let body: { teachers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const list = Array.isArray(body.teachers) ? (body.teachers as SubmittedTeacher[]) : [];
  const quantity = r.quantity || 1;

  if (list.length === 0) {
    return NextResponse.json({ error: "최소 1명 이상 입력해주세요." }, { status: 400 });
  }
  if (list.length > quantity) {
    return NextResponse.json({ error: `좌석 수(${quantity})를 초과했습니다.` }, { status: 400 });
  }

  const cleaned: { name: string; email: string; subject: string | null }[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const name = normalizeText(String(item.name || ""), 60);
    const email = String(item.email || "").trim().toLowerCase();
    const subject = item.subject ? normalizeText(String(item.subject), 60) : null;
    if (!name) return NextResponse.json({ error: "이름은 필수입니다." }, { status: 400 });
    if (!isValidEmail(email)) return NextResponse.json({ error: `유효하지 않은 이메일: ${email}` }, { status: 400 });
    if (seen.has(email)) return NextResponse.json({ error: `중복된 이메일: ${email}` }, { status: 400 });
    seen.add(email);
    cleaned.push({ name, email, subject });
  }

  const purchaserMatch = (r.notes || "").match(/Purchaser:\s*([^\s|]+)/);
  const purchaserEmail = purchaserMatch?.[1] || "";

  const updatedNotes = [
    `[SEAT_ORDER] Purchaser: ${purchaserEmail}`,
    ...cleaned.map((t, i) => `Teacher ${i + 1}: ${t.name} <${t.email}>${t.subject ? ` · ${t.subject}` : ""}`),
  ].join("\n");

  await db
    .update(accountRequests)
    .set({
      emails: cleaned.map((t) => t.email).join(", "),
      notes: updatedNotes,
      status: "sent",
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(accountRequests.id, r.id));

  return NextResponse.json({ success: true, count: cleaned.length });
}
