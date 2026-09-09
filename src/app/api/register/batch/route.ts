export const dynamic='force-dynamic';
export const maxDuration=300;
import {NextRequest,NextResponse} from 'next/server';
import {checkRateLimit,createRateLimitResponse} from '@/lib/security';
import {findRegistrationSchool,normalizedEmail,registerTeacher,sendVerification} from '@/lib/registration';
export async function POST(req:NextRequest) {
 if(process.env.PUBLIC_REGISTRATION_ENABLED==='false') return NextResponse.json({error:'Registration temporarily unavailable'},{status:503});
 const rate=await checkRateLimit({request:req,key:'public-register-batch',limit:4,windowMs:10*60000});
 if(!rate.ok)return createRateLimitResponse(undefined,rate.retryAfter);
 const body=await req.json().catch(()=>null);
 if(!body||!Array.isArray(body.emails)||body.emails.length<1||body.emails.length>50||body.emails.some((v:unknown)=>!normalizedEmail(v)))return NextResponse.json({error:'Provide 1–50 valid emails'},{status:400});
 const school=await findRegistrationSchool(body);if(!school)return NextResponse.json({error:'Invalid school'},{status:400});
 const emails=[...new Set<string>(body.emails.map(normalizedEmail))];
 const results=[];let registered=0,duplicates=body.emails.length-emails.length;
 for(const email of emails){
  const item=await registerTeacher(school.id,email.split('@')[0],email,null);
  if(item.duplicate)duplicates++;else registered++;
  const mail=item.teacher?.verificationStatus==='unverified'?await sendVerification(req,item.teacher):{status:'already_registered'};
  results.push({email,mailStatus:mail.status});
 }
 return NextResponse.json({success:true,schoolName:school.name,registered,duplicates,total:body.emails.length,approved:0,pendingVerification:registered,results});
}
