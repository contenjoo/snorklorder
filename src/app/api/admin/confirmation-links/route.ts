import {NextRequest,NextResponse} from 'next/server';
import {randomBytes} from 'node:crypto';
import {checkAuth} from '@/lib/auth';
import {db} from '@/db';
import {sql} from 'drizzle-orm';
const tables={batch:{table:'upgrade_batches',token:'token',path:'confirm'},account:{table:'account_requests',token:'confirm_token',path:'account-confirm'},domain:{table:'domain_requests',token:'confirm_token',path:'domain-confirm'}} as const;
export async function GET(){
 if(!await checkAuth())return NextResponse.json({error:'Unauthorized'},{status:401});
 const result=await db.execute(sql`SELECT 'batch' AS kind,id,'Teacher batch' AS label,token_expires_at FROM upgrade_batches UNION ALL SELECT 'account',id,school_name,token_expires_at FROM account_requests WHERE confirm_token IS NOT NULL UNION ALL SELECT 'domain',id,school_name,token_expires_at FROM domain_requests ORDER BY token_expires_at ASC LIMIT 200`);
 return NextResponse.json(result.rows);
}
export async function POST(req:NextRequest){
 if(!await checkAuth())return NextResponse.json({error:'Unauthorized'},{status:401});
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403});
 const b=await req.json().catch(()=>null);
 if(!b||!Object.hasOwn(tables,b.kind)||!Number.isSafeInteger(b.id)||b.id<=0)return NextResponse.json({error:'Invalid request'},{status:400});
 const t=tables[b.kind as keyof typeof tables];const token=randomBytes(32).toString('hex');
 const result=await db.execute(sql`UPDATE ${sql.identifier(t.table)} SET ${sql.identifier(t.token)}=${token},token_expires_at=(now() AT TIME ZONE 'UTC')+interval '30 days' WHERE id=${b.id} RETURNING id,token_expires_at`);
 if(!result.rows.length)return NextResponse.json({error:'Not found'},{status:404});
 return NextResponse.json({url:`${req.nextUrl.origin}/${t.path}/${token}`,expiresAt:result.rows[0].token_expires_at});
}
