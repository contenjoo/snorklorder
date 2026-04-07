import nodemailer from "nodemailer";

const JON_EMAIL = "jon@snorkl.app";
const DIGEST_RECIPIENTS = ["jon@snorkl.app", "jeff@snorkl.app"];
const ADMIN_EMAIL = process.env.GMAIL_USER || "";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://snorkl-teacher-reg.vercel.app";

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

interface TeacherInfo {
  name: string;
  email: string;
  subject: string | null;
}

// 교사 등록 시 Jon에게 즉시 알림
export async function sendTeacherNotification(schoolName: string, teacher: TeacherInfo) {
  const t = getTransporter();
  if (!t) return;
  await t.sendMail({
    from: ADMIN_EMAIL,
    to: JON_EMAIL,
    subject: `[Snorkl] New Teacher - ${schoolName}`,
    html: `
      <h3>New Teacher Registration</h3>
      <p><b>School:</b> ${schoolName}</p>
      <p><b>Name:</b> ${teacher.name} | <b>Email:</b> ${teacher.email} | <b>Subject:</b> ${teacher.subject || "N/A"}</p>
      <p style="color:#666;font-size:12px">Please upgrade this teacher in Snorkl.</p>
    `,
  });
}

// 선택 교사 일괄 발송 (Jon에게만 + 확인 링크 포함)
export async function sendBatchNotification(
  groups: { schoolName: string; teachers: (TeacherInfo & { id?: number })[] }[],
  confirmToken?: string
) {
  const t = getTransporter();
  if (!t) return { success: false, error: "Gmail not configured" };
  const total = groups.reduce((s, g) => s + g.teachers.length, 0);
  const body = groups.map((g) => {
    const lines = g.teachers.map((tc, i) =>
      `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;color:#666">${i + 1}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;font-weight:500">${tc.email}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;color:#666">${tc.subject || ""}</td>
      </tr>`
    ).join("");
    return `
      <div style="margin-bottom:24px">
        <h3 style="color:#1e3a5f;margin:0 0 8px;font-size:16px">🏫 ${g.schoolName} <span style="color:#999;font-weight:normal">(${g.teachers.length})</span></h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead><tr style="background:#f8f9fa">
            <th style="padding:6px 12px;text-align:left;font-size:12px;color:#999">#</th>
            <th style="padding:6px 12px;text-align:left;font-size:12px;color:#999">Email</th>
            <th style="padding:6px 12px;text-align:left;font-size:12px;color:#999">Subject</th>
          </tr></thead>
          <tbody>${lines}</tbody>
        </table>
      </div>`;
  }).join("");

  const confirmSection = confirmToken
    ? `
      <div style="text-align:center;margin:32px 0;padding:24px;background:#f0f7ff;border-radius:12px">
        <p style="margin:0 0 12px;color:#1e3a5f;font-size:15px">After upgrading, please confirm:</p>
        <a href="${BASE_URL}/confirm/${confirmToken}"
           style="display:inline-block;background:#2563eb;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">
          ✅ Confirm Upgrades
        </a>
        <p style="margin:12px 0 0;color:#999;font-size:12px">Or copy this link: ${BASE_URL}/confirm/${confirmToken}</p>
      </div>`
    : "";

  await t.sendMail({
    from: ADMIN_EMAIL,
    to: JON_EMAIL,
    subject: `[Snorkl] Upgrade Request - ${total} teacher${total !== 1 ? "s" : ""}, ${groups.length} school(s)`,
    html: `
      <div style="max-width:600px;margin:0 auto;font-family:-apple-system,sans-serif">
        <div style="background:#1e3a5f;color:white;padding:20px 24px;border-radius:12px 12px 0 0">
          <h2 style="margin:0;font-size:20px">🐳 Teacher Upgrade Request</h2>
          <p style="margin:4px 0 0;opacity:0.8;font-size:14px">Total: ${total} teacher${total !== 1 ? "s" : ""} from ${groups.length} school(s)</p>
        </div>
        <div style="background:white;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          ${body}
          ${confirmSection}
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:11px;text-align:center">Sent from Snorkl 주문관리 · LearnToday</p>
        </div>
      </div>
    `,
  });
  return { success: true };
}

