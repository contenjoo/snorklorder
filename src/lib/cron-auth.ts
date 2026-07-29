/**
 * 크론 라우트 공통 인증.
 * 1) Vercel 크론: Authorization: Bearer ${CRON_SECRET} (Vercel이 자동 전송)
 * 2) 수동 트리거: x-api-key 헤더 또는 ?key= (INTEGRATION_API_KEY)
 *
 * NextRequest / 표준 Request 둘 다 받는다 (req.url 로 쿼리 파싱).
 */
export function authorizeCron(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return true;
  }

  const apiKey = process.env.INTEGRATION_API_KEY;
  if (apiKey) {
    let queryKey: string | null = null;
    try {
      queryKey = new URL(req.url).searchParams.get("key");
    } catch {
      queryKey = null;
    }
    const provided = req.headers.get("x-api-key") ?? queryKey;
    if (provided === apiKey) return true;
  }

  return false;
}
