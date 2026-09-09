import {NextRequest,NextResponse} from 'next/server';
import {createHash} from 'node:crypto';
import {consumeSchoolLoginToken,setSchoolSession} from '@/lib/school-auth';
export async function GET(req:NextRequest,{params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 return NextResponse.redirect(new URL(`/school/login/confirm/${encodeURIComponent(token)}`,req.url));
}
export async function POST(req:NextRequest,{params}:{params:Promise<{token:string}>}){
 const intent=req.cookies.get('snorkl-login-intent')?.value;
 if(req.headers.get('origin')!==req.nextUrl.origin||!intent||!/^[a-f0-9]{64}$/.test(intent))return NextResponse.json({error:'로그인을 요청한 브라우저에서 다시 시도해 주세요.'},{status:403});
 const {token}=await params;
 const result=await consumeSchoolLoginToken(token,createHash('sha256').update(intent).digest('hex'));
 if(!result)return NextResponse.json({error:'링크가 만료되었거나 사용할 수 없습니다.'},{status:410});
 await setSchoolSession(result.schoolId);
 const response=NextResponse.json({success:true});response.cookies.delete('snorkl-login-intent');return response;
}
