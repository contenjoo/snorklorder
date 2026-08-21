// 전 관리자 화면 공용 상태 팔레트.
// 페이지마다 제각각이던 상태색(예: paid 가 purple/emerald 혼용)을 한 곳으로 통일한다.
// 라벨은 문맥에 따라 페이지가 덮어쓸 수 있지만 색은 여기 것만 쓴다.

export const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  sent: "발송",
  upgraded: "확정",
  individual: "개별",
  draft: "작성 중",
  processed: "처리 완료",
  invoiced: "인보이스",
  paid: "결제 완료",
  approved: "승인",
  rejected: "거절",
  done: "완료",
};

// 칩 (배경+글자)
export const STATUS_CHIP: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  sent: "bg-blue-50 text-blue-700",
  upgraded: "bg-emerald-50 text-emerald-700",
  individual: "bg-violet-50 text-violet-700",
  draft: "bg-slate-100 text-slate-600",
  processed: "bg-sky-50 text-sky-700",
  invoiced: "bg-indigo-50 text-indigo-700",
  paid: "bg-emerald-50 text-emerald-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-rose-50 text-rose-600",
  done: "bg-sky-50 text-sky-700",
};

// 점 표시
export const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber-400",
  sent: "bg-blue-400",
  upgraded: "bg-emerald-400",
  individual: "bg-violet-400",
  draft: "bg-slate-300",
  processed: "bg-sky-400",
  invoiced: "bg-indigo-400",
  paid: "bg-emerald-400",
  approved: "bg-emerald-400",
  rejected: "bg-rose-400",
  done: "bg-sky-400",
};

// 강조 텍스트
export const STATUS_TEXT: Record<string, string> = {
  pending: "text-amber-600",
  sent: "text-blue-600",
  upgraded: "text-emerald-600",
  individual: "text-violet-600",
  draft: "text-slate-500",
  processed: "text-sky-600",
  invoiced: "text-indigo-600",
  paid: "text-emerald-600",
  approved: "text-emerald-600",
  rejected: "text-rose-600",
  done: "text-sky-600",
};
