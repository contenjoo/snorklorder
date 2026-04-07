export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { teachers, schools } from "@/db/schema";
import { sql, desc } from "drizzle-orm";
import { sendDailyDigest } from "@/lib/email";

export async function GET(req: Request) {
  // Verify cron secret (Vercel cron sends this header)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get teachers registered in the last 24 hours
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const newTeachers = await db
    .select({
      teacherName: teachers.name,
      teacherEmail: teachers.email,
      subject: teachers.subject,
      schoolName: schools.name,
      schoolCode: schools.code,
      createdAt: teachers.createdAt,
    })
    .from(teachers)
    .innerJoin(schools, sql`${teachers.schoolId} = ${schools.id}`)
    .where(sql`${teachers.createdAt} > ${yesterday}`)
    .orderBy(desc(teachers.createdAt));

  if (newTeachers.length === 0) {
    return NextResponse.json({ message: "No new teachers in last 24h", sent: false });
  }

  await sendDailyDigest(newTeachers);

  return NextResponse.json({ message: `Digest sent: ${newTeachers.length} teachers`, sent: true });
}
