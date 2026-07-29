// 화면 표시용 포맷 헬퍼의 단일 출처(SSOT).
// admin / partner / confirm 페이지에 흩어져 있던 복붙 구현을 여기로 모았다.

/** 과목 한글명 → 영문 표기. 파트너·본사가 보는 화면에서 사용. */
export const SUBJECT_EN: Record<string, string> = {
  "수학": "Math", "국어": "Korean", "영어": "English", "과학": "Science",
  "역사": "History", "사회": "Social Studies", "미술": "Art", "음악": "Music",
  "체육": "PE", "기술": "Technology", "생명과학": "Biology", "제2외국어": "2nd Language",
  "담임": "Homeroom", "상담": "Counseling", "사서": "Librarian", "환경": "Environment",
  "물리": "Physics", "화학": "Chemistry", "지리": "Geography", "도덕": "Ethics",
  "정보": "IT", "가정": "Home Ec", "일본어": "Japanese", "중국어": "Chinese",
};

/** ISO 문자열로부터 경과 일수. 값이 없거나 파싱 실패면 null. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

export interface DDay {
  label: string;
  cls: string;
  diff: number;
}

/**
 * 결제 기한 D-day 뱃지.
 * - account 요청은 'YYYY-MM-DD' date, domain 요청은 자유 텍스트일 수 있어 파싱을 이원화한다.
 * - paymentDate가 있으면(=이미 결제됨) 뱃지를 띄우지 않는다.
 */
export function dDayInfo(
  dueDate: string | null | undefined,
  paymentDate?: string | null,
): DDay | null {
  if (!dueDate || paymentDate) return null;
  const due = /^\d{4}-\d{2}-\d{2}/.test(dueDate)
    ? new Date(`${dueDate.slice(0, 10)}T00:00:00`)
    : new Date(dueDate);
  if (isNaN(due.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { label: `D+${-diff}`, cls: "bg-red-100 text-red-700", diff }; // 기한 초과
  if (diff <= 3) return { label: `D-${diff}`, cls: "bg-orange-100 text-orange-700", diff }; // 임박
  return { label: `D-${diff}`, cls: "bg-gray-100 text-gray-500", diff };
}

/** 복사 완료 토스트가 떠 있는 시간(ms). */
export const COPIED_TOAST_MS = 2000;

/** 이메일 목록을 줄바꿈으로 클립보드에 복사하고, label 토스트를 잠시 띄운다. */
export function copyEmails(
  emails: string[],
  label: string,
  setCopied: (value: string) => void,
): void {
  navigator.clipboard.writeText(emails.join("\n"));
  setCopied(label);
  setTimeout(() => setCopied(""), COPIED_TOAST_MS);
}
