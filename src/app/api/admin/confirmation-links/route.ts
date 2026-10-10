import {NextRequest,NextResponse} from 'next/server';
import {randomBytes} from 'node:crypto';
import {checkAuth} from '@/lib/auth';
import {db} from '@/db';
import {sql} from 'drizzle-orm';
const tables={batch:{table:'upgrade_batches',token:'token',path:'confirm'},account:{table:'account_requests',token:'confirm_token',path:'account-confirm'},domain:{table:'domain_requests',token:'confirm_token',path:'domain-confirm'}} as const;
// token_expires_at 은 UTC naive timestamp 다. 상태 판정과 ISO 변환을 DB 에서 끝내 브라우저 시간대 해석을 피한다.
// 정렬: 만료됐는데 미완료(재발급 필요) → 유효·미완료 → 완료. 완료 건은 최근 것만 일부.
export async function GET(){
 if(!await checkAuth())return NextResponse.json({error:'Unauthorized'},{status:401});
 const result=await db.execute(sql`WITH links AS (
   SELECT 'batch' AS kind,b.id,
     coalesce((SELECT string_agg(DISTINCT s.name,', ') FROM teachers t JOIN schools s ON s.id=t.school_id
       WHERE t.id IN (SELECT value::int FROM jsonb_array_elements_text(b.teacher_ids::jsonb))),'교사 묶음') AS label,
     jsonb_array_length(b.teacher_ids::jsonb) AS size,
     b.token_expires_at,(b.status='confirmed' OR b.confirmed_at IS NOT NULL
       -- 같은 교사가 나중 묶음으로 다시 나가 이미 업그레이드됐다면 이 링크로 할 일은 없다.
       OR NOT EXISTS (SELECT 1 FROM teachers t WHERE t.id IN (SELECT value::int FROM jsonb_array_elements_text(b.teacher_ids::jsonb)) AND t.status<>'upgraded')) AS done
   FROM upgrade_batches b
   UNION ALL SELECT 'account',id,school_name,quantity,token_expires_at,(confirmed_at IS NOT NULL OR status NOT IN ('draft','sent'))
   FROM account_requests WHERE confirm_token IS NOT NULL
   UNION ALL SELECT 'domain',id,school_name,1,token_expires_at,(confirmed_at IS NOT NULL OR status<>'pending')
   FROM domain_requests
 ), classified AS (
   SELECT *,CASE WHEN done THEN 'done' WHEN token_expires_at <= (now() AT TIME ZONE 'UTC') THEN 'expired' ELSE 'live' END AS state
   FROM links
 ), ranked AS (
   SELECT *,row_number() OVER (PARTITION BY state ORDER BY token_expires_at DESC) AS rn FROM classified
 )
 SELECT kind,id,label,size,state,to_char(token_expires_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at
 FROM ranked WHERE state<>'done' OR rn<=50
 ORDER BY CASE state WHEN 'expired' THEN 0 WHEN 'live' THEN 1 ELSE 2 END,
   CASE WHEN state='live' THEN token_expires_at END ASC,token_expires_at DESC`);
 return NextResponse.json(result.rows);
}
export async function POST(req:NextRequest){
 if(!await checkAuth())return NextResponse.json({error:'Unauthorized'},{status:401});
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403});
 const b=await req.json().catch(()=>null);
 if(!b||!Object.hasOwn(tables,b.kind)||!Number.isSafeInteger(b.id)||b.id<=0)return NextResponse.json({error:'Invalid request'},{status:400});
 const t=tables[b.kind as keyof typeof tables];const token=randomBytes(32).toString('hex');
 const result=await db.execute(sql`UPDATE ${sql.identifier(t.table)} SET ${sql.identifier(t.token)}=${token},token_expires_at=(now() AT TIME ZONE 'UTC')+interval '30 days' WHERE id=${b.id} RETURNING id`);
 if(!result.rows.length)return NextResponse.json({error:'Not found'},{status:404});
 return NextResponse.json({url:`${req.nextUrl.origin}/${t.path}/${token}`});
}
