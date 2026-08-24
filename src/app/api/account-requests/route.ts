export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { and, desc, eq, or } from "drizzle-orm";
import { checkAuth } from "@/lib/auth";
import { checkRateLimit, createRateLimitResponse, isValidEmail, normalizeText } from "@/lib/security";
import { sendAccountUpgradeCompletion } from "@/lib/email";
// 인보이스 필요 여부 기본값은 SSOT 한 곳에서만 정의한다 (미리보기/발송/저장이 갈라지지 않도록).
import { defaultNeedsInvoice } from "@/lib/account-email-template";
import {
  hydrateAccountRequestSchoolNames,
  resolveAccountRequestSchoolNameEn,
} from "@/lib/account-request-school-name";
import {
  MARKET_DRAFT_DELIVERY_MODE,
  classifyMarketReplay,
  containsMarketIdentity,
  hashMarketPayload,
  validateLegacyMarketDraft,
  validateMarketEnvelope,
  validateMarketQuantity,
  type MarketEnvelope,
} from "@/lib/market-account-request";

type ExistingMarketRequest = {
  id: number;
  status: string;
  externalSource: string | null;
  marketRequestId: string | null;
  idempotencyKey: string | null;
  externalPayloadHash: string | null;
};

function normalizeOptionalText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim() ? normalizeText(value, maxLength) : null;
}

async function findExistingMarketRequest(envelope: MarketEnvelope): Promise<ExistingMarketRequest | null> {
  const rows = await db
    .select({
      id: accountRequests.id,
      status: accountRequests.status,
      externalSource: accountRequests.externalSource,
      marketRequestId: accountRequests.marketRequestId,
      idempotencyKey: accountRequests.idempotencyKey,
      externalPayloadHash: accountRequests.externalPayloadHash,
    })
    .from(accountRequests)
    .where(
      or(
        eq(accountRequests.idempotencyKey, envelope.idempotencyKey),
        and(
          eq(accountRequests.externalSource, envelope.externalSource),
          eq(accountRequests.marketRequestId, envelope.marketRequestId),
        ),
      ),
    )
    .limit(2);

  return rows.find((row) => row.idempotencyKey === envelope.idempotencyKey)
    ?? rows.find(
      (row) => row.externalSource === envelope.externalSource
        && row.marketRequestId === envelope.marketRequestId,
    )
    ?? null;
}

