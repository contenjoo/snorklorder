export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { eq } from "drizzle-orm";

const JON_EMAIL = "jon@snorkl.app";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://snorkl-teacher-reg.vercel.app";

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

export async function POST(req: NextRequest) {
  try {
    const { requestId, subject, body } = await req.json();

    if (!subject || !body) {
      return NextResponse.json({ error: "subject and body are required" }, { status: 400 });
    }

    const transporter = getTransporter();
    if (!transporter) {
      return NextResponse.json({ error: "Gmail not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing)" }, { status: 500 });
    }

    const from = process.env.GMAIL_USER || "";

    // 확인 링크용 토큰 발급 (update된 request에 저장). 이미 있으면 재사용.
    let confirmLink = "";
    if (requestId) {
      const [existing] = await db
        .select({ confirmToken: accountRequests.confirmToken })
        .from(accountRequests)
        .where(eq(accountRequests.id, requestId));
      let token = existing?.confirmToken || null;
      if (!token) {
        token = randomBytes(16).toString("hex");
        await db
          .update(accountRequests)
          .set({ confirmToken: token, updatedAt: new Date() })
          .where(eq(accountRequests.id, requestId));
      }
      confirmLink = `${BASE_URL}/account-confirm/${token}`;
    }

    const escapeHtml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const bodyHtml = escapeHtml(body).replace(/\n/g, "<br>");

    const buttonBlock = confirmLink
      ? `<div style="text-align:center;margin:24px 0;padding:20px;background:#f0f7ff;border-radius:12px;border:1px solid #dbeafe">
           <p style="margin:0 0 12px;color:#1e3a5f;font-size:14px;font-weight:600">Once the upgrade is done:</p>
           <a href="${confirmLink}"
              style="display:inline-block;background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">
             ✓ Mark Upgrade as Done
           </a>
           <p style="margin:12px 0 0;color:#888;font-size:11px">Or paste this in your browser:<br>${escapeHtml(confirmLink)}</p>
         </div>`
      : "";

    const { logEmail } = await import("@/lib/email");
    try {
      await transporter.sendMail({
        from,
        to: JON_EMAIL,
        subject,
        text: confirmLink ? `${body}\n\n---\nOnce the upgrade is done, please click to confirm:\n${confirmLink}\n` : body,
        html: `<div style="max-width:560px;margin:0 auto;font-family:-apple-system,sans-serif;color:#1f2937;font-size:14px;line-height:1.6">
                 ${buttonBlock}
                 <div>${bodyHtml}</div>
               </div>`,
      });
      await logEmail({ to: JON_EMAIL, subject, kind: "account_email", status: "success", relatedType: "account_request", relatedId: requestId || null });
    } catch (sendErr) {
      await logEmail({ to: JON_EMAIL, subject, kind: "account_email", status: "failed", error: String(sendErr), relatedType: "account_request", relatedId: requestId || null });
      throw sendErr;
    }

    // Update status to "sent" if requestId provided — 단, 이미 processed/invoiced/paid 로 넘어간 건은
    // 재발송(예: Jon에게 다시 보내기)해도 정산 단계가 sent로 되돌아가지 않도록 유지
    if (requestId) {
      const [current] = await db
        .select({ status: accountRequests.status })
        .from(accountRequests)
        .where(eq(accountRequests.id, requestId));
      if (current && ["draft", "sent"].includes(current.status)) {
        await db
          .update(accountRequests)
          .set({ status: "sent", updatedAt: new Date() })
          .where(eq(accountRequests.id, requestId));
      }
    }

    return NextResponse.json({ success: true, confirmLink });
  } catch (error) {
    console.error("Account email send error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send email" },
      { status: 500 }
    );
  }
}
