export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { eq } from "drizzle-orm";

const JON_EMAIL = "jon@snorkl.app";

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

    await transporter.sendMail({
      from,
      to: JON_EMAIL,
      subject,
      text: body,
    });

    // Update status to "sent" if requestId provided
    if (requestId) {
      await db
        .update(accountRequests)
        .set({ status: "sent", updatedAt: new Date() })
        .where(eq(accountRequests.id, requestId));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Account email send error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send email" },
      { status: 500 }
    );
  }
}
