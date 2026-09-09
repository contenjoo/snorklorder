export const dynamic='force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, createRateLimitResponse } from '@/lib/security';
import { findRegistrationSchool, normalizedEmail, registerTeacher, sendVerification } from '@/lib/registration';
export async function POST(req:NextRequest) {
 if(process.env.PUBLIC_REGISTRATION_ENABLED==='false') return NextResponse.json({error:'Registration temporarily unavailable'},{status:503});
 const rate=await checkRateLimit({request:req,key:'public-register',limit:12,windowMs:10*60000});
 if(!rate.ok) return createRateLimitResponse(undefined,rate.retryAfter);
 const body=await req.json().catch(()=>null);
 const email=normalizedEmail(body?.email);
 if(!body||!email||typeof body.name!=='string'||!body.name.trim()||body.name.length>80||
   (body.subject!=null&&typeof body.subject!=='string')) return NextResponse.json({error:'Invalid registration'},{status:400});
 const school=await findRegistrationSchool(body);
 if(!school) return NextResponse.json({error:'Invalid school'},{status:400});
 const result=await registerTeacher(school.id,body.name.trim(),email,body.subject?.trim().slice(0,80)||null);
 const mail=result.teacher?.verificationStatus==='unverified'?await sendVerification(req,result.teacher):{status:'already_registered'};
 return NextResponse.json({success:true,status:'unverified',schoolName:school.name,duplicate:result.duplicate,mailStatus:mail.status});
}
