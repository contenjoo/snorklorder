import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { checkAuth } from '@/lib/auth';
import { reviewProcessingMail } from '@/lib/processing-mail-sync';
export const dynamic = 'force-dynamic';
const VIEWS = ['review','resolved','unlinked'] as const;
type View = (typeof VIEWS)[number];
// review=사람 판단이 필요한 건, resolved=자동·수동으로 끝난 건, unlinked=보낸 요청 메일과 연결되지 않아 반영하지 않은 메일
function viewCondition(view: View) {
  if (view === 'review') return sql`d.outcome='review'`;
  if (view === 'resolved') return sql`d.outcome IN ('applied','already_confirmed','excluded')`;
  return sql`d.message_id IS NULL`;
}
export async function GET(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({error:'Unauthorized'},{status:401});
  const page = Number(req.nextUrl.searchParams.get('page') || 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) return NextResponse.json({error:'Invalid page'},{status:400});
  const rawView = req.nextUrl.searchParams.get('view') || 'review';
  if (!(VIEWS as readonly string[]).includes(rawView)) return NextResponse.json({error:'Invalid view'},{status:400});
  const view = rawView as View;
  const [result, counts] = await Promise.all([
    db.execute(sql`SELECT e.message_id,e.parent_id,e.sender,e.received_at,e.excerpt,e.reason AS evidence_reason,e.authenticated,e.source_verified,e.incomplete,
    d.request_id,d.outcome,d.reason,a.school_name
    FROM processing_mail_evidence e LEFT JOIN processing_mail_decisions d ON d.message_id=e.message_id
    LEFT JOIN account_requests a ON a.id=d.request_id
    WHERE ${viewCondition(view)}
    ORDER BY e.received_at DESC,e.message_id,d.request_id LIMIT 51 OFFSET ${page*50}`),
    db.execute(sql`SELECT
      count(*) FILTER (WHERE d.outcome='review')::int AS review,
      count(*) FILTER (WHERE d.outcome IN ('applied','already_confirmed','excluded'))::int AS resolved,
      count(*) FILTER (WHERE d.message_id IS NULL)::int AS unlinked
      FROM processing_mail_evidence e LEFT JOIN processing_mail_decisions d ON d.message_id=e.message_id`),
  ]);
  return NextResponse.json({items:result.rows.slice(0,50),hasMore:result.rows.length>50,counts:counts.rows[0]},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({error:'Unauthorized'},{status:401});
  if (req.headers.get('origin') !== req.nextUrl.origin) return NextResponse.json({error:'Invalid origin'},{status:403});
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.messageId !== 'string' || body.messageId.length>500
    || !Number.isSafeInteger(body.requestId) || body.requestId<=0 || !['confirm','exclude'].includes(body.action)
    || typeof body.note !== 'string' || body.note.trim().length<3 || body.note.length>1000) return NextResponse.json({error:'검토 대상과 근거를 입력해 주세요.'},{status:400});
  try {return NextResponse.json(await reviewProcessingMail(body.messageId,body.requestId,body.action,body.note.trim()));}
  catch (error) {console.error('[processing-mail-review]',error);return NextResponse.json({error:'반영할 수 없는 상태입니다. 목록을 새로고침하고 근거·요청 상태를 확인해 주세요.'},{status:409});}
}
