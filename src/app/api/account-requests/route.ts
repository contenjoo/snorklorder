export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { checkAuth } from "@/lib/auth";
import { checkRateLimit, createRateLimitResponse, isValidEmail, normalizeText } from "@/lib/security";
import { sendAccountRequestNotification } from "@/lib/email";

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

    // M8: For API-key callers, whitelist and validate every writable field to prevent privilege escalation
    if (isApiKeyAuth) {
      const VALID_APPLICANT_TYPES = ["school", "individual"] as const;
      const VALID_TYPES = ["upgrade", "email_change", "type_change", "extension"] as const;
      const VALID_ACCOUNT_TYPES = ["teacher", "admin"] as const;
      const VALID_CHANNELS = ["company", "school_store"] as const;

      if (data.applicantType !== undefined && !VALID_APPLICANT_TYPES.includes(data.applicantType)) {
        return NextResponse.json({ error: `Invalid applicantType: must be one of ${VALID_APPLICANT_TYPES.join(", ")}` }, { status: 400 });
      }
      if (data.type !== undefined && !VALID_TYPES.includes(data.type)) {
        return NextResponse.json({ error: `Invalid type: must be one of ${VALID_TYPES.join(", ")}` }, { status: 400 });
      }
      if (data.accountType !== undefined && !VALID_ACCOUNT_TYPES.includes(data.accountType)) {
        return NextResponse.json({ error: `Invalid accountType: must be one of ${VALID_ACCOUNT_TYPES.join(", ")}` }, { status: 400 });
      }
      if (data.channel !== undefined && !VALID_CHANNELS.includes(data.channel)) {
        return NextResponse.json({ error: `Invalid channel: must be one of ${VALID_CHANNELS.join(", ")}` }, { status: 400 });
      }
      if (data.quantity !== undefined) {
        const q = Number(data.quantity);
        if (!Number.isInteger(q) || q < 1 || q > 50) {
          return NextResponse.json({ error: "Invalid quantity: must be a positive integer between 1 and 50" }, { status: 400 });
        }
        data.quantity = q;
      }
      // status is always forced to "draft" for API-key callers regardless of input
      data.status = "draft";
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
    // H2: notes is admin-only context stored in unbounded Postgres text; raise cap from 500 to 4000
    const normalizedNotes = typeof data.notes === "string" ? normalizeText(data.notes, 4000) : null;

    if (!normalizedSchoolName) {
      return NextResponse.json({ error: "schoolName is required" }, { status: 400 });
    }

    const insertedApplicantType = isAuthenticated ? (data.applicantType === "individual" ? "individual" : "school") : "school";
    const insertedType = isAuthenticated ? data.type || "upgrade" : "upgrade";
    const insertedAccountType = isAuthenticated ? data.accountType || "teacher" : "teacher";
    const insertedQuantity = isAuthenticated ? data.quantity || 1 : uniqueValidEmails.length;
    const insertedChannel = isAuthenticated ? data.channel || "company" : "company";

    const [item] = await db
      .insert(accountRequests)
      .values({
        channel: insertedChannel,
        applicantType: insertedApplicantType,
        type: insertedType,
        schoolName: normalizedSchoolName,
        schoolNameEn: data.schoolNameEn || null,
        emails: uniqueValidEmails.join(", "),
        accountType: insertedAccountType,
        quantity: insertedQuantity,
        oldEmail: isAuthenticated ? data.oldEmail || null : null,
        fromType: isAuthenticated ? data.fromType || null : null,
        extensionDate: isAuthenticated ? data.extensionDate || null : null,
        notes: normalizedNotes,
        status: "draft",
      })
      .returning();

    // H1: Notify Jon of the new account request; fire-and-await with try/catch — never block the 200
    try {
      const emailResult = await sendAccountRequestNotification({
        applicantType: insertedApplicantType,
        schoolName: normalizedSchoolName,
        schoolNameEn: data.schoolNameEn || null,
        type: insertedType,
        accountType: insertedAccountType,
        quantity: insertedQuantity,
        emails: uniqueValidEmails.join(", "),
        notes: normalizedNotes,
      });
      if (!emailResult.success && !emailResult.skipped) {
        console.error("[account-requests] notification email failed:", emailResult.error);
      }
    } catch (emailErr) {
      console.error("[account-requests] notification email threw:", emailErr);
    }

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
