import { eq } from "drizzle-orm";
import { db } from "@/db";
import { schools } from "@/db/schema";
import TeacherRegistration from "@/components/teacher-registration";

export const dynamic = "force-dynamic";

// 학교별 등록 링크: /j/{학교코드} 로 들어오면 학교가 미리 선택된 상태로 이름·이메일 입력부터 시작한다.
export default async function SchoolJoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalized = decodeURIComponent(code).trim().toUpperCase();
  const [school] = normalized
    ? await db
        .select({ id: schools.id, name: schools.name, nameEn: schools.nameEn, team: schools.team })
        .from(schools)
        .where(eq(schools.code, normalized))
    : [];

  if (!school) {
    return <TeacherRegistration linkNotice="등록 링크의 학교를 찾을 수 없습니다. 아래에서 학교를 검색해주세요." />;
  }
  if (school.team === "취소") {
    return <TeacherRegistration linkNotice="취소된 학교입니다. 학교 단체구매 신청이 종료되었어요." />;
  }
  return <TeacherRegistration initialSchool={{ id: school.id, name: school.name, nameEn: school.nameEn }} />;
}
