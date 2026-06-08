export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { schoolAdmins, schools } from "@/db/schema";
import { checkAuth } from "@/lib/auth";
import { isValidEmail, normalizeText } from "@/lib/security";

// 학교 관리자(공동구매 총무) 이메일 등록/조회/삭제 — 매직링크 로그인 대상 시드
export async function GET(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const schoolIdParam = req.nextUrl.searchParams.get("schoolId");

  const base = db
    .select({
      id: schoolAdmins.id,
      schoolId: schoolAdmins.schoolId,
      email: schoolAdmins.email,
      role: schoolAdmins.role,
      createdAt: schoolAdmins.createdAt,
      schoolName: schools.name,
      schoolNameEn: schools.nameEn,
    })
    .from(schoolAdmins)
    .innerJoin(schools, eq(schoolAdmins.schoolId, schools.id));

  const rows = schoolIdParam
    ? await base.where(eq(schoolAdmins.schoolId, Number(schoolIdParam))).orderBy(desc(schoolAdmins.createdAt))
    : await base.orderBy(desc(schoolAdmins.createdAt));

  return NextResponse.json({ admins: rows });
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const schoolId = Number(body.schoolId);
  const email = normalizeText(String(body.email ?? ""), 254).toLowerCase();

  if (!Number.isInteger(schoolId) || schoolId <= 0 || !isValidEmail(email)) {
    return NextResponse.json({ error: "Valid schoolId and email required" }, { status: 400 });
  }

  // 학교 존재 확인
  const [school] = await db.select({ id: schools.id }).from(schools).where(eq(schools.id, schoolId));
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

  try {
    const [created] = await db
      .insert(schoolAdmins)
      .values({ schoolId, email })
      .returning({ id: schoolAdmins.id });
    return NextResponse.json({ success: true, id: created.id });
  } catch {
    // (school_id, email) unique index 충돌 등
    return NextResponse.json({ error: "Already registered for this school" }, { status: 409 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  await db.delete(schoolAdmins).where(eq(schoolAdmins.id, id));
  return NextResponse.json({ success: true });
}
