import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { checkAuth } from "@/lib/auth";
import { createPartnerTransactionDb } from "@/db/transaction";
import { accountRequests, billingCycleItems, partnerRequestOperations } from "@/db/schema";
import { hashPartnerBatchPayload } from "@/lib/partner-product-request";
import { parsePartnerOrderEdit, partnerOrderLocked, partnerOrderVersion } from "@/lib/partner-order-admin";

type Context = { params: Promise<{ partnerRequestId: string }> };
class OrderConflict extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

async function mutate(req: NextRequest, context: Context, deleting: boolean) {
  if (!(await checkAuth())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { partnerRequestId } = await context.params;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(partnerRequestId)) {
    return NextResponse.json({ error: "잘못된 신청 번호입니다." }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body.version !== "string") return NextResponse.json({ error: "주문을 새로 불러와 주세요." }, { status: 400 });
  const db = createPartnerTransactionDb();
  try {
    await db.transaction(async (tx) => {
      // Same lock as Market ingestion: cancellation cannot race an incoming upsert.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${partnerRequestId}))`);
      await tx.execute(sql`SELECT id FROM account_requests WHERE partner_request_id = ${partnerRequestId} ORDER BY id FOR UPDATE`);
      const all = await tx.select().from(accountRequests).where(eq(accountRequests.partnerRequestId, partnerRequestId));
      if (!all.length || all.some((row) => row.externalSource !== "market_partner")) throw new OrderConflict("협력사 주문을 찾을 수 없습니다.", 404);
      const rows = all.filter((row) => row.partnerLifecycleState === "active");
      if (deleting && !rows.length) return;
      if (!rows.length || body.version !== partnerOrderVersion(rows)) throw new OrderConflict("주문이 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
      if (partnerOrderLocked(all)) throw new OrderConflict("본사 발송 또는 청구가 시작된 주문입니다. 처리 이력을 확인한 뒤 취소해 주세요.");
      const billing = await tx.select({ id: billingCycleItems.id }).from(billingCycleItems)
        .where(inArray(billingCycleItems.accountRequestId, all.map((row) => row.id))).limit(1);
      if (billing.length) throw new OrderConflict("청구 묶음에 포함된 주문입니다. 청구 이력을 먼저 확인해 주세요.");
      if (deleting) {
        const [latest] = await tx.select().from(partnerRequestOperations)
          .where(eq(partnerRequestOperations.partnerRequestId, partnerRequestId))
          .orderBy(desc(partnerRequestOperations.revision)).limit(1);
        const revision = Math.max(latest?.revision ?? 0, ...all.map((row) => row.partnerRevision ?? 0)) + 1;
        const payloadHash = hashPartnerBatchPayload({ source: "admin", partnerRequestId, revision, mode: "cancel" });
        await tx.update(accountRequests).set({ partnerLifecycleState: "cancelled", partnerRevision: revision, partnerPayloadHash: payloadHash, updatedAt: new Date() })
          .where(eq(accountRequests.partnerRequestId, partnerRequestId));
        await tx.insert(partnerRequestOperations).values({ operationId: `admin-cancel:${randomUUID()}`, partnerRequestId, revision, mode: "cancel", payloadHash });
      } else {
        const edit = parsePartnerOrderEdit(body, rows.map((row) => row.id));
        if (!edit) throw new OrderConflict("학교명·영문 학교명·교사명·과목·중복 없는 이메일을 확인해 주세요.", 400);
        for (const item of edit.items) {
          await tx.update(accountRequests).set({ schoolName: edit.schoolName, schoolNameEn: edit.schoolNameEn,
            teacherName: item.teacherName, subject: item.subject, emails: item.emails,
            notes: `Teacher: ${item.teacherName}\nSubject: ${item.subject}`, updatedAt: new Date() })
            .where(and(eq(accountRequests.id, item.id), eq(accountRequests.partnerRequestId, partnerRequestId)));
        }
      }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof OrderConflict) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[partner-order-admin] mutation failed");
    return NextResponse.json({ error: "주문 변경에 실패했습니다. 다시 시도해 주세요." }, { status: 500 });
  } finally {
    await db.$client.end().catch(() => {});
  }
}

export async function PATCH(req: NextRequest, context: Context) { return mutate(req, context, false); }
export async function DELETE(req: NextRequest, context: Context) { return mutate(req, context, true); }
