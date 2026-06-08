export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { consumeSchoolLoginToken, setSchoolSession } from "@/lib/school-auth";

// GET: 매직 링크 소비 후 세션 설정
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const result = await consumeSchoolLoginToken(token);

  if (!result) {
    return NextResponse.redirect(new URL("/school/login?error=invalid", req.url));
  }

  await setSchoolSession(result.schoolId);
  return NextResponse.redirect(new URL("/school", req.url));
}