function marketReplayResponse(
  existing: ExistingMarketRequest,
  envelope: MarketEnvelope,
  payloadHash: string,
) {
  const sameIdentity = existing.externalSource === envelope.externalSource
    && existing.marketRequestId === envelope.marketRequestId
    && existing.idempotencyKey === envelope.idempotencyKey;
  const replay = sameIdentity
    ? classifyMarketReplay(existing.externalPayloadHash, payloadHash)
    : "conflict";

  if (replay === "conflict") {
    return NextResponse.json(
      { error: "Idempotency key or market request identity conflicts with an existing request" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    requestId: existing.id,
    status: existing.status,
    created: false,
    duplicate: true,
    deliveryMode: MARKET_DRAFT_DELIVERY_MODE,
  });
}

export async function GET() {
  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await db
    .select()
    .from(accountRequests)
    .orderBy(desc(accountRequests.createdAt));
  return NextResponse.json(await hydrateAccountRequestSchoolNames(result));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, id, ...data } = body;

  if (action === "create") {
    // API 키 인증은 market 전용 수신 계약이다. 잘못된 키를 공개 폼으로 강등하지 않는다.
    const apiKey = req.headers.get("x-api-key");
    const validApiKey = process.env.INTEGRATION_API_KEY;
    const isApiKeyAuth = !!(validApiKey && apiKey && apiKey === validApiKey);
    if (apiKey && !isApiKeyAuth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAuthenticated = isApiKeyAuth || (await checkAuth());
    if (!isApiKeyAuth && containsMarketIdentity(data)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isAuthenticated) {
      const rateLimit = checkRateLimit({
        request: req,
        key: "public-account-request",
        limit: 5,
        windowMs: 10 * 60 * 1000,
      });

      if (!rateLimit.ok) {
        return createRateLimitResponse("Too many account requests. Please try again later.", rateLimit.retryAfter);
      }
    }

    if (!data.schoolName || !data.emails) {
      return NextResponse.json({ error: "schoolName and emails are required" }, { status: 400 });
    }

    let marketEnvelope: MarketEnvelope | null = null;

    // API-key caller는 market의 멱등 초안 생성 계약만 사용할 수 있다.
    if (isApiKeyAuth) {
      const VALID_APPLICANT_TYPES = ["school", "individual"] as const;
      const VALID_TYPES = ["upgrade", "email_change", "type_change", "extension"] as const;
      const VALID_ACCOUNT_TYPES = ["teacher", "admin"] as const;
      const VALID_CHANNELS = ["company", "school_store"] as const;

      if (data.applicantType !== undefined && !VALID_APPLICANT_TYPES.includes(data.applicantType)) {
        return NextResponse.json({ error: `Invalid applicantType: must be one of ${VALID_APPLICANT_TYPES.join(", ")}` }, { status: 400 });
      }
      if (data.type !== undefined && !VALID_TYPES.includes(data.type)) {
        return NextResponse.json({ error: `Invalid type: must be one of ${VALID_TYPES.join(", ")}` }, { status: 400 });
      }
      if (data.accountType !== undefined && !VALID_ACCOUNT_TYPES.includes(data.accountType)) {
        return NextResponse.json({ error: `Invalid accountType: must be one of ${VALID_ACCOUNT_TYPES.join(", ")}` }, { status: 400 });
      }
      if (data.channel !== undefined && !VALID_CHANNELS.includes(data.channel)) {
        return NextResponse.json({ error: `Invalid channel: must be one of ${VALID_CHANNELS.join(", ")}` }, { status: 400 });
      }
      if (data.quantity !== undefined) {
        const quantityResult = validateMarketQuantity(data.quantity);
        if (!quantityResult.ok) {
          return NextResponse.json({ error: quantityResult.error }, { status: 400 });
        }
        data.quantity = quantityResult.value;
      }
      if (data.needsInvoice !== undefined && typeof data.needsInvoice !== "boolean") {
        return NextResponse.json({ error: "Invalid needsInvoice: must be a boolean" }, { status: 400 });
      }

      if (containsMarketIdentity(data)) {
        const envelopeResult = validateMarketEnvelope(data);
        if (!envelopeResult.ok) {
          return NextResponse.json({ error: envelopeResult.error }, { status: 400 });
        }
        marketEnvelope = envelopeResult.value;
      } else {
        const legacyResult = validateLegacyMarketDraft(data);
        if (!legacyResult.ok) {
          return NextResponse.json({ error: legacyResult.error }, { status: 400 });
        }
        // TODO: market 배포가 strict envelope로 전환된 뒤 이 호환 경로와 로그를 제거한다.
        console.warn("[market-account-request] legacy draft-only request accepted without idempotency metadata");
      }
    }

    const emailList = String(data.emails)
      .split(/[,;\n]+/)
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0);
    const uniqueValidEmails = [...new Set(emailList.filter((email) => isValidEmail(email)))];

    if (uniqueValidEmails.length === 0) {
      return NextResponse.json({ error: "At least one valid email is required" }, { status: 400 });
    }

    if (!isAuthenticated && uniqueValidEmails.length > 10) {
      return NextResponse.json({ error: "Public requests can include up to 10 emails" }, { status: 400 });
    }

    const normalizedSchoolName = normalizeText(String(data.schoolName), 120);
    const normalizedSchoolNameEn = normalizeOptionalText(data.schoolNameEn, 160);
    // H2: notes is admin-only context stored in unbounded Postgres text; raise cap from 500 to 4000
    const normalizedNotes = typeof data.notes === "string" ? normalizeText(data.notes, 4000) : null;
    const normalizedOldEmail = isAuthenticated ? normalizeOptionalText(data.oldEmail, 254) : null;
    const normalizedFromType = isAuthenticated ? normalizeOptionalText(data.fromType, 80) : null;
    const normalizedExtensionDate = isAuthenticated ? normalizeOptionalText(data.extensionDate, 120) : null;

    if (!normalizedSchoolName) {
      return NextResponse.json({ error: "schoolName is required" }, { status: 400 });
    }

    const resolvedSchoolNameEn = await resolveAccountRequestSchoolNameEn(
      normalizedSchoolName,
      normalizedSchoolNameEn,
    );

    const insertedApplicantType = isAuthenticated ? (data.applicantType === "individual" ? "individual" : "school") : "school";
    const insertedType = isAuthenticated ? data.type || "upgrade" : "upgrade";
    const insertedAccountType = isAuthenticated ? data.accountType || "teacher" : "teacher";
    const insertedQuantity = isAuthenticated ? data.quantity || 1 : uniqueValidEmails.length;
    const insertedChannel = isAuthenticated ? data.channel || "company" : "company";
    // 인보이스 필요 여부: 미지정 시 유형별 스마트 기본값.
    // 돈이 드는 유형(upgrade/extension)은 true, 단순 계정 정보 변경(email_change/type_change)은 false.
    const insertedNeedsInvoice =
      isAuthenticated && typeof data.needsInvoice === "boolean"
        ? data.needsInvoice
        : defaultNeedsInvoice(insertedType);

    const requestValues = {
      channel: insertedChannel,
      applicantType: insertedApplicantType,
      type: insertedType,
      schoolName: normalizedSchoolName,
      schoolNameEn: resolvedSchoolNameEn,
      emails: uniqueValidEmails.join(", "),
      accountType: insertedAccountType,
      quantity: insertedQuantity,
      oldEmail: normalizedOldEmail,
      fromType: normalizedFromType,
      extensionDate: normalizedExtensionDate,
      notes: normalizedNotes,
      needsInvoice: insertedNeedsInvoice,
      status: "draft",
    };

    if (marketEnvelope) {
      const payloadHash = hashMarketPayload({
        ...requestValues,
        emails: [...uniqueValidEmails].sort(),
        externalSource: marketEnvelope.externalSource,
        marketRequestId: marketEnvelope.marketRequestId,
        marketOrderId: marketEnvelope.marketOrderId,
        orderNumber: marketEnvelope.orderNumber,
        draftOnly: true,
      });
      const existing = await findExistingMarketRequest(marketEnvelope);
      if (existing) return marketReplayResponse(existing, marketEnvelope, payloadHash);

      try {
        const [item] = await db
          .insert(accountRequests)
          .values({
            ...requestValues,
            externalSource: marketEnvelope.externalSource,
            marketRequestId: marketEnvelope.marketRequestId,
            marketOrderId: marketEnvelope.marketOrderId,
            orderNumber: marketEnvelope.orderNumber,
            idempotencyKey: marketEnvelope.idempotencyKey,
            externalPayloadHash: payloadHash,
            draftOnly: true,
          })
          .returning({ id: accountRequests.id, status: accountRequests.status });

        if (!item) {
          return NextResponse.json({ error: "Failed to create account request" }, { status: 500 });
        }

        // 외부 주문 수신은 저장만 한다. Jon 메일은 기존 관리자 UI의 수동 발송만 허용한다.
        return NextResponse.json({
          success: true,
          requestId: item.id,
          status: item.status,
          created: true,
          duplicate: false,
          deliveryMode: MARKET_DRAFT_DELIVERY_MODE,
        });
      } catch {
        // 동시 재시도에서 unique 제약이 먼저 이긴 경우 동일 요청을 다시 찾아 멱등 응답한다.
        try {
          const raced = await findExistingMarketRequest(marketEnvelope);
          if (raced) return marketReplayResponse(raced, marketEnvelope, payloadHash);
        } catch {
          // 개인정보나 SQL 오류 원문을 로그에 남기지 않고 일반 오류로 종료한다.
        }
        return NextResponse.json({ error: "Failed to create account request" }, { status: 500 });
      }
    }

    const [item] = await db
      .insert(accountRequests)
      .values(isApiKeyAuth
        ? {
          ...requestValues,
          externalSource: "market",
          draftOnly: true,
        }
        : requestValues)
      .returning();

    // 자동 Jon 발송은 사용자 정책상 비활성. 정산 화면에서 수동으로 검토 후 발송.
    return NextResponse.json({
      success: true,
      requestId: item.id,
      ...(isApiKeyAuth
        ? {
          status: item.status,
          created: true,
          duplicate: false,
          legacy: true,
          deliveryMode: MARKET_DRAFT_DELIVERY_MODE,
        }
        : {}),
    });
  }

  if (!(await checkAuth())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (action === "update" && id) {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const fields = ["channel", "applicantType", "type", "schoolName", "schoolNameEn", "emails", "accountType", "quantity", "oldEmail",
      "fromType", "extensionDate", "notes", "needsInvoice", "status", "invoiceNumber", "invoiceAmount",
      "invoiceDueDate", "paymentLink", "paymentDate", "paymentMethod"];
    for (const f of fields) {
      if (data[f] !== undefined) updates[f] = data[f];
    }
    if (typeof updates.schoolName === "string") {
      updates.schoolNameEn = await resolveAccountRequestSchoolNameEn(
        updates.schoolName,
        typeof updates.schoolNameEn === "string" ? updates.schoolNameEn : null,
      );
    }
    // Jon 처리완료(processed) 전환 감지를 위해 이전 상태 조회
    const [prev] = await db.select({ status: accountRequests.status }).from(accountRequests).where(eq(accountRequests.id, id));
    const [item] = await db
      .update(accountRequests)
      .set(updates)
      .where(eq(accountRequests.id, id))
      .returning();
    // 정산이 processed(Jon 처리완료)로 새로 전환된 교사 업그레이드 건 → 교사 본인에게 활성화 완료 메일 자동 발송
    // (Jon이 확인 링크로 처리하면 account-confirm 플로우가 이미 발송하므로, 여기선 대시보드 수동 전환 케이스를 커버)
    if (item && prev?.status !== "processed" && item.status === "processed" && item.type === "upgrade" && item.accountType === "teacher") {
      void sendAccountUpgradeCompletion({ emails: item.emails, schoolName: item.schoolName, schoolNameEn: item.schoolNameEn });
    }
    return NextResponse.json({ request: item });
  }

  if (action === "delete" && id) {
    await db.delete(accountRequests).where(eq(accountRequests.id, id));
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
