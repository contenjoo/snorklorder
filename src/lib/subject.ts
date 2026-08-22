// 교사 담당 과목 문자열을 과목군으로 정규화한다.
// 자유 입력이라 "3학년 4반", "국어, 수학, 사회" 같은 값이 섞여 있어 규칙 순서가 중요하다:
// 담임/전과목 → 복수과목 → 개별 교과 순으로 판정.
export function subjectFamily(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/담임|전과목|전교과|^초등$|학년|반$/.test(s)) return "초등담임/전과목";
  if (/,/.test(s)) return "복수과목";
  if (/수학/.test(s)) return "수학";
  if (/영어/.test(s)) return "영어";
  if (/국어|문학|독서|한문/.test(s)) return "국어";
  if (/과학|생명|화학|물리|지구/.test(s)) return "과학";
  if (/사회|지리|역사|한국사|경제|정치|윤리|도덕/.test(s)) return "사회·역사·도덕";
  if (/정보|컴퓨터|코딩|소프트/.test(s)) return "정보";
  if (/체육|음악|미술|영화|무용/.test(s)) return "예체능";
  if (/중국어|일본어|스페인|독일|프랑스|제2외국어/.test(s)) return "제2외국어";
  if (/기술|가정|실과/.test(s)) return "기술가정";
  if (/특수/.test(s)) return "특수교육";
  if (/진로|상담|사서|보건|영양|환경|사감/.test(s)) return "비교과";
  return "기타";
}
