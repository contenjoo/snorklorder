// 공동구매 팀 라벨·색상의 단일 출처(SSOT).
// teams DB 테이블은 데이터 기록용, 렌더링용 라벨/색상은 여기서 관리.
// Tailwind v4가 이 파일의 리터럴 클래스 문자열을 자동 스캔하므로 purge 안전.

export interface TeamColor {
  bg: string;
  text: string;
  dot: string;
  border: string;
  hex: string; // 차트/인라인 스타일용
}

export const TEAM_EN: Record<string, string> = {
  "서울1팀": "Seoul Team 1",
  "서울4팀": "Seoul Team 4",
  "서울8팀": "Seoul Team 8",
  "경기2팀": "Gyeonggi Team 2",
  "경기3팀": "Gyeonggi Team 3",
  "경기5팀": "Gyeonggi Team 5",
  "경기6팀": "Gyeonggi Team 6",
  "경기7팀": "Gyeonggi Team 7",
  "경기9팀": "Gyeonggi Team 9",
};

export const TEAM_COLORS: Record<string, TeamColor> = {
  "서울1팀": { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500", border: "border-blue-200", hex: "#3b82f6" },
  "서울4팀": { bg: "bg-blue-50", text: "text-blue-600", dot: "bg-blue-400", border: "border-blue-200", hex: "#6366f1" },
  "서울8팀": { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500", border: "border-violet-200", hex: "#8b5cf6" },
  "경기2팀": { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", border: "border-emerald-200", hex: "#10b981" },
  "경기3팀": { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500", border: "border-green-200", hex: "#22c55e" },
  "경기5팀": { bg: "bg-teal-50", text: "text-teal-700", dot: "bg-teal-500", border: "border-teal-200", hex: "#14b8a6" },
  "경기6팀": { bg: "bg-slate-50", text: "text-slate-700", dot: "bg-slate-500", border: "border-slate-200", hex: "#64748b" },
  "경기7팀": { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500", border: "border-rose-200", hex: "#f43f5e" },
  "경기9팀": { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", border: "border-amber-200", hex: "#f59e0b" },
};

export const DEFAULT_TEAM_COLOR: TeamColor = {
  bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-400", border: "border-gray-200", hex: "#9ca3af",
};

export function teamColor(team: string | null | undefined): TeamColor {
  if (!team) return DEFAULT_TEAM_COLOR;
  return TEAM_COLORS[team] || DEFAULT_TEAM_COLOR;
}

export function teamLabelEn(team: string | null | undefined): string {
  if (!team || team === "미배정") return "Unassigned";
  if (TEAM_EN[team]) return TEAM_EN[team];
  if (team.includes("개별")) return "Individual";
  if (team === "취소") return "Cancelled";
  return team;
}

export function isGroupPurchaseTeam(team: string | null | undefined): boolean {
  if (!team) return false;
  return !team.includes("개별") && team !== "미배정" && team !== "취소";
}
