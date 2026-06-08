import { getTransporter, logEmail, BASE_URL, type EmailResult } from "@/lib/email";

function esc(v: string | null | undefined): string {
  return (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 교사 등록 시 이메일 소유 증명 (OTP 6자리 + 매직링크) */
export async function sendTeacherVerificationEmail(p: {
  teacherId: number;
  email: string;
  name: string;
  schoolName: string;
  schoolNameEn?: string | null;
  code: string;
  token: string;
}): Promise<EmailResult> {
  const t = getTransporter();
  const subject = "Verify your Snorkl registration / 스노클 등록 인증";
  if (!t) {
    await logEmail({ to: p.email, subject, kind: "email_verify", status: "skipped", relatedType: "teacher", relatedId: p.teacherId });
    return { success: false, skipped: true };
  }
  const link = `${BASE_URL}/api/register/verify/${p.token}`;
  const school = p.schoolNameEn ? `${esc(p.schoolNameEn)} (${esc(p.schoolName)})` : esc(p.schoolName);
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>Confirm your email</h2>
      <p>Hi ${esc(p.name)}, you're registering for <b>${school}</b>.</p>
      <p>Your verification code:</p>
      <div style="font-size:28px;font-weight:700;letter-spacing:6px;padding:12px 0">${esc(p.code)}</div>
      <p>Or click to verify:</p>
      <p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Verify email</a></p>
      <p style="color:#888;font-size:12px">This link expires in 7 days. If you didn't request this, ignore this email.</p>
    </div>`;
  try {
    await t.sendMail({ from: process.env.GMAIL_USER, to: p.email, subject, html });
    await logEmail({ to: p.email, subject, kind: "email_verify", status: "success", relatedType: "teacher", relatedId: p.teacherId });
    return { success: true };
  } catch (err) {
    await logEmail({ to: p.email, subject, kind: "email_verify", status: "failed", error: String(err), relatedType: "teacher", relatedId: p.teacherId });
    return { success: false, error: String(err) };
  }
}

/** 학교 관리자 매직링크 로그인 (한 이메일이 여러 학교 관리자일 수 있어 링크 목록 지원) */
export async function sendSchoolLoginEmail(p: {
  email: string;
  links: { schoolName: string; schoolNameEn?: string | null; token: string }[];
}): Promise<EmailResult> {
  const t = getTransporter();
  const subject = "Your Snorkl school admin login link / 학교 관리자 로그인";
  if (!t) {
    await logEmail({ to: p.email, subject, kind: "school_login", status: "skipped" });
    return { success: false, skipped: true };
  }
  const rows = p.links
    .map((l) => {
      const name = l.schoolNameEn ? `${esc(l.schoolNameEn)} (${esc(l.schoolName)})` : esc(l.schoolName);
      const url = `${BASE_URL}/api/school/login/verify/${l.token}`;
      return `<p><b>${name}</b><br/><a href="${url}" style="color:#2563eb">Log in →</a></p>`;
    })
    .join("");
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2>School admin login</h2>
      <p>Click the link for the school you manage:</p>
      ${rows}
      <p style="color:#888;font-size:12px">These links expire in 30 minutes and can be used once.</p>
    </div>`;
  try {
    await t.sendMail({ from: process.env.GMAIL_USER, to: p.email, subject, html });
    await logEmail({ to: p.email, subject, kind: "school_login", status: "success" });
    return { success: true };
  } catch (err) {
    await logEmail({ to: p.email, subject, kind: "school_login", status: "failed", error: String(err) });
    return { success: false, error: String(err) };
  }
}

/** 승인 대기 리마인더 (학교 관리자 또는 본사) */
export async function sendVerificationReminderEmail(p: {
  to: string;
  audience: "school_admin" | "hq";
  schoolName: string;
  schoolNameEn?: string | null;
  pending: { name: string; email: string }[];
  dashboardPath: string;
}): Promise<EmailResult> {
  const t = getTransporter();
  const school = p.schoolNameEn ? `${p.schoolNameEn} (${p.schoolName})` : p.schoolName;
  const subject =
    p.audience === "hq"
      ? `[HQ] ${p.pending.length} registration(s) awaiting review — ${school}`
      : `${p.pending.length} teacher(s) awaiting your approval — ${school}`;
  if (!t) {
    await logEmail({ to: p.to, subject, kind: "verification_reminder", status: "skipped" });
    return { success: false, skipped: true };
  }
  const list = p.pending.map((x) => `<li>${esc(x.email)}${x.name ? ` — ${esc(x.name)}` : ""}</li>`).join("");
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2>Pending registrations</h2>
      <p><b>${esc(school)}</b> has <b>${p.pending.length}</b> registration(s) awaiting review.</p>
      <ul>${list}</ul>
      <p><a href="${BASE_URL}${p.dashboardPath}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Review now</a></p>
    </div>`;
  try {
    await t.sendMail({ from: process.env.GMAIL_USER, to: p.to, subject, html });
    await logEmail({ to: p.to, subject, kind: "verification_reminder", status: "success" });
    return { success: true };
  } catch (err) {
    await logEmail({ to: p.to, subject, kind: "verification_reminder", status: "failed", error: String(err) });
    return { success: false, error: String(err) };
  }
}
