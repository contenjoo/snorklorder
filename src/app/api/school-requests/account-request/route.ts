export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { checkAuth } from "@/lib/auth";
import { db } from "@/db";
import { accountRequests, schoolRequests, schools } from "@/db/schema";
import { isValidEmail } from "@/lib/security";

export async function POST(req: NextRequest) {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (req.headers.get("origin") !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const id = body && typeof body === "object" && !Array.isArray(body) ? Number(body.id) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid school request id" }, { status: 400 });
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [schoolRequest] = await tx
        .select()
        .from(schoolRequests)
        .where(eq(schoolRequests.id, id))
        .for("update");

      if (!schoolRequest) return { error: "School request not found", status: 404 } as const;
      if (schoolRequest.status !== "approved") {
        return { error: "Only approved school requests can be billed", status: 409 } as const;
      }
      if (schoolRequest.accountRequestId) {
        return { accountRequestId: schoolRequest.accountRequestId, created: false } as const;
      }
      const [school] = schoolRequest.nameEn?.trim()
        ? []
        : await tx
            .select({ nameEn: schools.nameEn })
            .from(schools)
            .where(eq(schools.name, schoolRequest.name))
            .limit(1);
      const schoolNameEn = schoolRequest.nameEn?.trim() || school?.nameEn?.trim();
      if (!schoolNameEn) {
        return { error: "English school name is required before creating a billing request", status: 409 } as const;
      }
      const contactEmail = schoolRequest.contactEmail.trim().toLowerCase();
      if (!isValidEmail(contactEmail)) {
        return { error: "A valid school contact email is required", status: 409 } as const;
      }

      const [accountRequest] = await tx
        .insert(accountRequests)
        .values({
          channel: schoolRequest.channel === "school_store" ? "school_store" : "company",
          applicantType: "school",
          type: "upgrade",
          schoolName: schoolRequest.name,
          schoolNameEn,
          emails: contactEmail,
          accountType: "school",
          quantity: 1,
          notes: `Created from school registration request #${schoolRequest.id}`,
          needsInvoice: true,
          status: "draft",
        })
        .returning({ id: accountRequests.id });

      if (!accountRequest) throw new Error("Failed to create account request");

      const [linked] = await tx
        .update(schoolRequests)
        .set({
          accountRequestId: accountRequest.id,
          billingRequestCreatedAt: new Date(),
        })
        .where(and(eq(schoolRequests.id, id), isNull(schoolRequests.accountRequestId)))
        .returning({ accountRequestId: schoolRequests.accountRequestId });

      if (!linked?.accountRequestId) throw new Error("Failed to link account request");
      return { accountRequestId: linked.accountRequestId, created: true } as const;
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, ...result });
  } catch {
    return NextResponse.json({ error: "Failed to create school billing request" }, { status: 500 });
  }
}
