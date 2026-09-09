import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export const SCHOOL_SESSION_MAX_AGE=14*24*60*60;
export function signSchoolSession(schoolId:number,now=Date.now()) {
 const secret=process.env.SCHOOL_SESSION_SECRET?.trim();
 if(!secret) throw new Error("SCHOOL_SESSION_SECRET is required");
 const payload=Buffer.from(JSON.stringify({purpose:"school",schoolId,exp:Math.floor(now/1000)+SCHOOL_SESSION_MAX_AGE,nonce:randomBytes(16).toString("hex")})).toString("base64url");
 return `${payload}.${createHmac("sha256",secret).update(payload).digest("hex")}`;
}
export function verifySchoolSession(token:string|undefined|null,now=Date.now()):number|null {
 const secret=process.env.SCHOOL_SESSION_SECRET?.trim();
 if(!secret||!token) return null;
 try {
  const parts=token.split("."); if(parts.length!==2||!/^[a-f0-9]{64}$/.test(parts[1])) return null;
  const expected=createHmac("sha256",secret).update(parts[0]).digest();
  if(!timingSafeEqual(Buffer.from(parts[1],"hex"),expected)) return null;
  const p=JSON.parse(Buffer.from(parts[0],"base64url").toString());
  return p.purpose==="school"&&Number.isSafeInteger(p.schoolId)&&p.schoolId>0&&Number.isSafeInteger(p.exp)&&p.exp>Math.floor(now/1000)&&/^[a-f0-9]{32}$/.test(p.nonce)?p.schoolId:null;
 }catch{return null;}
}
