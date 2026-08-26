// 0017 전용 마이그레이션 적용기 (범용 splitter 아님 — 파일을 통째로 한 번에 보낸다)
//
// 0011~0016 처럼 문장 배열로 나눌 수 없다. 0017 은 $$ 로 감싼 PL/pgSQL 함수 6개와
// 트리거를 담고 있어서 세미콜론으로 자르면 함수 본문이 조각난다.
// 그래서 HTTP 드라이버(neon) 대신 WebSocket Client 를 쓰고, 파일 전체를 simple query
// 한 번으로 보낸다. 파일 자체가 BEGIN … COMMIT 이라 도중 실패하면 전부 롤백된다.
//
// 사용법
//   dry run  : node scripts/apply-0017.mjs
//   적용     : node scripts/apply-0017.mjs --apply
//   브랜치용 : DATABASE_URL="postgresql://…" node scripts/apply-0017.mjs --apply
//              (DATABASE_URL 이 있으면 그것을, 없으면 .env.local 을 쓴다)

import { Client, neonConfig } from "@neondatabase/serverless";
import fs from "fs";

if (typeof globalThis.WebSocket === "function") {
  neonConfig.webSocketConstructor = globalThis.WebSocket;
}

const MIGRATION = "drizzle/0017_add_market_order_void_fence.sql";
const APPLY = process.argv.includes("--apply");

const url =
  process.env.DATABASE_URL?.trim() ||
  fs.readFileSync(".env.local", "utf8")
    .match(/^DATABASE_URL=(.*)$/m)[1]
    .trim()
    .replace(/^["']|["']$/g, "");

const migration = fs.readFileSync(MIGRATION, "utf8");

const client = new Client(url);
await client.connect();

const one = async (q) => (await client.query(q)).rows[0];
const col = async (q) => (await client.query(q)).rows.map((r) => Object.values(r)[0]).sort();

// 이 마이그레이션이 만들어야 할 객체 목록 — 적용 후 이대로 존재해야 통과
const EXPECT = {
  columns: [
    "market_void_operation_id",
    "market_void_prepared_at",
    "market_void_state",
    "market_voided_at",
  ],
  tables: ["market_order_void_fences", "market_order_void_operations"],
  constraints: [
    "account_requests_market_void_state_check",
    "market_order_void_fences_state_check",
    "market_order_void_operations_state_check",
  ],
};

async function counts() {
  return one(`SELECT
    (SELECT count(*) FROM account_requests)::int AS account_requests,
    (SELECT count(*) FROM teachers)::int         AS teachers,
    (SELECT count(*) FROM schools)::int          AS schools,
    (SELECT count(*) FROM domain_requests)::int  AS domain_requests`);
}

async function objects() {
  return {
    columns: await col(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='account_requests'
        AND column_name IN ('market_void_state','market_void_operation_id','market_void_prepared_at','market_voided_at')`),
    tables: await col(`SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('market_order_void_fences','market_order_void_operations')`),
    constraints: await col(`SELECT conname FROM pg_constraint
      WHERE conname IN ('account_requests_market_void_state_check','market_order_void_fences_state_check','market_order_void_operations_state_check')`),
    functions: await col(`SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND proname LIKE '%market%'`),
    triggers: await col(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`),
  };
}

const before = await counts();
const objBefore = await objects();
console.log("[before] row counts :", JSON.stringify(before));
console.log("[before] 0017 objects:", JSON.stringify(objBefore));

if (!APPLY) {
  console.log("\ndry run — 변경 없음. 적용하려면 --apply 를 붙일 것.");
  await client.end();
  process.exit(0);
}

console.log(`\n>>> ${MIGRATION} 을 단일 배치로 적용 중 …`);
try {
  await client.query(migration);
  console.log(">>> 적용 완료 (파일 내부 COMMIT 성공)");
} catch (err) {
  console.error(">>> 실패 — 트랜잭션 롤백됨");
  console.error(`    ${err.message}`);
  await client.end();
  process.exit(1);
}

const after = await counts();
const objAfter = await objects();
console.log("\n[after] row counts :", JSON.stringify(after));
console.log("[after] 0017 objects:", JSON.stringify(objAfter));

console.log("\n=== 검증 ===");
let ok = true;

for (const [kind, want] of Object.entries(EXPECT)) {
  for (const name of want) {
    const has = objAfter[kind].includes(name);
    if (!has) ok = false;
    console.log(`  ${has ? "ok  " : "MISS"} ${kind}: ${name}`);
  }
}

// 스키마 변경이 데이터를 건드리지 않았는지 — 이게 어긋나면 즉시 조사할 것
for (const [table, n] of Object.entries(before)) {
  const same = after[table] === n;
  if (!same) ok = false;
  console.log(`  ${same ? "ok  " : "DIFF"} row count ${table}: ${n} -> ${after[table]}`);
}

const dist = (await client.query(
  `SELECT market_void_state, count(*)::int n FROM account_requests GROUP BY 1 ORDER BY 1`
)).rows;
console.log(`  market_void_state 분포: ${dist.map((r) => `${r.market_void_state}=${r.n}`).join(", ")}`);

const fence = await one(`SELECT
  (SELECT count(*) FROM market_order_void_fences)::int      AS fences,
  (SELECT count(*) FROM market_order_void_operations)::int  AS operations`);
const marketRows = (await one(
  `SELECT count(*)::int n FROM account_requests WHERE external_source='market'`
)).n;
console.log(`  fences=${fence.fences}, operations=${fence.operations} (market 행 ${marketRows}건 기준)`);

console.log(`\n${ok ? "RESULT: 0017 적용·검증 통과." : "RESULT: 검증 실패 — 위 MISS/DIFF 확인할 것."}`);
await client.end();
process.exit(ok ? 0 : 1);
