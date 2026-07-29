/**
 * Gmail OAuth2 Refresh Token 발급 스크립트
 *
 * (snorkl-manager/scripts/get-gmail-token.mjs 에서 복사됨 — 폐기 예정 구 앱에만 있던
 * Gmail OAuth refresh token 재발급 유일 도구라 snorkl-teacher-reg로 이식.
 * 원본은 snorkl-manager에도 남아 있음.)
 *
 * 발급 대상 env: GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
 * (Gmail readonly + send 스코프). src/lib/stripe-email.ts 의 sync-stripe 기능이
 * 이 refresh token으로 Gmail API에 접근해 Stripe 인보이스/영수증 이메일을 읽는다.
 * 현재 .env.local / .env.production.local / .env.vercel 어디에도 이 세 값이
 * 없는 상태 (GMAIL_USER/GMAIL_APP_PASSWORD는 별개의 SMTP 발신용 값).
 *
 * 사용법:
 * 1. Google Cloud Console에서 OAuth2 Client ID 생성
 * 2. 아래 CLIENT_ID, CLIENT_SECRET 입력
 * 3. node scripts/get-gmail-token.mjs 실행
 * 4. 브라우저에서 로그인 → 코드 복사 → 터미널에 붙여넣기
 * 5. 출력된 refresh_token을 .env에 저장
 */

import http from "http";
import { URL } from "url";

// ⬇️ Google Cloud Console에서 복사한 값을 여기에 입력
const CLIENT_ID = process.env.GMAIL_CLIENT_ID || "YOUR_CLIENT_ID";
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "YOUR_CLIENT_SECRET";
const REDIRECT_URI = "http://localhost:3333/callback";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";

if (CLIENT_ID === "YOUR_CLIENT_ID") {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Gmail OAuth2 설정 가이드                                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. https://console.cloud.google.com 접속                    ║
║                                                              ║
║  2. 프로젝트 생성 또는 기존 프로젝트 선택                     ║
║                                                              ║
║  3. Gmail API 활성화:                                        ║
║     → "API 및 서비스" → "라이브러리"                          ║
║     → "Gmail API" 검색 → "사용" 클릭                         ║
║                                                              ║
║  4. OAuth 동의 화면 설정:                                     ║
║     → "API 및 서비스" → "OAuth 동의 화면"                     ║
║     → "외부" 선택 → 앱 이름 입력 → 저장                      ║
║     → "테스트 사용자"에 본인 Gmail 추가                       ║
║                                                              ║
║  5. OAuth2 클라이언트 ID 생성:                                ║
║     → "API 및 서비스" → "사용자 인증 정보"                    ║
║     → "+ 사용자 인증 정보 만들기" → "OAuth 클라이언트 ID"     ║
║     → 유형: "웹 애플리케이션"                                 ║
║     → 승인된 리디렉션 URI: http://localhost:3333/callback     ║
║     → "만들기" 클릭                                           ║
║                                                              ║
║  6. Client ID와 Client Secret을 복사                          ║
║                                                              ║
║  7. 다시 실행:                                                ║
║     GMAIL_CLIENT_ID=xxx GMAIL_CLIENT_SECRET=yyy \\            ║
║       node scripts/get-gmail-token.mjs                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
  process.exit(0);
}

// Build auth URL
const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("\n🔗 아래 URL을 브라우저에서 열어주세요:\n");
console.log(authUrl.toString());
console.log("\n⏳ 로그인 후 리디렉션을 기다리는 중...\n");

// Start local server to catch the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:3333`);

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");

    if (!code) {
      res.writeHead(400);
      res.end("Error: No code received");
      return;
    }

    // Exchange code for tokens
    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });

      const tokens = await tokenRes.json();

      if (tokens.error) {
        console.error("❌ 토큰 교환 실패:", tokens.error_description || tokens.error);
        res.writeHead(400);
        res.end("Token exchange failed: " + (tokens.error_description || tokens.error));
        server.close();
        process.exit(1);
      }

      console.log("\n✅ 성공! .env에 아래 값을 추가하세요:\n");
      console.log("──────────────────────────────────────");
      console.log(`GMAIL_CLIENT_ID=${CLIENT_ID}`);
      console.log(`GMAIL_CLIENT_SECRET=${CLIENT_SECRET}`);
      console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log("──────────────────────────────────────\n");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px">
          <h1>✅ 인증 완료!</h1>
          <p>터미널에서 토큰을 확인하세요. 이 탭을 닫아도 됩니다.</p>
        </body></html>
      `);

      server.close();
      setTimeout(() => process.exit(0), 1000);
    } catch (err) {
      console.error("❌ 에러:", err.message);
      res.writeHead(500);
      res.end("Error: " + err.message);
      server.close();
      process.exit(1);
    }
  }
});

server.listen(3333, () => {
  console.log("📡 localhost:3333에서 콜백 대기 중...");
});
