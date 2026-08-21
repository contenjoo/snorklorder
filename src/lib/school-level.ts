// 학교급(초/중/고) 판별 — DB 에 level 컬럼이 없어 이름에서 유도한다.
// 영문명(Elementary/Middle/High)이 한글 접미사보다 신뢰도가 높아 우선.
export type SchoolLevel = "초" | "중" | "고";

export function schoolLevel(name: string, nameEn?: string | null): SchoolLevel | null {
  const en = (nameEn || "").toLowerCase();
  if (en.includes("elementary")) return "초";
  if (en.includes("middle")) return "중";
  if (en.includes("high")) return "고";
  if (/초등학교|초$/.test(name)) return "초";
  if (/중학교|중$/.test(name)) return "중";
  if (/고등학교|고$/.test(name)) return "고";
  return null;
}

export const levelBadgeCls: Record<SchoolLevel, string> = {
  초: "text-teal-600 bg-teal-50",
  중: "text-sky-600 bg-sky-50",
  고: "text-rose-600 bg-rose-50",
};
