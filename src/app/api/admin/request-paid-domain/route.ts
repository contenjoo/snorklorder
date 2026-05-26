export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { sendDomainPaidRequest } from "@/lib/email";
import { db } from "@/db";
import { domainRequests } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";

export async function POST(req: NextRequest) {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { schoolName, schoolNameEn, domain, team, note } = body || {};
    if (!schoolName?.trim() || !domain?.trim()) {
      return NextResponse.json({ error: "schoolName and domain required" }, { status: 400 });
    }
    const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^@/, "").replace(/^www\./, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleanDomain)) {
      return NextResponse.json({ error: "Invalid domain format" }, { status: 400 });
    }

    // 같은 학교+도메인의 pending 요청이 이미 있으면 그 토큰 재사용 (멱등성)
    let [existing] = await db
      .select({ confirmToken: domainRequests.confirmToken })
      .from(domainRequests)
      .where(and(eq(domainRequests.domain, cleanDomain), eq(domainRequests.schoolName, schoolName.trim()), eq(domainRequests.status, "pending")));

    let token: string;
    if (existing) {
      token = existing.confirmToken;
    } else {
      token = randomBytes(16).toString("hex");
      await db.insert(domainRequests).values({
        schoolName: schoolName.trim(),
        schoolNameEn: schoolNameEn?.trim() || null,
        domain: cleanDomain,
        team: team?.trim() || null,
        note: note?.trim() || null,
        confirmToken: token,
      });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://snorkl-teacher-reg.vercel.app";
    const confirmLink = `${baseUrl}/domain-confirm/${token}`;

    const result = await sendDomainPaidRequest({
      schoolName: schoolName.trim(),
      schoolNameEn: schoolNameEn?.trim() || null,
      domain: cleanDomain,
      team: team?.trim() || null,
      note: note?.trim() || null,
      confirmLink,
    });
    return NextResponse.json({ ...result, confirmLink });
  } catch (err) {
    console.error("[/api/admin/request-paid-domain] failed:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
