export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";

const JON_EMAIL = "jon@snorkl.app";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://snorkl-teacher-reg.vercel.app";

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

interface Section {
  subject: string;
  body: string;
}

// 여러 account_requests를 하나의 메일로 묶어 Jon에게 발송
export async function POST(req: NextRequest) {
  try {
    const { requestIds, sections } = (await req.json()) as { requestIds?: number[]; sections?: Section[] };
    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return NextResponse.json({ error: "requestIds is required" }, { status: 400 });
    }
    if (!Array.isArray(sections) || sections.length !== requestIds.length) {
      return NextResponse.json({ error: "sections must match requestIds length" }, { status: 400 });
    }

    const transporter = getTransporter();
    if (!transporter) {
      return NextResponse.json({ error: "Gmail not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing)" }, { status: 500 });
    }

    const rows = await db
      .select({
        id: accountRequests.id,
        confirmToken: accountRequests.confirmToken,
        emails: accountRequests.emails,
        status: accountRequests.status,
      })
      .from(accountRequests)
      .where(inArray(accountRequests.id, requestIds));

    const tokenMap = new Map<number, string>();
    for (const id of requestIds) {
      const row = rows.find((r) => r.id === id);
      if (!row) continue;
      let token = row.confirmToken;
      if (!token) {
        token = randomBytes(16).toString("hex");
        await db
          .update(accountRequests)
          .set({ confirmToken: token, updatedAt: new Date() })
          .where(eq(accountRequests.id, id));
      }
      tokenMap.set(id, token);
    }

    const totalEmails = rows.reduce(
      (s, r) => s + r.emails.split(/[,;\n]+/).filter((e) => e.trim()).length,
      0,
    );

    const lines: string[] = [];
    lines.push("Hi Jon,");
    lines.push("");
    lines.push(
      `Below ${requestIds.length === 1 ? "is 1 account request" : `are ${requestIds.length} account requests`}` +
        (totalEmails > requestIds.length ? ` (${totalEmails} emails total):` : ":"),
    );
    lines.push("");

    requestIds.forEach((id, i) => {
      const section = sections[i];
      const token = tokenMap.get(id);
      lines.push("═══════════════════════════════════════════");
      lines.push(`[${i + 1}/${requestIds.length}] ${section.subject}`);
      lines.push("");
      lines.push(section.body);
      if (token) {
        lines.push("");
        lines.push(`Once done, confirm: ${BASE_URL}/account-confirm/${token}`);
      }
      lines.push("");
    });

    lines.push("Thank you,");
    lines.push("Banghyun");

    const subject = `[Snorkl] Batch Request — ${requestIds.length} request${requestIds.length !== 1 ? "s" : ""}, ${totalEmails} email${totalEmails !== 1 ? "s" : ""}`;

    await transporter.sendMail({
      from: process.env.GMAIL_USER || "",
      to: JON_EMAIL,
      subject,
      text: lines.join("\n"),
    });

    // sent 처리 — 단, 이미 processed/invoiced/paid 로 넘어간 건은 재발송해도 정산 단계가 sent로 되돌아가지 않도록 제외
    const updatableIds = rows.filter((r) => ["draft", "sent"].includes(r.status)).map((r) => r.id);
    if (updatableIds.length > 0) {
      await db
        .update(accountRequests)
        .set({ status: "sent", updatedAt: new Date() })
        .where(inArray(accountRequests.id, updatableIds));
    }

    return NextResponse.json({ success: true, count: requestIds.length, totalEmails });
  } catch (err) {
    console.error("Batch account email error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send batch email" },
      { status: 500 },
    );
  }
}
