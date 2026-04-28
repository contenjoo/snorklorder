export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { checkAuth } from "@/lib/auth";
import { checkRateLimit, createRateLimitResponse, isValidEmail, normalizeText } from "@/lib/security";

export async function GET() {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db
    .select()
    .from(accountRequests)
    .orderBy(desc(accountRequests.createdAt));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, id, ...data } = body;

  if (action === "create") {
    // API 키 인증 (외부 서비스 연동용)
    const apiKey = req.headers.get("x-api-key");
    const validApiKey = process.env.INTEGRATION_API_KEY;
    const isApiKeyAuth = !!(validApiKey && apiKey && apiKey === validApiKey);

    const isAuthenticated = isApiKeyAuth || (await checkAuth());

    if (!isAuthenticated) {
      const rateLimit = checkRateLimit({
        request: req,
        key: "public-account-request",
        limit: 5,
        windowMs: 10 * 60 * 1000,
      });

      if (!rateLimit.ok) {
        return createRateLimitResponse("Too many account requests. Please try again later.", rateLimit.retryAfter);
      }
    }

    if (!data.schoolName || !data.emails) {
      return NextResponse.json({ error: "schoolName and emails are required" }, { status: 400 });
    }

    const emailList = String(data.emails)
      .split(/[,;\n]+/)
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0);
    const uniqueValidEmails = [...new Set(emailList.filter((email) => isValidEmail(email)))];

    if (uniqueValidEmails.length === 0) {
      return NextResponse.json({ error: "At least one valid email is required" }, { status: 400 });
    }

    if (!isAuthenticated && uniqueValidEmails.length > 10) {
      return NextResponse.json({ error: "Public requests can include up to 10 emails" }, { status: 400 });
    }

    const normalizedSchoolName = normalizeText(String(data.schoolName), 120);
    const normalizedNotes = typeof data.notes === "string" ? normalizeText(data.notes, 500) : null;

    if (!normalizedSchoolName) {
      return NextResponse.json({ error: "schoolName is required" }, { status: 400 });
    }

    const [item] = await db
      .insert(accountRequests)
      .values({
        channel: isAuthenticated ? data.channel || "company" : "company",
        applicantType: isAuthenticated ? (data.applicantType === "individual" ? "individual" : "school") : "school",
        type: isAuthenticated ? data.type || "upgrade" : "upgrade",
        schoolName: normalizedSchoolName,
        schoolNameEn: data.schoolNameEn || null,
        emails: uniqueValidEmails.join(", "),
        accountType: isAuthenticated ? data.accountType || "teacher" : "teacher",
        quantity: isAuthenticated ? data.quantity || 1 : uniqueValidEmails.length,
        oldEmail: isAuthenticated ? data.oldEmail || null : null,
        fromType: isAuthenticated ? data.fromType || null : null,
        extensionDate: isAuthenticated ? data.extensionDate || null : null,
        notes: normalizedNotes,
        status: isAuthenticated ? data.status || "draft" : "draft",
      })
      .returning();
    return NextResponse.json({ success: true, requestId: item.id });
  }

  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (action === "update" && id) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const fields = ["channel", "applicantType", "type", "schoolName", "schoolNameEn", "emails", "accountType", "quantity", "oldEmail",
      "fromType", "extensionDate", "notes", "status", "invoiceNumber", "invoiceAmount",
      "invoiceDueDate", "paymentLink", "paymentDate", "paymentMethod"];
    for (const f of fields) {
      if (data[f] !== undefined) updates[f] = data[f];
    }
    const [item] = await db
      .update(accountRequests)
      .set(updates)
      .where(eq(accountRequests.id, id))
      .returning();
    return NextResponse.json({ request: item });
  }

  if (action === "delete" && id) {
    await db.delete(accountRequests).where(eq(accountRequests.id, id));
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
