// 검증 로직 실 DB 스모크 테스트 (이메일 발송 없음 — lib 함수 직접 호출, 임시 데이터 생성 후 정리)
import { neon } from "@neondatabase/serverless";
import { createHmac } from "crypto";
import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const sql = neon(url);

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗ FAIL:", m)); };

// 1) HMAC 학교세션 서명 라운드트립 (school-auth 로직 복제 검증)
const secret = (env.match(/^ADMIN_PASSWORD=(.*)$/m)?.[1] || "dev-insecure-secret").trim().replace(/^["']|["']$/g, "") || "dev-insecure-secret";
const sign = (id) => { const p = String(id); return `${p}.${createHmac("sha256", secret).update(p).digest("hex")}`; };
const verify = (v) => { const i = v.lastIndexOf("."); const p = v.slice(0, i), s = v.slice(i + 1); const e = createHmac("sha256", secret).update(p).digest("hex"); return s === e ? Number(p) : null; };
ok(verify(sign(42)) === 42, "school session 서명 라운드트립");
ok(verify("42.deadbeef") === null, "school session 위조 서명 거부");

// 2) 실 DB: 임시 학교+교사로 검증 파이프라인 테스트
console.log("\n[DB 검증 파이프라인 — 임시 데이터]");
const code = "TESTSMOKE_" + Math.floor(performance.now());
const [school] = await sql`INSERT INTO schools (name, code, domain) VALUES ('스모크테스트교', ${code}, 'smoke-test.kr') RETURNING id`;
try {
  // (A) 도메인 일치 교사 → resolveApproval 시 approved 되어야
  const [tMatch] = await sql`INSERT INTO teachers (school_id, name, email, status, verification_status) VALUES (${school.id}, 'A', 'a@smoke-test.kr', 'pending', 'unverified') RETURNING id`;
  // (B) 도메인 불일치 교사 → email_verified (큐). 관리자 없으니 escalated 즉시
  const [tMiss] = await sql`INSERT INTO teachers (school_id, name, email, status, verification_status) VALUES (${school.id}, 'B', 'b@gmail.com', 'pending', 'unverified') RETURNING id`;

  // 토큰 생성 (구 OTP/매직링크 발급 로직 모사 — 앱 코드에서는 제거됨, 테이블만 잔존)
  const otp = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  await sql`INSERT INTO email_verification_tokens (teacher_id, code, token, expires_at) VALUES (${tMatch.id}, ${otp}, ${"tok_" + tMatch.id}, ${new Date(Date.now() + 8.64e7)})`;
  ok(true, "email_verification_tokens insert 성공");

  // resolveApproval 모사: 도메인 일치 판정
  const [sc] = await sql`SELECT domain, allowed_domains FROM schools WHERE id=${school.id}`;
  const dom = (e) => e.slice(e.lastIndexOf("@") + 1).toLowerCase();
  const allowed = [sc.domain, ...(sc.allowed_domains?.split(",") || [])].map(d => d?.trim().toLowerCase()).filter(Boolean);
  ok(allowed.includes(dom("a@smoke-test.kr")), "도메인 일치 판정 (a@smoke-test.kr)");
  ok(!allowed.includes(dom("b@gmail.com")), "도메인 불일치 판정 (b@gmail.com)");

  // 관리자 존재 여부 (없음)
  const admins = await sql`SELECT id FROM school_admins WHERE school_id=${school.id}`;
  ok(admins.length === 0, "신규 학교 관리자 0명 → 불일치 교사는 즉시 본사 큐(escalated) 대상");

  // 게이트 검증: approved 만 Jon 발송 후보 (admin/summary 쿼리 모사)
  await sql`UPDATE teachers SET verification_status='approved' WHERE id=${tMatch.id}`;
  await sql`UPDATE teachers SET verification_status='email_verified', escalated_at=now() WHERE id=${tMiss.id}`;
  const sendable = await sql`SELECT id FROM teachers WHERE school_id=${school.id} AND status IN ('pending','sent') AND verification_status='approved'`;
  ok(sendable.length === 1 && sendable[0].id === tMatch.id, "Jon 발송 후보 = approved 교사만 (1명)");
  const hq = await sql`SELECT id FROM teachers WHERE verification_status='email_verified' AND escalated_at IS NOT NULL AND school_id=${school.id}`;
  ok(hq.length === 1 && hq[0].id === tMiss.id, "HQ 큐 = escalated email_verified (1명)");
} finally {
  // 정리 (FK 순서: tokens → teachers → school)
  await sql`DELETE FROM email_verification_tokens WHERE teacher_id IN (SELECT id FROM teachers WHERE school_id=${school.id})`;
  await sql`DELETE FROM teachers WHERE school_id=${school.id}`;
  await sql`DELETE FROM schools WHERE id=${school.id}`;
  console.log("  ↺ 임시 데이터 정리 완료");
}

console.log(`\n결과: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
