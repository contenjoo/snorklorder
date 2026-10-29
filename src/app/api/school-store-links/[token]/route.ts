import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { parseSchoolStoreEmails, readSchoolStoreLink } from "@/lib/school-store-link";
import { checkRateLimit, createRateLimitResponse } from "@/lib/security";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const config = readSchoolStoreLink(token, process.env.ADMIN_SESSION_SECRET || "");
  if (!config) return NextResponse.json({ error: "유효하지 않거나 만료된 링크입니다. 담당자에게 새 링크를 요청해 주세요." }, { status: 404 });
  const limit = await checkRateLimit({ request: req, key: "school-store-input", subject: config.id, limit: 10, windowMs: 10 * 60 * 1000 });
  if (!limit.ok) return createRateLimitResponse("잠시 후 다시 시도해 주세요.", limit.retryAfter);
  let emails;
  try { emails = parseSchoolStoreEmails((await req.json())?.emails, config.quantity); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "이메일을 확인해 주세요." }, { status: 400 }); }
  try {
    // 링크 하나당 초안 하나만 생성한다. 재전송/동시 제출은 기존 내용을 덮지 않는다.
    const [created] = await db.insert(accountRequests).values({
      channel: "school_store", applicantType: "school", type: config.type,
      schoolName: config.schoolName, accountType: config.accountType,
      quantity: config.quantity, termYears: config.termYears, extensionDate: config.extensionDate,
      emails: emails.join(","), status: "draft", needsInvoice: true,
      idempotencyKey: `school-store-input:${config.id}`,
      notes: "학교장터 이메일 입력 링크로 접수. 구매 내역 확인 후 본사에 전달해 주세요.",
    }).onConflictDoNothing({ target: accountRequests.idempotencyKey }).returning({ id: accountRequests.id });
    return NextResponse.json({ success: true, alreadySubmitted: !created }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[school-store-input] failed to save submission");
    return NextResponse.json({ error: "접수하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503 });
  }
}
