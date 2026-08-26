// 커맨드 팔레트 전용 통합 검색 데이터셋.
// 규모가 작아(학교 ~163 · 교사 ~1.5k · 정산 ~160) 전체를 한 번에 내려주고
// 매칭·랭킹은 클라이언트에서 즉시 수행한다 (타이핑 지연 없는 검색).
// proxy.ts 공개 목록에 없으므로 admin 쿠키 인증이 자동 적용된다.
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { schools, teachers, accountRequests, domainRequests, schoolRequests } from "@/db/schema";
import { desc, eq, notInArray } from "drizzle-orm";

export async function GET() {
  const [schoolRows, teacherRows, accountRows, domainRows, requestRows] = await Promise.all([
    db.select({
      id: schools.id, name: schools.name, nameEn: schools.nameEn,
      code: schools.code, team: schools.team, domain: schools.domain,
    }).from(schools),
    db.select({
      id: teachers.id, name: teachers.name, email: teachers.email,
      subject: teachers.subject, status: teachers.status,
      schoolId: teachers.schoolId, schoolName: schools.name,
    }).from(teachers).innerJoin(schools, eq(teachers.schoolId, schools.id)),
    db.select({
      id: accountRequests.id, schoolName: accountRequests.schoolName,
      schoolNameEn: accountRequests.schoolNameEn, emails: accountRequests.emails,
      status: accountRequests.status, type: accountRequests.type,
    }).from(accountRequests)
      .where(notInArray(accountRequests.marketVoidState, ["prepared", "voided"]))
      .orderBy(desc(accountRequests.createdAt)),
    db.select({
      id: domainRequests.id, schoolName: domainRequests.schoolName,
      domain: domainRequests.domain, status: domainRequests.status,
    }).from(domainRequests).orderBy(desc(domainRequests.createdAt)),
    db.select({
      id: schoolRequests.id, name: schoolRequests.name,
      contactEmail: schoolRequests.contactEmail, status: schoolRequests.status,
    }).from(schoolRequests).orderBy(desc(schoolRequests.createdAt)),
  ]);

  return NextResponse.json(
    { schools: schoolRows, teachers: teacherRows, accounts: accountRows, domains: domainRows, requests: requestRows },
    { headers: { "Cache-Control": "private, max-age=30" } }
  );
}
