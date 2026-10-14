// 학교별 교사 등록 링크. 클라이언트(관리자·학교 화면)에서도 import 하므로 email.ts(nodemailer)에 의존하지 않는다.
const BASE = process.env.NEXT_PUBLIC_BASE_URL || "https://snorkl-teacher-reg.vercel.app";

export function schoolJoinUrl(code: string) {
  return `${BASE}/j/${encodeURIComponent(code)}`;
}
