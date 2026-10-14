import { randomBytes, createHash } from "node:crypto";
import { db } from "@/db";
import { teachers, schools, emailVerificationTokens } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { checkEmailSendLimit, isValidEmail } from "@/lib/security";
import { getTransporter, BASE_URL, escapeHtml, logEmail } from "@/lib/email";

export function hashVerificationToken(token:string) { return `sha256:${createHash("sha256").update(token).digest("hex")}`; }
export async function findRegistrationSchool(body:Record<string,unknown>) {
 if(Number.isSafeInteger(body.schoolId)&&Number(body.schoolId)>0) {
  const [school]=await db.select().from(schools).where(eq(schools.id,Number(body.schoolId))); return school;
 }
 if(typeof body.schoolCode==='string'&&body.schoolCode.trim()) {
  const [school]=await db.select().from(schools).where(eq(schools.code,body.schoolCode.trim().toUpperCase())); return school;
 }
 return null;
}
// 취소 학교는 화면(검색·코드·/j 링크)뿐 아니라 서버에서도 신규 등록을 받지 않는다.
export const CANCELLED_SCHOOL_ERROR='취소된 학교입니다. 학교 단체구매 신청이 종료되었어요.';
export function isCancelledSchool(school:{team:string|null}) { return school.team==='취소'; }
export async function sendVerification(request:Request, teacher:{id:number;email:string}) {
 const limited=await checkEmailSendLimit(request,teacher.email);
 if(limited) return {status:limited.status===503?'unavailable':'limited'};
 const token=randomBytes(32).toString('hex');
 await db.insert(emailVerificationTokens).values({teacherId:teacher.id,code:'disabled',token:hashVerificationToken(token),expiresAt:new Date(Date.now()+30*60*1000)});
 const subject='Snorkl 이메일 확인';
 try {
  const transporter=getTransporter(); if(!transporter) throw new Error('Mail transport unavailable');
  await transporter.sendMail({from:process.env.GMAIL_USER,to:teacher.email,subject,html:`<p>Snorkl 등록을 완료하려면 이메일을 확인해 주세요.</p><p><a href="${escapeHtml(BASE_URL)}/register/verify/${token}">이메일 확인</a></p><p>30분 안에 확인해 주세요. 신청한 적이 없다면 이 메일을 무시해 주세요.</p>`});
  await logEmail({to:teacher.email,subject,kind:'teacher_verification',status:'success'});
  return {status:'sent'};
 } catch(error) {
  console.error('[verification-mail] failed',error);
  await logEmail({to:teacher.email,subject,kind:'teacher_verification',status:'failed'});
  return {status:'failed'};
 }
}
export async function registerTeacher(schoolId:number,name:string,email:string,subject:string|null) {
 const [existing]=await db.select({id:teachers.id,email:teachers.email,verificationStatus:teachers.verificationStatus}).from(teachers).where(and(eq(teachers.schoolId,schoolId),eq(teachers.email,email)));
 if(existing) return {teacher:existing,duplicate:true};
 const [teacher]=await db.insert(teachers).values({schoolId,name,email,subject,status:'pending',verificationStatus:'unverified',emailVerifiedAt:null}).onConflictDoNothing().returning({id:teachers.id,email:teachers.email,verificationStatus:teachers.verificationStatus});
 return {teacher,duplicate:!teacher};
}
export function normalizedEmail(value:unknown) {return typeof value==='string'&&value.trim().length<=254&&isValidEmail(value.trim())?value.trim().toLowerCase():null;}
