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

    const bodyWithLink = confirmLink
      ? `${body}\n\n---\nOnce the upgrade is done, please click to confirm:\n${confirmLink}\n`
      : body;

    await transporter.sendMail({
      from,
      to: JON_EMAIL,
      subject,
      text: bodyWithLink,
    });

    // Update status to "sent" if requestId provided
    if (requestId) {
      await db
        .update(accountRequests)
        .set({ status: "sent", updatedAt: new Date() })
        .where(eq(accountRequests.id, requestId));
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
