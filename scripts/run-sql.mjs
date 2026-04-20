import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/run-sql.mjs <path-to-sql-file>");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(url);
const text = readFileSync(file, "utf8");

// Split on semicolons that end a statement (naive but works for our migrations).
// We preserve CTEs/multi-line by only splitting on ; at end-of-line.
const statements = text
  .split(/;\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s && !/^--/.test(s.replace(/\s+/g, "")));

for (const stmt of statements) {
  const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
  console.log("→", preview + (stmt.length > 80 ? "..." : ""));
  await sql.query(stmt);
}
console.log("✓ done");
