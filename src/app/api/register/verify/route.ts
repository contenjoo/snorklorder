export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifyTeacherByCode } from "@/lib/verification";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "teacherId and code required" },
      { status: 400 }
    );
  }

  const { teacherId, code } = (body ?? {}) as {
    teacherId?: unknown;
    code?: unknown;
  };

  const idNum = Number(teacherId);
  const validId = Number.isInteger(idNum) && idNum > 0;
  const validCode = typeof code === "string" && code.trim().length > 0;

  if (!validId || !validCode) {
    return NextResponse.json(
      { error: "teacherId and code required" },
      { status: 400 }
    );
  }

  const result = await verifyTeacherByCode(idNum, String(code));

  if (result.ok) {
    return NextResponse.json({ ok: true, status: result.status });
  }

  if (result.error === "used") {
    return NextResponse.json({ error: "Code already used" }, { status: 410 });
  }

  if (result.error === "expired") {
    return NextResponse.json({ error: "Code expired" }, { status: 410 });
  }

  return NextResponse.json({ error: "Invalid code" }, { status: 400 });
}
