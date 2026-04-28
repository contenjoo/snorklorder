import nodemailer from "nodemailer";

const JON_EMAIL = "jon@snorkl.app";
const DIGEST_RECIPIENTS = ["jon@snorkl.app", "jeff@snorkl.app"];
const ADMIN_EMAIL = process.env.GMAIL_USER || "";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://snorkl-teacher-reg.vercel.app";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safe(value: string | null | undefined, fallback = "") {
  if (!value) return fallback;
  return escapeHtml(value);
}

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
  const safeSchoolName = safe(schoolName);
  const safeTeacherName = safe(teacher.name);
  const safeTeacherEmail = safe(teacher.email);
  const safeTeacherSubject = safe(teacher.subject, "N/A");
  await t.sendMail({
    from: ADMIN_EMAIL,
    to: JON_EMAIL,
    subject: `[Snorkl] New Teacher - ${schoolName.replace(/[\r\n]/g, " ").trim()}`,
    html: `
      <h3>New Teacher Registration</h3>
      <p><b>School:</b> ${safeSchoolName}</p>
      <p><b>Name:</b> ${safeTeacherName} | <b>Email:</b> ${safeTeacherEmail} | <b>Subject:</b> ${safeTeacherSubject}</p>
      <p style="color:#666;font-size:12px">Please upgrade this teacher in Snorkl.</p>
    `,
  });
}

// English labels for team names
const TEAM_EN: Record<string, string> = {
  "서울1팀": "Seoul Team 1",
  "서울4팀": "Seoul Team 4",
  "경기2팀": "Gyeonggi Team 2",
  "경기3팀": "Gyeonggi Team 3",
  "경기5팀": "Gyeonggi Team 5",
};

function teamLabelEn(team: string): string {
  if (TEAM_EN[team]) return TEAM_EN[team];
  if (team.includes("개별")) return "Individual";
  return team;
}

function isGroupPurchaseTeam(team: string | null | undefined): boolean {
  if (!team) return false;
  return !team.includes("개별") && team !== "미배정";
}

