export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { callMarketPartnerNotification } from "@/lib/market-partner-notification";
import { checkAuth } from "@/lib/auth";

const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const PARTNER_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

type SelectionGroup = { partnerRequestId: string; requestIds: number[] };

/** 단건({partnerRequestId, requestIds})과 묶음({groups: [...]}) 모두 받는다. 신청 20건·교사 100명까지. */
function parseGroups(raw: Record<string, unknown>): SelectionGroup[] | null {
  const rawGroups = Array.isArray(raw.groups)
    ? raw.groups
    : [{ partnerRequestId: raw.partnerRequestId, requestIds: raw.requestIds }];
  if (rawGroups.length === 0 || rawGroups.length > 20) return null;
  const groups: SelectionGroup[] = [];
  for (const item of rawGroups) {
    if (!item || typeof item !== "object") return null;
    const group = item as Record<string, unknown>;
    const partnerRequestId = typeof group.partnerRequestId === "string" ? group.partnerRequestId.trim() : "";
    const requestIds = parseIds(group.requestIds);
    if (!PARTNER_REQUEST_ID_PATTERN.test(partnerRequestId) || !requestIds) return null;
    groups.push({ partnerRequestId, requestIds });
  }
  const allIds = groups.flatMap((group) => group.requestIds);
  if (new Set(groups.map((group) => group.partnerRequestId)).size !== groups.length) return null;
  if (allIds.length > 100 || new Set(allIds).size !== allIds.length) return null;
  return groups;
}

function parseIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const ids = value.filter((item): item is number => Number.isSafeInteger(item) && item > 0);
  return ids.length === value.length && new Set(ids).size === ids.length ? ids : null;
}

async function loadSelection(partnerRequestId: string, requestIds: number[]) {
  const rows = await db.select({
    id: accountRequests.id,
    channel: accountRequests.channel,
    partnerRequestId: accountRequests.partnerRequestId,
    partnerItemId: accountRequests.partnerItemId,
    partnerLifecycleState: accountRequests.partnerLifecycleState,
    processingEmailSentAt: accountRequests.processingEmailSentAt,
    confirmedAt: accountRequests.confirmedAt,
    partnerNotificationSentAt: accountRequests.partnerNotificationSentAt,
    partnerNotificationOperationId: accountRequests.partnerNotificationOperationId,
    teacherName: accountRequests.teacherName,
    emails: accountRequests.emails,
    subject: accountRequests.subject,
  }).from(accountRequests).where(and(
    eq(accountRequests.partnerRequestId, partnerRequestId),
    inArray(accountRequests.id, requestIds),
  ));
  if (rows.length !== requestIds.length) return null;
  if (rows.some((row) => (
    row.channel !== "partner"
    || row.partnerRequestId !== partnerRequestId
    || row.partnerLifecycleState !== "active"
    || !row.processingEmailSentAt
    || !row.confirmedAt
    || !row.partnerItemId
    || row.partnerNotificationSentAt
    || row.partnerNotificationOperationId
  ))) return null;
  return rows;
}

async function saveResult(
  operationId: string,
  status: "sent" | "unknown" | "failed",
  sentAt?: string | null,
) {
  const parsedSentAt = sentAt ? new Date(sentAt) : null;
  await db.update(accountRequests).set({
    // failed는 Gmail 호출 전 실패 또는 수동 미발송 확인이므로 selection을 다시 연다.
    // unknown은 operationId를 유지해 자동 재발송을 막고 상태조회·수동감사만 허용한다.
    partnerNotificationOperationId: status === "failed" ? null : operationId,
    partnerNotificationSentAt: status === "sent" ? (parsedSentAt && !Number.isNaN(parsedSentAt.getTime()) ? parsedSentAt : new Date()) : null,
    updatedAt: new Date(),
  }).where(eq(accountRequests.partnerNotificationOperationId, operationId));
}

