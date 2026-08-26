import { sql } from "drizzle-orm";
import { db } from "@/db";

type ClaimRow = { claimed: boolean | string | number | null };

/**
 * 메일·완료 알림처럼 외부 side effect를 시작하기 전에 Market order fence를 all-or-none 선점한다.
 * false면 prepared/voided/missing 요청이 하나라도 있으므로 어떤 외부 작업도 시작하면 안 된다.
 */
export async function claimAccountRequestSideEffects(requestIds: number[]): Promise<boolean> {
  const uniqueIds = [...new Set(requestIds)];
  if (uniqueIds.length === 0 || uniqueIds.length !== requestIds.length) return false;

  const result = await db.execute<ClaimRow>(sql`
    SELECT "claim_market_request_side_effects"(
      ARRAY[${sql.join(uniqueIds.map((id) => sql`${id}::integer`), sql`, `)}]::integer[]
    ) AS claimed
  `);
  const claimed = result.rows[0]?.claimed;
  return claimed === true || claimed === "t" || claimed === 1;
}

