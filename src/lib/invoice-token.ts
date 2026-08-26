// 인보이스 확인 페이지(/invoice)의 고정 토큰 검증. 순수 함수만 둔다 (db·nodemailer import 금지).
//
// 세션 대신 고정 토큰을 쓰는 이유: 링크가 늘 같아야 Cailie 가 한 번 북마크해두고 메일 없이도
// 현황을 볼 수 있다. 담기는 정보는 학교명·청구 요약·인보이스 번호뿐이고 교사 이메일은 없다.
// 유출 시 대응은 환경변수 교체.

export type InvoiceTokenCheck = "ok" | "not_configured" | "invalid";

/** 길이가 달라도 같은 만큼 순회해서 비교 시간으로 토큰을 추측당하지 않게 한다. */
export function constantTimeEquals(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * 토큰 미설정을 "통과"로 바꾸지 않는다. 설정을 빠뜨렸을 때 열리는 게 아니라 닫혀야 한다.
 * 호출부는 not_configured 를 503, invalid 를 401 로 구분해 응답한다.
 */
export function checkInvoiceViewToken(
  candidate: string | null | undefined,
  expectedRaw: string | undefined = process.env.INVOICE_VIEW_TOKEN,
): InvoiceTokenCheck {
  const expected = expectedRaw?.trim();
  if (!expected) return "not_configured";
  if (typeof candidate !== "string" || candidate.length === 0) return "invalid";
  return constantTimeEquals(candidate, expected) ? "ok" : "invalid";
}
