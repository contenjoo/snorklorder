// 협력사 제품 신청 파이프라인 0018 전용 마이그레이션 적용기.
// 기본 실행은 읽기 전용 dry-run이며, 운영 적용은 --apply와 정확한 opt-in을 모두 요구한다.
//
// dry run: node scripts/apply-0018.mjs
// 적용: PARTNER_PRODUCT_MIGRATION_APPLY=YES_0018 node scripts/apply-0018.mjs --apply

import { Client, neonConfig } from "@neondatabase/serverless";
import fs from "node:fs";

if (typeof globalThis.WebSocket === "function") {
  neonConfig.webSocketConstructor = globalThis.WebSocket;
}

const MIGRATION = "drizzle/0018_partner_product_requests.sql";
const APPLY = process.argv.includes("--apply");
const OPT_IN = process.env.PARTNER_PRODUCT_MIGRATION_APPLY === "YES_0018";

if (APPLY && !OPT_IN) {
  console.error("[0018] 적용에는 PARTNER_PRODUCT_MIGRATION_APPLY=YES_0018 명시 승인이 필요합니다.");
  process.exit(2);
}

const localEnv = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "";
const url = process.env.DATABASE_URL?.trim()
  || localEnv.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");

if (!url) {
  console.error("[0018] DATABASE_URL이 설정되지 않았습니다.");
  process.exit(2);
}

const migration = fs.readFileSync(MIGRATION, "utf8");
const client = new Client(url);
await client.connect();

const one = async (query) => (await client.query(query)).rows[0];
const values = async (query) => (await client.query(query)).rows.map((row) => Object.values(row)[0]).sort();

async function counts() {
  return one(`SELECT
    (SELECT count(*) FROM account_requests)::int AS account_requests,
    (SELECT count(*) FROM teachers)::int AS teachers,
    (SELECT count(*) FROM schools)::int AS schools`);
}

async function objects() {
  return {
    columns: await values(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='account_requests'
        AND column_name IN (
          'partner_request_id','partner_item_id','partner_revision','partner_payload_hash',
          'teacher_name','subject','partner_lifecycle_state',
          'partner_notification_operation_id','partner_notification_sent_at'
        )`),
    tables: await values(`SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('partner_request_operations')`),
    constraints: await values(`SELECT conname FROM pg_constraint
      WHERE conname IN ('account_requests_partner_lifecycle_state_check')`),
    indexes: await values(`SELECT indexname FROM pg_indexes
      WHERE schemaname='public' AND indexname IN (
        'account_requests_partner_request_idx',
        'account_requests_partner_item_unique_idx',
        'partner_request_operations_request_idx'
      )`),
  };
}

const expected = {
  columns: [
    "partner_item_id",
    "partner_lifecycle_state",
    "partner_notification_operation_id",
    "partner_notification_sent_at",
    "partner_payload_hash",
    "partner_request_id",
    "partner_revision",
    "subject",
    "teacher_name",
  ].sort(),
  tables: ["partner_request_operations"],
  constraints: ["account_requests_partner_lifecycle_state_check"],
  indexes: [
    "account_requests_partner_item_unique_idx",
    "account_requests_partner_request_idx",
    "partner_request_operations_request_idx",
  ].sort(),
};

const beforeCounts = await counts();
const beforeObjects = await objects();
console.log("[before] row counts:", JSON.stringify(beforeCounts));
console.log("[before] 0018 objects:", JSON.stringify(beforeObjects));

if (!APPLY) {
  console.log("RESULT: dry-run 완료. DB 변경 없음.");
  await client.end();
  process.exit(0);
}

try {
  await client.query(migration);
} catch (error) {
  console.error("[0018] 적용 실패. SQL 트랜잭션이 롤백됐습니다.");
  console.error(error instanceof Error ? error.message : "unknown error");
  await client.end();
  process.exit(1);
}

const afterCounts = await counts();
const afterObjects = await objects();
let ok = true;
for (const [kind, names] of Object.entries(expected)) {
  for (const name of names) {
    const exists = afterObjects[kind].includes(name);
    if (!exists) ok = false;
    console.log(`${exists ? "ok" : "MISS"} ${kind}: ${name}`);
  }
}
for (const [table, count] of Object.entries(beforeCounts)) {
  const unchanged = afterCounts[table] === count;
  if (!unchanged) ok = false;
  console.log(`${unchanged ? "ok" : "DIFF"} row count ${table}: ${count} -> ${afterCounts[table]}`);
}

console.log(ok ? "RESULT: 0018 적용·검증 통과." : "RESULT: 0018 검증 실패.");
await client.end();
process.exit(ok ? 0 : 1);