export async function POST(request: NextRequest) {
  if (!(await checkAuth())) return json({ error: "Unauthorized" }, 401);
  if (request.headers.get("origin") !== request.nextUrl.origin) return json({ error: "Invalid origin" }, 403);

  const raw = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!raw || typeof raw.action !== "string") return json({ error: "Invalid request" }, 400);

  if (raw.action === "status" || raw.action === "review") {
    const operationId = typeof raw.operationId === "string" ? raw.operationId.trim() : "";
    if (!OPERATION_ID_PATTERN.test(operationId)) return json({ error: "Invalid operation ID" }, 400);
    const localRows = await db.select({ id: accountRequests.id }).from(accountRequests)
      .where(eq(accountRequests.partnerNotificationOperationId, operationId));
    if (localRows.length === 0) return json({ error: "Operation not found" }, 404);

    const payload = raw.action === "status"
      ? { action: "status" as const, operationId }
      : {
          action: "review" as const,
          operationId,
          outcome: raw.outcome === "sent" ? "sent" as const : raw.outcome === "not_sent" ? "not_sent" as const : null,
          note: typeof raw.note === "string" ? raw.note.trim() : "",
        };
    if (payload.action === "review" && (!payload.outcome || payload.note.length < 3 || payload.note.length > 500)) {
      return json({ error: "수동 확인 결과와 3자 이상의 확인 메모가 필요합니다." }, 400);
    }
    const { response, body } = await callMarketPartnerNotification(payload as Parameters<typeof callMarketPartnerNotification>[0]);
    if (response.status === 404 && raw.action === "status") {
      // Market 원장에 operation이 없다는 확정 응답이면 외부 발송도 시작되지 않았다.
      await saveResult(operationId, "failed");
      return json({ ...body, status: "failed", retryAllowed: true }, 200);
    }
    if (body.status === "sent" || body.status === "unknown" || body.status === "failed") {
      await saveResult(operationId, body.status, body.sentAt);
    }
    return json(body as Record<string, unknown>, response.status);
  }

  if (raw.action !== "preview" && raw.action !== "send") return json({ error: "Invalid action" }, 400);
  const groups = parseGroups(raw);
  if (!groups) return json({ error: "Invalid selection" }, 400);
  const selections = [];
  for (const group of groups) {
    const rows = await loadSelection(group.partnerRequestId, group.requestIds);
    if (!rows) return json({ error: "승인 완료·미통보 상태인 협력사 신청의 교사만 선택할 수 있습니다." }, 409);
    selections.push({ partnerRequestId: group.partnerRequestId, rows });
  }
  const marketGroups = selections.map((selection) => ({
    requestId: selection.partnerRequestId,
    itemIds: selection.rows.map((row) => row.partnerItemId!),
  }));
  const requestIds = groups.flatMap((group) => group.requestIds);
  const partnerRequestIds = groups.map((group) => group.partnerRequestId);

  if (raw.action === "preview") {
    // 같은 협력사가 아니면 Market 이 409 로 거절한다 — 메일 한 통은 한 수신자에게만 간다.
    const { response, body } = await callMarketPartnerNotification({ action: "preview", groups: marketGroups });
    return json({
      ...body,
      groups: response.ok ? selections.map((selection) => ({
        partnerRequestId: selection.partnerRequestId,
        rows: selection.rows.map((row) => ({
          id: row.id,
          teacherName: row.teacherName,
          email: row.emails,
          subject: row.subject,
        })),
      })) : undefined,
    }, response.status);
  }

  const operationId = typeof raw.operationId === "string" ? raw.operationId.trim() : "";
  if (!OPERATION_ID_PATTERN.test(operationId)) return json({ error: "Invalid operation ID" }, 400);
  // 외부 호출 직전 로컬에도 operation을 먼저 남긴다. 응답 유실 시 재발송하지 않고
  // 같은 operation 상태를 조회하거나 Gmail 보낸편지함을 수동 확인하게 한다.
  const claimedRows = await db.update(accountRequests).set({
    partnerNotificationOperationId: operationId,
    updatedAt: new Date(),
  }).where(and(
    // 각 id 가 자기 신청에 속하는지는 loadSelection 이 확인했다.
    inArray(accountRequests.partnerRequestId, partnerRequestIds),
    inArray(accountRequests.id, requestIds),
    eq(accountRequests.partnerLifecycleState, "active"),
    isNull(accountRequests.partnerNotificationOperationId),
    isNull(accountRequests.partnerNotificationSentAt),
  )).returning({ id: accountRequests.id });
  if (claimedRows.length !== requestIds.length) {
    await db.update(accountRequests).set({
      partnerNotificationOperationId: null,
      updatedAt: new Date(),
    }).where(and(
      eq(accountRequests.partnerNotificationOperationId, operationId),
      isNull(accountRequests.partnerNotificationSentAt),
    ));
    return json({ error: "다른 승인 안내 작업이 먼저 선택 항목을 선점했습니다." }, 409);
  }

  try {
    const { response, body } = await callMarketPartnerNotification({
      action: "send",
      groups: marketGroups,
      operationId,
    });
    if (body.status === "sent" || body.status === "unknown" || body.status === "failed") {
      await saveResult(operationId, body.status, body.sentAt);
    } else if (!response.ok) {
      // Market이 HTTP 응답으로 Gmail 호출 전 거절을 확정한 경우에만 선점을 해제한다.
      // 네트워크 예외는 호출 도달 여부가 불명확하므로 catch에서 operationId를 유지한다.
      await saveResult(operationId, "failed");
    }
    return json(body as Record<string, unknown>, response.status);
  } catch {
    return json({
      error: "Market 응답을 확인하지 못했습니다.",
      status: "unknown",
      operationId,
      requiresManualReview: true,
    }, 202);
  }
}
