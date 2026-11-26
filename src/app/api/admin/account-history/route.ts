import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accountRequests } from "@/db/schema";
import { checkAuth } from "@/lib/auth";
import { withAccountHistory } from "@/lib/account-history-db";

export async function POST(req: Request) {
  if (!(await checkAuth())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const input = await req.json().catch(() => null);
  if (typeof input?.emails !== "string" || input.emails.length > 200_000 ||
      (input.id != null && (!Number.isSafeInteger(input.id) || input.id < 1))) {
    return Response.json({ error: "이메일 목록을 확인해 주세요." }, { status: 400 });
  }
  const [editing] = input.id ? await db.select({ createdAt: accountRequests.createdAt })
    .from(accountRequests).where(eq(accountRequests.id, input.id)) : [];
  if (input.id && !editing) return Response.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
  const [result] = await withAccountHistory([{
    id: input.id ?? Number.MAX_SAFE_INTEGER, emails: input.emails, createdAt: editing?.createdAt,
  }]);
  return Response.json(result.history, { headers: { "Cache-Control": "no-store" } });
}
