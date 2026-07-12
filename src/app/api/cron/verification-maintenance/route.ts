export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools, schoolAdmins } from "@/db/schema";
import { eq, and, isNull, lt, inArray, ne } from "drizzle-orm";
import { REMINDER_DAYS, ESCALATE_DAYS } from "@/lib/verification";
import { sendVerificationReminderEmail } from "@/lib/verification-email";

type PendingTeacher = {
  id: number;
  name: string;
  email: string;
  schoolId: number;
  escalatedAt: Date | null;
  emailVerifiedAt: Date | null;
  schoolName: string;
  schoolNameEn: string | null;
};

async function run() {
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

  // ── Step 1: Escalate long-pending registrations to HQ ─────────────────────
  const escalateCandidates = await db
    .select({ id: teachers.id, schoolId: teachers.schoolId })
    .from(teachers)
    .where(
      and(
        eq(teachers.verificationStatus, "email_verified"),
        ne(teachers.status, "upgraded"),
        isNull(teachers.escalatedAt),
        lt(teachers.emailVerifiedAt, daysAgo(ESCALATE_DAYS))
      )
    );

  const candidateSchoolIds = [...new Set(escalateCandidates.map((t) => t.schoolId))];

  // Schools WITH at least one admin (no-admin schools were escalated at verify time).
  const schoolsWithAdmins = new Set<number>();
  if (candidateSchoolIds.length > 0) {
    const adminRows = await db
      .select({ schoolId: schoolAdmins.schoolId })
      .from(schoolAdmins)
      .where(inArray(schoolAdmins.schoolId, candidateSchoolIds));
    for (const r of adminRows) schoolsWithAdmins.add(r.schoolId);
  }

  const idsToEscalate = escalateCandidates
    .filter((t) => schoolsWithAdmins.has(t.schoolId))
    .map((t) => t.id);

  if (idsToEscalate.length > 0) {
    await db
      .update(teachers)
      .set({ escalatedAt: now })
      .where(inArray(teachers.id, idsToEscalate));
  }

  const escalated = idsToEscalate.length;

  // ── Step 2: Reminders ─────────────────────────────────────────────────────
  const queue: PendingTeacher[] = await db
    .select({
      id: teachers.id,
      name: teachers.name,
      email: teachers.email,
      schoolId: teachers.schoolId,
      escalatedAt: teachers.escalatedAt,
      emailVerifiedAt: teachers.emailVerifiedAt,
      schoolName: schools.name,
      schoolNameEn: schools.nameEn,
    })
    .from(teachers)
    .innerJoin(schools, eq(teachers.schoolId, schools.id))
    .where(
      and(
        eq(teachers.verificationStatus, "email_verified"),
        ne(teachers.status, "upgraded")
      )
    );

  // Don't nag brand-new registrations.
  const reminderCutoff = daysAgo(REMINDER_DAYS).getTime();
  const dueQueue = queue.filter(
    (t) => t.emailVerifiedAt != null && t.emailVerifiedAt.getTime() < reminderCutoff
  );

  // school_admin bucket: still owned by school admin (escalatedAt IS NULL).
  const schoolAdminBucket = new Map<number, PendingTeacher[]>();
  // hq bucket: escalated (escalatedAt NOT NULL), grouped by school for display.
  const hqBucket = new Map<number, PendingTeacher[]>();

  for (const t of dueQueue) {
    const target = t.escalatedAt == null ? schoolAdminBucket : hqBucket;
    const list = target.get(t.schoolId);
    if (list) list.push(t);
    else target.set(t.schoolId, [t]);
  }

  let remindersSent = 0;

  // ── school_admin reminders ──
  const schoolAdminSends: Promise<unknown>[] = [];
  for (const [schoolId, list] of schoolAdminBucket) {
    const admins = await db
      .select({ email: schoolAdmins.email })
      .from(schoolAdmins)
      .where(eq(schoolAdmins.schoolId, schoolId));
    if (admins.length === 0) continue;

    const { schoolName, schoolNameEn } = list[0];
    const pending = list.map((t) => ({ name: t.name, email: t.email }));

    for (const admin of admins) {
      schoolAdminSends.push(
        (async () => {
          try {
            const res = await sendVerificationReminderEmail({
              to: admin.email,
              audience: "school_admin",
              schoolName,
              schoolNameEn,
              pending,
              dashboardPath: "/school",
            });
            if (res.success) remindersSent++;
          } catch {
            // swallow per-send failure so the job continues
          }
        })()
      );
    }
  }
  await Promise.allSettled(schoolAdminSends);

  // ── HQ reminders ──
  const hqEmail = process.env.GMAIL_USER;
  if (hqEmail) {
    const hqSends: Promise<unknown>[] = [];
    for (const [, list] of hqBucket) {
      const { schoolName, schoolNameEn } = list[0];
      const pending = list.map((t) => ({ name: t.name, email: t.email }));
      hqSends.push(
        (async () => {
          try {
            const res = await sendVerificationReminderEmail({
              to: hqEmail,
              audience: "hq",
              schoolName,
              schoolNameEn,
              pending,
              dashboardPath: "/admin",
            });
            if (res.success) remindersSent++;
          } catch {
            // swallow per-send failure
          }
        })()
      );
    }
    await Promise.allSettled(hqSends);
  }

  return NextResponse.json({ ok: true, escalated, remindersSent });
}

function authorize(req: NextRequest): boolean {
  // 1) Vercel 크론: Authorization: Bearer ${CRON_SECRET} (자동 전송) — 기존 크론과 동일
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return true;
  }
  // 2) 수동 트리거: x-api-key 헤더 또는 ?key= (INTEGRATION_API_KEY)
  const apiKey = process.env.INTEGRATION_API_KEY;
  if (apiKey) {
    const provided = req.headers.get("x-api-key") ?? req.nextUrl.searchParams.get("key");
    if (provided === apiKey) return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}
