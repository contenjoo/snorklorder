export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";
import { getTransporter, logEmail, formatLogRecipients, BASE_URL, HQ_EMAIL, HQ_INVOICE_CC } from "@/lib/email";
import { buildBatchEmail, defaultNeedsInvoice, type BatchEmailItem } from "@/lib/account-email-template";
import { parseEmailList } from "@/lib/security";

interface Section {
  subject: string;
  body: string;
}

// 여러 account_requests를 하나의 메일로 묶어 Jon에게 발송.
// 인보이스가 필요한 건이 하나라도 있으면 정산 담당(Cailie)을 CC 하고,
// 본문을 ① 인보이스 필요 / ② 인보이스 불필요 두 섹션으로 나눠 Cailie 가 볼 범위를 명확히 한다.
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
        type: accountRequests.type,
        needsInvoice: accountRequests.needsInvoice,
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

    const totalEmails = rows.reduce((s, r) => s + parseEmailList(r.emails).length, 0);

    // 요청별 인보이스 필요 여부. DB 에 행이 없는(삭제된) id 는 보수적으로 "필요"로 본다.
    const items: BatchEmailItem[] = requestIds.map((id, i) => {
      const row = rows.find((r) => r.id === id);
      const token = tokenMap.get(id);
      return {
        subject: sections[i].subject,
        body: sections[i].body,
        needsInvoice: row
          ? typeof row.needsInvoice === "boolean"
            ? row.needsInvoice
            : defaultNeedsInvoice(row.type)
          : true,
        confirmLine: token ? `Once done, confirm: ${BASE_URL}/account-confirm/${token}` : null,
      };
    });

    const { subject, body, needsInvoiceCc } = buildBatchEmail(items, totalEmails);
    const cc = needsInvoiceCc ? HQ_INVOICE_CC : undefined;
    const logTo = formatLogRecipients(HQ_EMAIL, cc);

    try {
      await transporter.sendMail({
        from: process.env.GMAIL_USER || "",
        to: HQ_EMAIL,
        ...(cc ? { cc } : {}),
        subject,
        text: body,
      });
      await logEmail({ to: logTo, subject, kind: "account_email", status: "success", relatedType: "account_request" });
    } catch (sendErr) {
      await logEmail({ to: logTo, subject, kind: "account_email", status: "failed", error: String(sendErr), relatedType: "account_request" });
      throw sendErr;
    }

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
