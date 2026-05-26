export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { checkAuth } from "@/lib/auth";
import { sendDomainPaidRequest } from "@/lib/email";

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
    const result = await sendDomainPaidRequest({
      schoolName: schoolName.trim(),
      schoolNameEn: schoolNameEn?.trim() || null,
      domain: cleanDomain,
      team: team?.trim() || null,
      note: note?.trim() || null,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/admin/request-paid-domain] failed:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