// 학교 등록 요청 시 관리자에게 알림
export async function sendAdminNotification(request: { name: string; contactName: string; contactEmail: string; region: string | null }) {
  const t = getTransporter();
  if (!t) return;
  await t.sendMail({
    from: ADMIN_EMAIL,
    to: ADMIN_EMAIL,
    subject: `[Snorkl] 새 학교 등록 요청 - ${request.name}`,
    html: `
      <h3>학교 등록 요청</h3>
      <p><b>학교명:</b> ${request.name}</p>
      <p><b>지역:</b> ${request.region || "미입력"}</p>
      <p><b>담당자:</b> ${request.contactName} (${request.contactEmail})</p>
      <p><a href="https://snorkl-teacher-reg.vercel.app/admin/requests">승인하러 가기 →</a></p>
    `,
  });
}

// 승인 후 담당자에게 학교 코드 이메일 발송
export async function sendSchoolCodeEmail(email: string, name: string, schoolName: string, code: string) {
  const t = getTransporter();
  if (!t) return;
  await t.sendMail({
    from: ADMIN_EMAIL,
    to: email,
    subject: `[Snorkl] ${schoolName} 학교 코드가 발급되었습니다`,
    html: `
      <div style="max-width:480px;margin:0 auto;font-family:sans-serif">
        <h2 style="color:#1e3a5f">${schoolName}</h2>
        <p>${name} 선생님, 학교 등록이 승인되었습니다!</p>
        <div style="background:#f0f7ff;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
          <p style="color:#666;margin:0 0 8px">학교 코드</p>
          <p style="font-size:32px;font-weight:bold;color:#1e3a5f;letter-spacing:4px;margin:0">${code}</p>
        </div>
        <p>아래 링크를 동료 선생님들에게 공유해주세요:</p>
        <p><a href="https://snorkl-teacher-reg.vercel.app" style="color:#2563eb">https://snorkl-teacher-reg.vercel.app</a></p>
        <p style="color:#666;font-size:13px">선생님들이 위 링크에서 학교 코드를 입력하고 Snorkl 프리미엄 등록을 하시면 됩니다.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
        <p style="color:#999;font-size:11px">이 메일은 Snorkl 주문관리 시스템에서 자동 발송되었습니다.</p>
      </div>
    `,
  });
}

// 매일 자동 digest
export async function sendDailyDigest(teachers: { teacherName: string; teacherEmail: string; subject: string | null; schoolName: string; schoolCode: string }[]) {
  const t = getTransporter();
  if (!t) return;
  // Group by school
  const bySchool = new Map<string, typeof teachers>();
  for (const tc of teachers) {
    if (!bySchool.has(tc.schoolName)) bySchool.set(tc.schoolName, []);
    bySchool.get(tc.schoolName)!.push(tc);
  }
  const body = Array.from(bySchool.entries()).map(([school, tcs]) => {
    const lines = tcs.map((tc, i) => `${i + 1}. ${tc.teacherName} - ${tc.teacherEmail}${tc.subject ? ` (${tc.subject})` : ""}`).join("<br>");
    return `<h3>${school} (${tcs.length})</h3><p>${lines}</p>`;
  }).join("<hr>");
  await t.sendMail({
    from: ADMIN_EMAIL,
    to: DIGEST_RECIPIENTS.join(", "),
    subject: `[Snorkl] Daily Digest - ${teachers.length} new teachers`,
    html: `
      <h2>Daily Teacher Registration Digest</h2>
      <p>New registrations in the last 24 hours: <b>${teachers.length}</b></p>
      <hr>${body}
      <hr><p style="color:#666;font-size:12px">Auto-sent from Snorkl Teacher Registration Manager</p>
    `,
  });
}
