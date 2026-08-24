import { inArray, eq } from "drizzle-orm";
import { db } from "@/db";
import { schools } from "@/db/schema";

type SchoolNameRow = {
  schoolName: string;
  schoolNameEn?: string | null;
};

function cleanEnglishName(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function hasKoreanText(value: string | null | undefined) {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(value || "");
}

export async function resolveAccountRequestSchoolNameEn(
  schoolName: string,
  current?: string | null,
) {
  const existing = cleanEnglishName(current);
  if (existing) return existing;

  const [school] = await db
    .select({ nameEn: schools.nameEn })
    .from(schools)
    .where(eq(schools.name, schoolName))
    .limit(1);

  return cleanEnglishName(school?.nameEn);
}

export async function hydrateAccountRequestSchoolNames<T extends SchoolNameRow>(
  rows: T[],
): Promise<T[]> {
  const missingNames = [
    ...new Set(
      rows
        .filter((row) => !cleanEnglishName(row.schoolNameEn))
        .map((row) => row.schoolName.trim())
        .filter(Boolean),
    ),
  ];

  if (missingNames.length === 0) return rows;

  const schoolRows = await db
    .select({ name: schools.name, nameEn: schools.nameEn })
    .from(schools)
    .where(inArray(schools.name, missingNames));

  const nameEnBySchoolName = new Map(
    schoolRows
      .map((school) => [school.name, cleanEnglishName(school.nameEn)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );

  return rows.map((row) => {
    const schoolNameEn = cleanEnglishName(row.schoolNameEn) || nameEnBySchoolName.get(row.schoolName) || null;
    return schoolNameEn === row.schoolNameEn ? row : { ...row, schoolNameEn };
  });
}

export function needsEnglishSchoolNameForHq(
  row: SchoolNameRow & { applicantType?: string | null },
) {
  return row.applicantType !== "individual"
    && hasKoreanText(row.schoolName)
    && !cleanEnglishName(row.schoolNameEn);
}