// 선택 교사 일괄 발송 (Jon에게만 + 확인 링크 포함)
export async function sendBatchNotification(
  groups: { schoolName: string; schoolNameEn?: string; team?: string; teachers: (TeacherInfo & { id?: number })[] }[],
  confirmToken?: string,
  teamSchoolsMap?: Record<string, string[]>
) {
  const t = getTransporter();
  if (!t) return { success: false, error: "Gmail not configured" };
  const total = groups.reduce((s, g) => s + g.teachers.length, 0);

  // Collect unique team names for subject line
  const teams = [...new Set(groups.map((g) => g.team).filter(Boolean))] as string[];
  const teamLabels = teams.filter(t => isGroupPurchaseTeam(t)).map(t => teamLabelEn(t));
  const districtLabel = teamLabels.length > 0 ? ` [${teamLabels.join(", ")}]` : "";

  // Group schools by team
  const teamGroups = new Map<string, typeof groups>();
  const individualSchools: typeof groups = [];

  for (const g of groups) {
    if (isGroupPurchaseTeam(g.team)) {
      const key = g.team!;
      if (!teamGroups.has(key)) teamGroups.set(key, []);
      teamGroups.get(key)!.push(g);
    } else {
      individualSchools.push(g);
    }
  }

  // Build team sections
  const teamSections = Array.from(teamGroups.entries()).map(([teamKey, teamSchools]) => {
    const teamTeacherCount = teamSchools.reduce((s, g) => s + g.teachers.length, 0);
    const label = teamLabelEn(teamKey);

    // Team member summary (all schools in this team, from teamSchoolsMap)
    const allTeamMembers = teamSchoolsMap?.[teamKey] || [];
    const memberSummary = allTeamMembers.length > 0
      ? `<div style="background:#f0f4ff;border-left:3px solid #6366f1;padding:8px 12px;margin:0 0 16px;border-radius:0 6px 6px 0;font-size:12px;color:#4338ca">
           <strong>Team members (${allTeamMembers.length} schools):</strong> ${allTeamMembers.map(n => safe(n)).join(", ")}
         </div>`
      : "";

    // School blocks within this team
    const schoolBlocks = teamSchools.map((g) => {
      const emailList = g.teachers.map((tc) =>
        `<div style="padding:4px 0;font-size:14px;font-family:monospace">${safe(tc.email)}</div>`
      ).join("");
      const enName = g.schoolNameEn ? ` · ${safe(g.schoolNameEn)}` : "";
      return `
        <div style="margin-bottom:16px">
          <h4 style="color:#1e3a5f;margin:0 0 6px;font-size:14px">🏫 ${safe(g.schoolName)}${enName} <span style="color:#999;font-weight:normal">(${g.teachers.length})</span></h4>
          <div style="background:#f8f9fa;border-radius:6px;padding:6px 14px">
            ${emailList}
          </div>
        </div>`;
    }).join("");

    return `
      <div style="margin-bottom:32px">
        <div style="border-bottom:2px solid #6366f1;padding-bottom:8px;margin-bottom:12px">
          <h3 style="color:#1e3a5f;margin:0;font-size:17px">📦 ${safe(label)}</h3>
          <p style="margin:2px 0 0;color:#666;font-size:13px">${teamTeacherCount} teacher${teamTeacherCount !== 1 ? "s" : ""} from ${teamSchools.length} school${teamSchools.length !== 1 ? "s" : ""}</p>
        </div>
        ${memberSummary}
        ${schoolBlocks}
      </div>`;
  }).join("");

  // Individual schools section
  const individualSection = individualSchools.length > 0
    ? `
      <div style="margin-bottom:32px">
        <div style="border-bottom:2px solid #94a3b8;padding-bottom:8px;margin-bottom:12px">
          <h3 style="color:#1e3a5f;margin:0;font-size:17px">📋 Individual Schools</h3>
          <p style="margin:2px 0 0;color:#666;font-size:13px">${individualSchools.reduce((s, g) => s + g.teachers.length, 0)} teacher${individualSchools.reduce((s, g) => s + g.teachers.length, 0) !== 1 ? "s" : ""} from ${individualSchools.length} school${individualSchools.length !== 1 ? "s" : ""}</p>
        </div>
        ${individualSchools.map((g) => {
          const emailList = g.teachers.map((tc) =>
            `<div style="padding:4px 0;font-size:14px;font-family:monospace">${safe(tc.email)}</div>`
          ).join("");
          const enName = g.schoolNameEn ? ` · ${safe(g.schoolNameEn)}` : "";
          return `
            <div style="margin-bottom:16px">
              <h4 style="color:#1e3a5f;margin:0 0 6px;font-size:14px">🏫 ${safe(g.schoolName)}${enName} <span style="color:#999;font-weight:normal">(${g.teachers.length})</span></h4>
              <div style="background:#f8f9fa;border-radius:6px;padding:6px 14px">
                ${emailList}
              </div>
            </div>`;
        }).join("")}
      </div>`
    : "";

  const confirmSection = confirmToken
    ? `
      <div style="text-align:center;margin:32px 0;padding:24px;background:#f0f7ff;border-radius:12px">
        <p style="margin:0 0 12px;color:#1e3a5f;font-size:15px">After upgrading, please confirm:</p>
        <a href="${BASE_URL}/confirm/${encodeURIComponent(confirmToken)}"
           style="display:inline-block;background:#2563eb;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">
          ✅ Confirm Upgrades
        </a>
        <p style="margin:12px 0 0;color:#999;font-size:12px">Or copy this link: ${safe(`${BASE_URL}/confirm/${confirmToken}`)}</p>
      </div>`
    : "";

  // Count teams for summary
  const teamCount = teamGroups.size;
  const summaryParts: string[] = [];
  if (teamCount > 0) summaryParts.push(`${teamCount} group purchase team${teamCount !== 1 ? "s" : ""}`);
  if (individualSchools.length > 0) summaryParts.push(`${individualSchools.length} individual school${individualSchools.length !== 1 ? "s" : ""}`);

  await t.sendMail({
    from: ADMIN_EMAIL,
    to: JON_EMAIL,
    subject: `[Snorkl] Upgrade Request — ${total} teacher${total !== 1 ? "s" : ""}, ${groups.length} school(s)${districtLabel}`,
    html: `
      <div style="max-width:600px;margin:0 auto;font-family:-apple-system,sans-serif">
        <div style="background:#1e3a5f;color:white;padding:20px 24px;border-radius:12px 12px 0 0">
          <h2 style="margin:0;font-size:20px">🐳 Teacher Upgrade Request</h2>
          <p style="margin:4px 0 0;opacity:0.8;font-size:14px">${total} teacher${total !== 1 ? "s" : ""} from ${summaryParts.join(" + ")}</p>
        </div>
        <div style="background:white;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          ${teamSections}
          ${individualSection}
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
    subject: `[Snorkl] 새 학교 등록 요청 - ${request.name.replace(/[\r\n]/g, " ").trim()}`,
    html: `
      <h3>학교 등록 요청</h3>
      <p><b>학교명:</b> ${safe(request.name)}</p>
      <p><b>지역:</b> ${safe(request.region, "미입력")}</p>
      <p><b>담당자:</b> ${safe(request.contactName)} (${safe(request.contactEmail)})</p>
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
    subject: `[Snorkl] ${schoolName.replace(/[\r\n]/g, " ").trim()} 학교 코드가 발급되었습니다`,
    html: `
      <div style="max-width:480px;margin:0 auto;font-family:sans-serif">
        <h2 style="color:#1e3a5f">${safe(schoolName)}</h2>
        <p>${safe(name)} 선생님, 학교 등록이 승인되었습니다!</p>
        <div style="background:#f0f7ff;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
          <p style="color:#666;margin:0 0 8px">학교 코드</p>
          <p style="font-size:32px;font-weight:bold;color:#1e3a5f;letter-spacing:4px;margin:0">${safe(code)}</p>
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

// 구매자에게 셀프등록 링크 발송 (1~3인 좌석 주문)
export async function sendSeatOrderLink(
  purchaserEmail: string,
  schoolName: string,
  quantity: number,
  token: string,
) {
  const t = getTransporter();
  if (!t) return { success: false, error: "Gmail not configured" };
  const link = `${BASE_URL}/seat-register/${encodeURIComponent(token)}`;
  await t.sendMail({
    from: ADMIN_EMAIL,
    to: purchaserEmail,
    subject: `[Snorkl] ${quantity}인 교사 등록 링크가 발송되었습니다`,
    html: `
      <div style="max-width:520px;margin:0 auto;font-family:-apple-system,sans-serif">
        <div style="background:#1e3a5f;color:white;padding:20px 24px;border-radius:12px 12px 0 0">
          <h2 style="margin:0;font-size:20px">🐳 Snorkl 프리미엄 교사 등록</h2>
          <p style="margin:4px 0 0;opacity:0.85;font-size:14px">${safe(schoolName)} · ${quantity}인 좌석</p>
        </div>
        <div style="background:white;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          <p>안녕하세요, Snorkl 프리미엄 구매에 감사드립니다.</p>
          <p>아래 링크에서 <b>${quantity}명의 교사 정보</b>(이름·이메일)를 직접 입력하시면 등록 요청이 접수됩니다.</p>
          <p>동료 선생님께 링크를 공유하셔도 됩니다.</p>
          <div style="text-align:center;margin:28px 0;padding:24px;background:#f0f7ff;border-radius:12px">
            <a href="${link}"
               style="display:inline-block;background:#2563eb;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">
              교사 등록 페이지 열기
            </a>
            <p style="margin:12px 0 0;color:#999;font-size:12px;word-break:break-all">${safe(link)}</p>
          </div>
          <p style="color:#666;font-size:13px">등록 후 1~2 영업일 내 처리됩니다. 문의: jon@snorkl.app</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:11px;text-align:center">Snorkl 주문관리 · LearnToday</p>
        </div>
      </div>
    `,
  });
  return { success: true };
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
    const lines = tcs
      .map((tc, i) => `${i + 1}. ${safe(tc.teacherName)} - ${safe(tc.teacherEmail)}${tc.subject ? ` (${safe(tc.subject)})` : ""}`)
      .join("<br>");
    return `<h3>${safe(school)} (${tcs.length})</h3><p>${lines}</p>`;
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
