export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { authorizeMarketStatusRequest } from "@/lib/market-status";
import {
  marketVoidErrorMessage,
  validateMarketVoidInput,
  type MarketVoidDbResult,
} from "@/lib/market-void";

type TransitionResultRow = { result: MarketVoidDbResult | string };

function hasDatabaseCode(error: unknown, expectedCode: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === expectedCode) return true;
    current = record.cause;
  }
  return false;
}

/**
 * Market 주문 단위 2단계 취소 수신부.
 *
 * route에서 여러 쿼리를 이어 붙이지 않는다. neon-http의 callback transaction은 지원되지
 * 않으므로 prepare/commit/abort는 DB 함수 한 번으로만 실행해 fence와 모든 요청을 원자 전이한다.
 */
export async function POST(req: NextRequest) {
  const auth = authorizeMarketStatusRequest(
    req.headers.get("x-api-key"),
    process.env.INTEGRATION_API_KEY,
  );
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  const validated = validateMarketVoidInput(body);
  if (!validated.ok) {
    return NextResponse.json(
      { success: false, code: "MARKET_VOID_INVALID_REQUEST", error: validated.error },
      { status: 400 },
    );
  }

  const input = validated.value;
  try {
    const queryResult = await db.execute<TransitionResultRow>(sql`
      SELECT "transition_market_order_void"(
        ${input.phase},
        ${input.operationId},
        ${input.marketOrderId},
        ${input.orderNumber},
        ${input.reasonCode},
        ${JSON.stringify(input.requests)}::jsonb,
        ${input.expectedVersion ?? null}::integer
      ) AS result
    `);
    const rawResult = queryResult.rows[0]?.result;
    const result = typeof rawResult === "string"
      ? JSON.parse(rawResult) as MarketVoidDbResult
      : rawResult;

    if (!result || typeof result !== "object") {
      throw new Error("MARKET_VOID_EMPTY_RESULT");
    }
    if (!result.ok) {
      return NextResponse.json({
        success: false,
        code: result.code || "MARKET_VOID_REJECTED",
        error: marketVoidErrorMessage(result.code),
        state: result.state,
        version: result.version,
      }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      phase: input.phase,
      operationId: input.operationId,
      marketOrderId: input.marketOrderId,
      state: result.state,
      version: result.version,
      idempotent: result.idempotent === true,
      ...(input.phase === "abort" ? { abortCompleted: result.abortCompleted === true } : {}),
      requests: result.requests ?? [],
    });
  } catch (error) {
    // operationId가 다른 주문에서 이미 사용된 경우 partial UNIQUE가 마지막
    // 경합을 막는다. SQL 원문은 노출하지 않고 재시도 불가 충돌로 정직하게 반환한다.
    if (hasDatabaseCode(error, "23505")) {
      return NextResponse.json({
        success: false,
        code: "MARKET_VOID_OPERATION_CONFLICT",
        error: marketVoidErrorMessage("MARKET_VOID_OPERATION_CONFLICT"),
      }, { status: 409 });
    }
    // SQL/개인정보 원문은 응답·로그에 싣지 않는다. 같은 operationId 재호출로 안전하게 복구한다.
    console.error("[market-void] atomic transition failed");
    return NextResponse.json({
      success: false,
      code: "MARKET_VOID_INTERNAL_ERROR",
      error: "Failed to persist the Market void transition. Retry with the same operationId.",
    }, { status: 500 });
  }
}
