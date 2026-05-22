export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { schools } from "@/db/schema";
import { neon } from "@neondatabase/serverless";
import nodemailer from "nodemailer";

const ADMIN_EMAIL = process.env.GMAIL_USER || "";
const MARKET_DB_URL = process.env.MARKET_DATABASE_URL || "";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (authHeader !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!MARKET_DB_URL) return NextResponse.json({ skipped: true, reason: "MARKET_DATABASE_URL not configured" });

  const mkDb = neon(MARKET_DB_URL);
  const trSchools = await db.select({ name: schools.name, nameEn: schools.nameEn, code: schools.code, region: schools.region, team: schools.team }).from(schools);
  const mkSchoolsRaw = await mkDb`SELECT name, "nameEn", code, region, team FROM "SnorklSchool"` as Array<{ name: string; nameEn: string | null; code: string; region: string | null; team: string | null }>;

  const mkByCode = new Map(mkSchoolsRaw.map((s) => [s.code, s]));
  const trByCode = new Map(trSchools.map((s) => [s.code, s]));
  const missingInMk: string[] = [];
  const drifted: { code: string; field: string; tr: unknown; mk: unknown }[] = [];

  for (const tr of trSchools) {
    const mk = mkByCode.get(tr.code);
    if (!mk) { missingInMk.push(tr.code); continue; }
    if (mk.name !== tr.name) drifted.push({ code: tr.code, field: "name", tr: tr.name, mk: mk.name });
    if (mk.nameEn !== tr.nameEn) drifted.push({ code: tr.code, field: "nameEn", tr: tr.nameEn, mk: mk.nameEn });
    if (mk.team !== tr.team) drifted.push({ code: tr.code, field: "team", tr: tr.team, mk: mk.team });
    if (mk.region !== tr.region) drifted.push({ code: tr.code, field: "region", tr: tr.region, mk: mk.region });
  }
  const missingInTr = mkSchoolsRaw.filter((s) => !trByCode.has(s.code)).map((s) => s.code);

  // 알림 메일 (변화 있을 때만)
  if ((missingInMk.length || drifted.length || missingInTr.length) && ADMIN_EMAIL) {
    const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD;
    if (user && pass) {
      const t = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
      const lines: string[] = [];
      if (missingInMk.length) lines.push(`<h4>market에 누락된 학교 (${missingInMk.length})</h4><p>${missingInMk.join(", ")}</p>`);
      if (drifted.length) lines.push(`<h4>드리프트 (${drifted.length})</h4><ul>${drifted.map(d => `<li>${d.code}.${d.field}: market="${d.mk}" vs reg="${d.tr}"</li>`).join("")}</ul>`);
      if (missingInTr.length) lines.push(`<h4>snorkl-teacher-reg에 누락된 학교 (${missingInTr.length})</h4><p>${missingInTr.join(", ")}</p>`);
      await t.sendMail({
        from: ADMIN_EMAIL, to: ADMIN_EMAIL,
        subject: `[Snorkl] 학교 DB 드리프트 감지 — ${missingInMk.length + drifted.length + missingInTr.length}건`,
        html: `<div style="font-family:sans-serif;max-width:560px">${lines.join("")}</div>`,
      });
    }
  }

  return NextResponse.json({
    missingInMarket: missingInMk.length,
    drifted: drifted.length,
    missingInTeacherReg: missingInTr.length,
    samples: { missingInMk: missingInMk.slice(0, 5), drifted: drifted.slice(0, 5), missingInTr: missingInTr.slice(0, 5) },
  });
}
