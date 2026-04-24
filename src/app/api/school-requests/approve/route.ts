export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { schoolRequests, schools } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendSchoolCodeEmail } from "@/lib/email";
import { checkAuth } from "@/lib/auth";

function generateCode(nameEn: string | null): string {
  // Try English name first
  if (nameEn) {
    const code = nameEn
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, 12);
    if (code.length >= 3) return code;
  }
  // Fallback: random code
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "S";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, action, rejectReason } = await req.json();

  if (!id || !action) {
    return NextResponse.json({ error: "id and action required" }, { status: 400 });
  }

  const [request] = await db
    .select()
    .from(schoolRequests)
    .where(eq(schoolRequests.id, id));

  if (!request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (request.status !== "pending") {
    return NextResponse.json({ error: "Already processed" }, { status: 400 });
  }

  if (action === "reject") {
    await db
      .update(schoolRequests)
      .set({ status: "rejected", rejectReason: rejectReason || null, reviewedAt: new Date() })
      .where(eq(schoolRequests.id, id));
    return NextResponse.json({ success: true, action: "rejected" });
  }

  if (action === "approve") {
    // Generate unique code
    let code = generateCode(request.nameEn);
    let attempt = 0;
    while (attempt < 10) {
      const existing = await db.select().from(schools).where(eq(schools.code, code));
      if (existing.length === 0) break;
      code = code.slice(0, 8) + Math.floor(Math.random() * 100);
      attempt++;
    }

    // Create school
    const [school] = await db
      .insert(schools)
      .values({
        name: request.name,
        nameEn: request.nameEn,
        code,
        region: request.region,
        domain: request.domain,
      })
      .returning();

    // Update request status
    await db
      .update(schoolRequests)
      .set({ status: "approved", reviewedAt: new Date() })
      .where(eq(schoolRequests.id, id));

    // Send code to contact teacher
    sendSchoolCodeEmail(request.contactEmail, request.contactName, school.name, code).catch(console.error);

    return NextResponse.json({ success: true, action: "approved", school });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
