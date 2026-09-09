import {NextRequest,NextResponse} from 'next/server';
import {db} from '@/db';
import {sql} from 'drizzle-orm';
import {hashVerificationToken} from '@/lib/registration';
import {checkRateLimit,createRateLimitResponse} from '@/lib/security';
export async function POST(req:NextRequest){
 if(req.headers.get('origin')!==req.nextUrl.origin)return NextResponse.json({error:'Invalid origin'},{status:403});
 const rate=await checkRateLimit({request:req,key:'verify-email',limit:20,windowMs:60000});if(!rate.ok)return createRateLimitResponse(undefined,rate.retryAfter);
 const body=await req.json().catch(()=>null);
 if(typeof body?.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))return NextResponse.json({error:'Invalid link'},{status:400});
 const result=await db.execute(sql`SELECT verify_teacher_email(${hashVerificationToken(body.token)}) AS status`);
 const status=result.rows[0]?.status;
 if(!status)return NextResponse.json({error:'Link expired or already used. Request a new email.'},{status:410});
 return NextResponse.json({success:true,status});
}
