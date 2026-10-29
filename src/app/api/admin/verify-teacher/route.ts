export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { withBillingTransaction } from "@/db/billing-transaction";
import { accountRequests, schools, teachers } from "@/db/schema";
import { checkAuth } from "@/lib/auth";
import { collectionWriteErrorCode } from "@/lib/market-account-collection";

// Jon 처리 메일의 Note 로 나간다 — 신규 학교임을 처음 한 번만 알린다.
const NEW_SCHOOL_NOTE = "New school — first registration from this school, not covered by an existing license. Please invoice the school.";

// 본사(HQ) 검증 큐 처리: 학교 관리자 부재/타임아웃으로 이관된 교사 승인·거절.
// paymentRequiredIds: 결제 필요(신규 학교)로 체크한 교사. 학교당 최초 1회 학교 계정·청구 요청(draft)을 만들고
// 그 교사들은 그 요청으로 Jon 에게 가므로 일반 발송 대기에서 뺀다(status=sent).
export async function POST(req: NextRequest) {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (req.headers.get("origin") !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const body = await req.json().catch(()=>null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({error:"Invalid JSON"},{status:400});
  const { ids, action, reason, paymentRequiredIds } = body as { ids: number[]; action: "approve" | "reject"; reason?: string; paymentRequiredIds?: number[] };

  const cleanIds = Array.isArray(ids) ? ids.filter((id) => Number.isInteger(id)) : [];
  if (cleanIds.length === 0 || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "ids and valid action required" }, { status: 400 });
  }

  if (action === "reject") {
    await db
      .update(teachers)
      .set({ verificationStatus: "rejected", rejectedReason: reason ? String(reason).slice(0, 500) : null })
      .where(inArray(teachers.id, cleanIds));
    return NextResponse.json({ success: true, updated: cleanIds.length, action });
  }

  const paidIds = Array.isArray(paymentRequiredIds)
    ? [...new Set(paymentRequiredIds.filter((id) => Number.isInteger(id) && cleanIds.includes(id)))]
    : [];
  const paidTeachers = paidIds.length === 0 ? [] : await db
    .select({ id: teachers.id, email: teachers.email, schoolId: teachers.schoolId, schoolName: schools.name, schoolNameEn: schools.nameEn })
    .from(teachers)
    .innerJoin(schools, eq(teachers.schoolId, schools.id))
    .where(and(inArray(teachers.id, paidIds), eq(teachers.status, "pending")));
  const missingEn = [...new Set(paidTeachers.filter((t) => !t.schoolNameEn?.trim()).map((t) => t.schoolName))];
  if (missingEn.length > 0) {
    return NextResponse.json({ error: `영문 학교명이 없어 청구 요청을 만들 수 없습니다: ${missingEn.join(", ")}` }, { status: 409 });
  }

  try {
    const billing = await withBillingTransaction(async (tx) => {
      await tx
        .update(teachers)
        .set({ verificationStatus: "approved", approvedAt: new Date(), approvedBy: "hq" })
        .where(inArray(teachers.id, cleanIds));

      const bySchool = new Map<number, typeof paidTeachers>();
      for (const t of paidTeachers) bySchool.set(t.schoolId, [...(bySchool.get(t.schoolId) ?? []), t]);

      const created: { schoolName: string; accountRequestId: number }[] = [];
      const alreadyBilled: string[] = [];
      for (const [schoolId, group] of bySchool) {
        const [school] = await tx
          .select({ name: schools.name, nameEn: schools.nameEn, billingAccountRequestId: schools.billingAccountRequestId })
          .from(schools)
          .where(eq(schools.id, schoolId))
          .for("update");
        if (!school) continue;
        // 최초 1회만 — 이미 청구 요청이 있는 학교의 교사는 일반 발송 흐름으로 둔다.
        if (school.billingAccountRequestId) {
          alreadyBilled.push(school.name);
          continue;
        }
        const emails = [...new Set(group.map((t) => t.email.trim().toLowerCase()))];
        const [accountRequest] = await tx
          .insert(accountRequests)
          .values({
            channel: "company",
            applicantType: "school",
            type: "upgrade",
            schoolName: school.name,
            schoolNameEn: school.nameEn!.trim(),
            emails: emails.join(", "),
            accountType: "school",
            quantity: 1,
            notes: NEW_SCHOOL_NOTE,
            needsInvoice: true,
            status: "draft",
          })
          .returning({ id: accountRequests.id });
        if (!accountRequest) throw new Error("Failed to create account request");

        const [linked] = await tx
          .update(schools)
          .set({ billingAccountRequestId: accountRequest.id })
          .where(and(eq(schools.id, schoolId), isNull(schools.billingAccountRequestId)))
          .returning({ id: schools.id });
        if (!linked) throw new Error("Failed to link school billing request");

        await tx
          .update(teachers)
          .set({ status: "sent" })
          .where(and(inArray(teachers.id, group.map((t) => t.id)), eq(teachers.status, "pending")));
        created.push({ schoolName: school.name, accountRequestId: accountRequest.id });
      }
      return { created, alreadyBilled };
    });

    return NextResponse.json({ success: true, updated: cleanIds.length, action, ...billing });
  } catch (error) {
    const code = collectionWriteErrorCode(error);
    if (code) return NextResponse.json({ code, error: code }, { status: 409 });
    return NextResponse.json({ error: "승인·청구 요청 생성 실패" }, { status: 500 });
  }
}
