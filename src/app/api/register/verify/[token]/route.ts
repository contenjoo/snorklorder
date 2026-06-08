export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { verifyTeacherByToken } from "@/lib/verification";

function page(opts: {
  title: string;
  ko: string;
  en: string;
  status: number;
}) {
  const { title, ko, en, status } = opts;
  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;font-family:sans-serif;background:#f5f5f5;">
    <div style="max-width:480px;margin:80px auto;padding:32px 24px;background:#ffffff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08);text-align:center;">
      <h1 style="font-size:20px;line-height:1.4;margin:0 0 16px;color:#111827;">${title}</h1>
      <p style="font-size:16px;line-height:1.6;margin:0 0 8px;color:#1f2937;">${ko}</p>
      <p style="font-size:14px;line-height:1.6;margin:0;color:#6b7280;">${en}</p>
    </div>
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const result = await verifyTeacherByToken(token);

  if (result.ok) {
    if (result.status === "approved") {
      return page({
        title: "이메일 인증 완료 / Email verified",
        ko: "이메일 인증 완료 — 등록이 승인되었습니다",
        en: "Your email is verified and your registration is approved.",
        status: 200,
      });
    }
    // email_verified (or any other ok status)
    return page({
      title: "이메일 인증 완료 / Email verified",
      ko: "이메일 인증 완료 — 학교 관리자 승인 대기 중입니다",
      en: "Email verified. Awaiting school admin approval.",
      status: 200,
    });
  }

  if (result.error === "expired") {
    return page({
      title: "링크 만료 / Link expired",
      ko: "링크가 만료되었습니다",
      en: "This link has expired.",
      status: 410,
    });
  }

  if (result.error === "used") {
    return page({
      title: "사용된 링크 / Link used",
      ko: "이미 사용된 링크입니다",
      en: "This link was already used.",
      status: 410,
    });
  }

  return page({
    title: "유효하지 않은 링크 / Invalid link",
    ko: "유효하지 않은 링크입니다",
    en: "Invalid link.",
    status: 404,
  });
}
