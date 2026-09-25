import { secretEquals } from "@/lib/api-key";
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schools, teachers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import { isValidEmail, normalizeText } from "@/lib/security";

interface SyncBody {
  schoolName?: string;
  schoolNameEn?: string | null;
  region?: string | null;
  team?: string | null;
  teacherName?: string;
  email?: string;
}

const TEAM_REGEX = /^(?:서울|경기|인천|부산|대구|광주|대전|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)\d+팀$/;

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const validApiKey = process.env.INTEGRATION_API_KEY;
  if (!secretEquals(apiKey, validApiKey)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as SyncBody;
    const { team } = body;
    let { schoolName, schoolNameEn, region, teacherName, email } = body;

    if (typeof schoolName !== "string" || typeof teacherName !== "string" || typeof email !== "string") {
      return NextResponse.json({ error: "schoolName, teacherName, email required" }, { status: 400 });
    }
    if ([schoolNameEn, region, team].some((v) => v != null && typeof v !== "string")) {
      return NextResponse.json({ error: "schoolNameEn, region, team must be strings" }, { status: 400 });
    }

    schoolName = normalizeText(schoolName, 120);
    schoolNameEn = schoolNameEn ? normalizeText(schoolNameEn, 160) : null;
    teacherName = normalizeText(teacherName, 80);
    region = region ? normalizeText(region, 40) : null;
    email = normalizeText(email, 254).toLowerCase();

    if (!schoolName || !teacherName || !email) {
      return NextResponse.json({ error: "schoolName, teacherName, email required" }, { status: 400 });
    }

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    if (team && !TEAM_REGEX.test(team) && team !== "취소") {
      return NextResponse.json({ error: `Invalid team format: ${team}` }, { status: 400 });
    }

    // School upsert by name (existing 우선, 없으면 생성)
    let [school] = await db
      .select({ id: schools.id, team: schools.team })
      .from(schools)
      .where(eq(schools.name, schoolName));

    if (!school) {
      const code = randomBytes(4).toString("hex").toUpperCase();
      const inserted = await db
        .insert(schools)
        .values({
          name: schoolName,
          nameEn: schoolNameEn || null,
          code,
          region: region || null,
          team: team || null,
        })
        .returning({ id: schools.id, team: schools.team });
      school = inserted[0];
    } else if (team && school.team !== team && school.team !== "취소") {
      await db.update(schools).set({ team }).where(eq(schools.id, school.id));
    }

    // Teacher upsert (school+email unique)
    const [existing] = await db
      .select({ id: teachers.id, status: teachers.status })
      .from(teachers)
      .where(and(eq(teachers.schoolId, school.id), eq(teachers.email, email)));

    if (!existing) {
      const [created] = await db
        .insert(teachers)
        .values({
          schoolId: school.id,
          name: teacherName,
          email: email,
          status: "pending",
          // 신뢰된 동기화 소스(API키) → 검증 면제, 자동 승인
          verificationStatus: "approved",
          emailVerifiedAt: new Date(),
          approvedAt: new Date(),
          approvedBy: "sync",
        })
        .returning({ id: teachers.id });
      return NextResponse.json({ success: true, schoolId: school.id, teacherId: created.id, created: true });
    }

    return NextResponse.json({ success: true, schoolId: school.id, teacherId: existing.id, created: false, existingStatus: existing.status });
  } catch (err) {
    console.error("[/api/sync-group-purchase] failed:", err);
    return NextResponse.json({ success: false, error: "Unable to sync request" }, { status: 500 });
  }
}
