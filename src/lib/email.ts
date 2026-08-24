import nodemailer from "nodemailer";
import { db } from "@/db";
import { emailLogs } from "@/db/schema";
// 본사 수신자: Jon 이 업그레이드 처리 담당이라 항상 To,
// 정산 담당 Cailie 는 인보이스가 필요한 건에만 CC (2026-07-30 Jon 요청).
// 주소 상수의 SSOT 는 클라이언트에서도 import 가능한 account-email-template.ts.
import { HQ_TO, HQ_INVOICE_TO, hqGreeting, invoiceGreeting } from "@/lib/account-email-template";
export const HQ_EMAIL = HQ_TO;
export { HQ_INVOICE_TO };
const ADMIN_EMAIL = process.env.GMAIL_USER || "";
export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://snorkl-teacher-reg.vercel.app";

export interface EmailResult {
  success: boolean;
  skipped?: boolean;
  error?: string;
}

export type EmailKind =
  | "batch_notification"
  | "teacher_upgraded"
  | "account_confirm"
  | "account_email"
  | "stale_reminder"
  | "daily_digest" // 레거시 — 발송 코드는 제거됨, 과거 email_logs 행 + /admin 라벨용으로 유지
  | "school_code"
  | "admin_request"
  | "email_verify" // 레거시(OTP/매직링크) — 발송 코드는 제거됨, admin/summary 필터 + 과거 로그용으로 유지
  | "school_login" // 학교 관리자 매직링크 로그인
  | "verification_reminder"; // 승인 대기 교사 리마인더 (학교 관리자/본사)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gmail 등 SMTP의 일시적(transient) 오류 판별 — 4xx 코드/"try again"/temporary/rate + 연결 계열
function isTransientSmtpError(err: unknown): boolean {
  const s = String(err);
  return /\b421\b|\b4\.\d\.\d\b|try again|temporar|rate limit|too many|throttl|greeting never received|connection|timed?\s*out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ESOCKET|EAI_AGAIN|ENOTFOUND|EPIPE/i.test(s);
}

// email_logs.to_email 은 한 컬럼뿐이라, CC 가 있으면 "to (cc: x)" 형태로 함께 남긴다.
// (스키마 변경 없이 "이 건 Cailie가 받았나"를 사후 확인하기 위함)
export function formatLogRecipients(to: nodemailer.SendMailOptions["to"], cc?: nodemailer.SendMailOptions["cc"]): string {
  const flat = (v: unknown): string => {
    if (!v) return "";
    if (Array.isArray(v)) return v.map(flat).filter(Boolean).join(", ");
    if (typeof v === "object" && "address" in (v as Record<string, unknown>)) {
      return String((v as Record<string, unknown>).address ?? "");
    }
    return String(v);
  };
  const toStr = flat(to);
  const ccStr = flat(cc);
  return ccStr ? `${toStr} (cc: ${ccStr})` : toStr;
}

async function sendAndLog(
  transporter: nodemailer.Transporter,
  mail: nodemailer.SendMailOptions,
  meta: { kind: EmailKind; relatedType?: string | null; relatedId?: number | null }
): Promise<EmailResult> {
  const toStr = formatLogRecipients(mail.to, mail.cc);
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await transporter.sendMail(mail);
      await logEmail({ to: toStr, subject: String(mail.subject || ""), kind: meta.kind, status: "success", relatedType: meta.relatedType, relatedId: meta.relatedId });
      return { success: true };
    } catch (err) {
      lastErr = err;
      // 일시 오류면 백오프 후 재시도 (1.5s, 3s). 영구 오류(550 등)는 즉시 중단.
      if (attempt < maxAttempts && isTransientSmtpError(err)) {
        await sleep(attempt * 1500);
        continue;
      }
      break;
    }
  }
  await logEmail({ to: toStr, subject: String(mail.subject || ""), kind: meta.kind, status: "failed", error: String(lastErr), relatedType: meta.relatedType, relatedId: meta.relatedId });
  return { success: false, error: String(lastErr) };
}

export async function logEmail(args: {
  to: string;
  subject: string;
  kind: EmailKind;
  status: "success" | "failed" | "skipped";
  error?: string | null;
  relatedType?: string | null;
  relatedId?: number | null;
}): Promise<void> {
  try {
    await db.insert(emailLogs).values({
      toEmail: args.to,
      subject: args.subject,
      kind: args.kind,
      status: args.status,
      errorMessage: args.error?.slice(0, 1000) || null,
      relatedType: args.relatedType || null,
      relatedId: args.relatedId ?? null,
    });
  } catch (err) {
    console.error("[logEmail] failed to write log:", err);
  }
}

export function escapeHtml(value: string | null | undefined) {
  if (!value) return "";
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

let _warnedMissingEnv = false;
export function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    // M5: warn once per process when env vars are absent
    if (!_warnedMissingEnv) {
      console.warn("[email] GMAIL_USER/GMAIL_APP_PASSWORD not configured — email skipped");
      _warnedMissingEnv = true;
    }
    return null;
  }
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

interface TeacherInfo {
  name: string;
  email: string;
  subject: string | null;
}

import { teamLabelEn, isGroupPurchaseTeam } from "@/lib/teams";
import { parseEmailList } from "@/lib/security";

// 선택 교사 일괄 발송 (Jon에게만 + 확인 링크 포함).
// 기존 계정에 교사를 추가하는 경로라 인보이스가 발생하지 않는다 → Cailie CC 없음.
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
      const schoolName = g.schoolNameEn || g.schoolName;
      const nativeName = g.schoolNameEn ? ` · ${safe(g.schoolName)}` : "";
      return `
        <div style="margin-bottom:16px">
          <h4 style="color:#1e3a5f;margin:0 0 6px;font-size:14px">🏫 ${safe(schoolName)}${nativeName} <span style="color:#999;font-weight:normal">(${g.teachers.length})</span></h4>
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
          const schoolName = g.schoolNameEn || g.schoolName;
          const nativeName = g.schoolNameEn ? ` · ${safe(g.schoolName)}` : "";
          return `
            <div style="margin-bottom:16px">
              <h4 style="color:#1e3a5f;margin:0 0 6px;font-size:14px">🏫 ${safe(schoolName)}${nativeName} <span style="color:#999;font-weight:normal">(${g.teachers.length})</span></h4>
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

  return sendAndLog(t, {
    from: ADMIN_EMAIL,
    to: HQ_EMAIL,
    subject: `[Snorkl] Upgrade Request — ${total} teacher${total !== 1 ? "s" : ""}, ${groups.length} school(s)${districtLabel}`,
    html: `
      <div style="max-width:600px;margin:0 auto;font-family:-apple-system,sans-serif">
        <div style="background:#1e3a5f;color:white;padding:20px 24px;border-radius:12px 12px 0 0">
          <h2 style="margin:0;font-size:20px">🐳 Teacher Upgrade Request</h2>
          <p style="margin:4px 0 0;opacity:0.8;font-size:14px">${total} teacher${total !== 1 ? "s" : ""} from ${summaryParts.join(" + ")}</p>
        </div>
        <div style="background:white;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
          <p style="margin:0 0 16px;font-size:14px;color:#1f2937">${escapeHtml(hqGreeting())}</p>
          ${teamSections}
          ${individualSection}
          ${confirmSection}
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:11px;text-align:center">Sent from Snorkl 주문관리 · LearnToday</p>
        </div>
      </div>
    `,
  }, { kind: "batch_notification", relatedType: "upgrade_batch" });
}

// 학교 등록 요청 시 관리자에게 알림
export async function sendAdminNotification(request: { name: string; contactName: string; contactEmail: string; region: string | null }): Promise<EmailResult> {
  const t = getTransporter();
  if (!t) return { success: false, skipped: true };
  try {
    await t.sendMail({
      from: ADMIN_EMAIL,
      to: ADMIN_EMAIL,
      subject: `[Snorkl] 새 학교 등록 요청 - ${request.name.replace(/[\r\n]/g, " ").trim()}`,
      html: `
        <h3>학교 등록 요청</h3>
        <p><b>학교명:</b> ${safe(request.name)}</p>
        <p><b>지역:</b> ${safe(request.region, "미입력")}</p>
        <p><b>담당자:</b> ${safe(request.contactName)} (${safe(request.contactEmail)})</p>
        <p><a href="${BASE_URL}/admin/requests">승인하러 가기 →</a></p>
      `,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function sendAccountConfirmNotification(payload: {
  schoolName: string;
  schoolNameEn: string | null;
  emails: string[];
  type: string;
  applicantType: string;
  confirmedAt: Date;
}): Promise<EmailResult> {
  const t = getTransporter();
  if (!t || !ADMIN_EMAIL) return { success: false, skipped: true };
  const schoolDisplay = payload.schoolNameEn
    ? `${safe(payload.schoolNameEn)} <span style="color:#888">(${safe(payload.schoolName)})</span>`
    : safe(payload.schoolName);
  const emailList = payload.emails.map((e) => `&nbsp;&nbsp;• ${safe(e)}`).join("<br>");
  const time = payload.confirmedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  try {
    await t.sendMail({
      from: ADMIN_EMAIL,
      to: ADMIN_EMAIL,
      subject: `[Snorkl] Jon 처리 완료 - ${payload.schoolName.replace(/[\r\n]/g, " ").trim()} (${payload.emails.length}명)`,
      html: `
        <div style="font-family:sans-serif;max-width:560px">
          <h3 style="margin:0 0 4px">Jon이 처리를 완료했습니다</h3>
          <p style="color:#666;margin:0 0 16px;font-size:13px">${time} · ${safe(payload.type)} · ${payload.applicantType === "individual" ? "개인" : "학교"}</p>
          <p style="margin:0 0 8px"><b>${schoolDisplay}</b></p>
          <p style="margin:0 0 12px">${emailList}</p>
          <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
          <p><a href="${BASE_URL}/admin/accounts" style="color:#2563eb">정산 페이지 열기 →</a></p>
        </div>
      `,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// 승인 후 담당자에게 학교 코드 이메일 발송
export async function sendSchoolCodeEmail(email: string, name: string, schoolName: string, code: string): Promise<EmailResult> {
  const t = getTransporter();
  if (!t) return { success: false, skipped: true };
  try {
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
          <p><a href="${BASE_URL}" style="color:#2563eb">${BASE_URL}</a></p>
          <p style="color:#666;font-size:13px">선생님들이 위 링크에서 학교 코드를 입력하고 Snorkl 프리미엄 등록을 하시면 됩니다.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:11px">이 메일은 Snorkl 주문관리 시스템에서 자동 발송되었습니다.</p>
        </div>
      `,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function sendTeacherUpgradedEmail(teacher: {
  name?: string | null;
  email: string;
  schoolName: string;
  schoolNameEn?: string | null;
}): Promise<EmailResult> {
  const t = getTransporter();
  if (!t) return { success: false, skipped: true };
  const schoolDisplay = teacher.schoolNameEn
    ? `${safe(teacher.schoolNameEn)} <span style="color:#888">(${safe(teacher.schoolName)})</span>`
    : safe(teacher.schoolName);
  const greetName = teacher.name ? `${safe(teacher.name)} ` : "";
  return sendAndLog(t, {
    from: ADMIN_EMAIL,
    to: teacher.email,
    subject: `[Snorkl] 프리미엄 계정이 활성화되었습니다`,
    html: `
      <div style="max-width:520px;margin:0 auto;font-family:sans-serif;color:#1f2937">
        <h2 style="color:#1e3a5f;margin:0 0 12px">${greetName}선생님, 환영합니다 🎉</h2>
        <p style="margin:0 0 12px">${schoolDisplay}에서 신청하신 <b>Snorkl 프리미엄 계정 업그레이드</b>가 완료되었습니다.</p>
        <p style="margin:0 0 12px">가입하신 이메일 <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${safe(teacher.email)}</code> 로
          <a href="https://snorkl.app" style="color:#2563eb">Snorkl</a>에 로그인하시면 바로 프리미엄 기능을 사용하실 수 있습니다.</p>
        <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:12px;padding:14px 16px;margin:18px 0">
          <p style="margin:0 0 6px;font-weight:600;color:#854d0e">💬 Snorkl 한국 선생님 커뮤니티</p>
          <p style="margin:0;font-size:13px">다른 선생님들과 노하우를 나눠보세요.<br>
            <a href="https://open.kakao.com/o/gkyPvfWh" style="color:#a16207;font-weight:600">카카오톡 오픈채팅 참여하기 →</a></p>
        </div>
        <p style="margin:0 0 4px;font-size:13px;color:#6b7280">문의: <a href="mailto:contenjoo@learntoday.co.kr" style="color:#2563eb">contenjoo@learntoday.co.kr</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#9ca3af;font-size:11px;margin:0">이 메일은 Snorkl 주문관리 시스템에서 자동 발송되었습니다.</p>
      </div>
    `,
  }, { kind: "teacher_upgraded", relatedType: "teacher" });
}

// 정산(account_requests) 경로로 업그레이드/결제 완료된 교사들에게 활성화 완료 메일 발송.
// emails 는 콤마/줄바꿈 구분 문자열. 이름 정보가 없으므로 일반 인사로 발송. 폭주 방지 간격.
export async function sendAccountUpgradeCompletion(req: {
  emails: string;
  schoolName: string;
  schoolNameEn?: string | null;
}): Promise<{ sent: number; failed: number; total: number }> {
  const list = parseEmailList(req.emails);
  let sent = 0, failed = 0;
  for (let i = 0; i < list.length; i++) {
    const res = await sendTeacherUpgradedEmail({
      email: list[i],
      schoolName: req.schoolName,
      schoolNameEn: req.schoolNameEn,
    });
    if (res.success) sent++; else if (!res.skipped) failed++;
    if (i < list.length - 1) await sleep(400);
  }
  return { sent, failed, total: list.length };
}

export async function sendConfirmNotification(payload: {
  confirmedCount: number;
  schools: { name: string; nameEn: string | null; team: string | null; emails: string[] }[];
  confirmedAt: Date;
}): Promise<EmailResult> {
  const t = getTransporter();
  if (!t) return { success: false, skipped: true };
  if (!ADMIN_EMAIL) return { success: false, skipped: true };
  const body = payload.schools.map((s) => {
    const head = `<b>${safe(s.nameEn || s.name)}</b>${s.nameEn ? ` <span style="color:#888">${safe(s.name)}</span>` : ""}${s.team ? ` <span style="color:#666;font-size:11px">[${safe(s.team)}]</span>` : ""}`;
    const lines = s.emails.map((e) => `&nbsp;&nbsp;• ${safe(e)}`).join("<br>");
    return `<p style="margin:8px 0">${head}<br>${lines}</p>`;
  }).join("");
  const time = payload.confirmedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return sendAndLog(t, {
    from: ADMIN_EMAIL,
    to: ADMIN_EMAIL,
    subject: `[Snorkl] Jon 업그레이드 확인 완료 - ${payload.confirmedCount}명`,
    html: `
      <div style="font-family:sans-serif;max-width:560px">
        <h3 style="margin:0 0 4px">Jon이 업그레이드를 확인했습니다</h3>
        <p style="color:#666;margin:0 0 16px;font-size:13px">${time} · ${payload.confirmedCount}명 · ${payload.schools.length}개 학교</p>
        ${body}
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
        <p><a href="${BASE_URL}/admin" style="color:#2563eb">대시보드 열기 →</a></p>
      </div>
    `,
  }, { kind: "account_confirm", relatedType: "upgrade_batch" });
}

export async function sendDomainPaidRequest(payload: {
  schoolName: string;
  schoolNameEn?: string | null;
  domain: string;
  team?: string | null;
  note?: string | null;
  confirmLink?: string;
}): Promise<EmailResult> {
  const t = getTransporter();
  if (!t) return { success: false, skipped: true };
  const schoolDisplay = payload.schoolNameEn
    ? `${safe(payload.schoolNameEn)} (${safe(payload.schoolName)})`
    : safe(payload.schoolName);
  const subject = `[Snorkl] Please enable paid domain: @${payload.domain}`;
  const buttonBlock = payload.confirmLink
    ? `<div style="text-align:center;margin:24px 0;padding:20px;background:#f0f7ff;border-radius:12px;border:1px solid #dbeafe">
         <p style="margin:0 0 12px;color:#1e3a5f;font-size:14px;font-weight:600">Once the domain is enabled as paid:</p>
         <a href="${payload.confirmLink}"
            style="display:inline-block;background:#2563eb;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px">
           ✓ Domain Enabled
         </a>
         <p style="margin:12px 0 0;color:#888;font-size:11px">Or paste this in your browser:<br>${safe(payload.confirmLink)}</p>
       </div>`
    : "";
  // 도메인 활성화 작업은 Jon 담당. 인보이스는 sendDomainInvoiceRequest 로 Cailie 에게 따로 간다.
  return sendAndLog(t, {
    from: ADMIN_EMAIL,
    to: HQ_EMAIL,
    subject,
    html: `
      <div style="max-width:560px;margin:0 auto;font-family:-apple-system,sans-serif;color:#1f2937">
        <h3 style="margin:0 0 12px">${escapeHtml(hqGreeting())}</h3>
        <p style="margin:0 0 12px">Could you please enable the following <b>domain</b> as a paid Snorkl domain?
          All teachers signing up with this domain should be automatically upgraded to premium.</p>
        <div style="background:#f0f7ff;border:1px solid #dbeafe;border-radius:10px;padding:14px 16px;margin:16px 0">
          <p style="margin:0 0 6px;font-size:12px;color:#1e3a5f;font-weight:600;text-transform:uppercase;letter-spacing:0.06em">Domain</p>
          <p style="margin:0;font-size:18px;font-family:monospace;font-weight:bold;color:#1e3a5f">@${safe(payload.domain)}</p>
        </div>
        <p style="margin:0 0 6px;font-size:13px"><b>School:</b> ${schoolDisplay}${payload.team ? ` <span style="color:#666">[${safe(payload.team)}]</span>` : ""}</p>
        ${payload.note ? `<p style="margin:8px 0 0;font-size:13px"><b>Note:</b> ${safe(payload.note)}</p>` : ""}
        ${buttonBlock}
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#9ca3af;font-size:11px;margin:0">Sent from Snorkl 주문관리 · LearnToday</p>
      </div>
    `,
    text: `${hqGreeting()}\n\nCould you please enable the following domain as a paid Snorkl domain?\nAll teachers signing up with this domain should be automatically upgraded to premium.\n\nDomain: @${payload.domain}\nSchool: ${payload.schoolNameEn || payload.schoolName}${payload.team ? ` [${payload.team}]` : ""}${payload.note ? `\nNote: ${payload.note}` : ""}${payload.confirmLink ? `\n\nOnce enabled, please click to confirm:\n${payload.confirmLink}` : ""}\n\nThanks,\nBanghyun`,
  }, { kind: "account_email", relatedType: "school" });
}

/**
 * 도메인 유료화 인보이스 요청 — To: Cailie, CC: Jon.
 * 처리 요청(sendDomainPaidRequest)과 짝을 이루며 같은 도메인으로 대조한다.
 */
export async function sendDomainInvoiceRequest(payload: {
  schoolName: string;
  schoolNameEn?: string | null;
  domain: string;
}): Promise<EmailResult> {
  const t = getTransporter();
  if (!t) return { success: false, skipped: true };
  const school = payload.schoolNameEn || payload.schoolName;
  const subject = `[Snorkl] Invoice Request — Paid domain @${payload.domain}`;
  const text = `${invoiceGreeting()}\n\nCould you please issue an invoice for the following?\n\n[domain] ${school} — Paid domain @${payload.domain}\n\nJon is enabling the domain separately (cc'd).\n\nThank you,\nBanghyun`;
  return sendAndLog(t, {
    from: ADMIN_EMAIL,
    to: HQ_INVOICE_TO,
    cc: HQ_EMAIL,
    subject,
    text,
    html: `
      <div style="max-width:560px;margin:0 auto;font-family:-apple-system,sans-serif;color:#1f2937;font-size:14px;line-height:1.6">
        <h3 style="margin:0 0 12px">${escapeHtml(invoiceGreeting())}</h3>
        <p style="margin:0 0 12px">Could you please issue an invoice for the following?</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:16px 0">
          <p style="margin:0;font-size:13px"><b>[domain]</b> ${escapeHtml(school)} — Paid domain
            <span style="font-family:monospace">@${safe(payload.domain)}</span></p>
        </div>
        <p style="margin:0 0 12px;color:#64748b;font-size:12px">Jon is enabling the domain separately (cc&rsquo;d).</p>
        <p style="margin:16px 0 0">Thank you,<br>Banghyun</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <p style="color:#9ca3af;font-size:11px;margin:0">Sent from Snorkl 주문관리 · LearnToday</p>
      </div>
    `,
  }, { kind: "account_email", relatedType: "school" });
}

export async function sendDomainConfirmedNotification(payload: {
  schoolName: string;
  schoolNameEn?: string | null;
  domain: string;
  team?: string | null;
  confirmedAt: Date;
}): Promise<EmailResult> {
  const t = getTransporter();
  if (!t || !ADMIN_EMAIL) return { success: false, skipped: true };
  const schoolDisplay = payload.schoolNameEn
    ? `${safe(payload.schoolNameEn)} <span style="color:#888">(${safe(payload.schoolName)})</span>`
    : safe(payload.schoolName);
  const time = payload.confirmedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return sendAndLog(t, {
    from: ADMIN_EMAIL,
    to: ADMIN_EMAIL,
    subject: `[Snorkl] Jon 도메인 유료 활성화 완료 - @${payload.domain}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px">
        <h3 style="margin:0 0 4px">Jon이 도메인을 유료로 활성화했습니다 ✓</h3>
        <p style="color:#666;margin:0 0 16px;font-size:13px">${time}</p>
        <p style="margin:0 0 8px"><b>Domain:</b> <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-family:monospace">@${safe(payload.domain)}</code></p>
        <p style="margin:0 0 8px"><b>School:</b> ${schoolDisplay}${payload.team ? ` <span style="color:#666;font-size:11px">[${safe(payload.team)}]</span>` : ""}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
        <p><a href="${BASE_URL}/admin/schools" style="color:#2563eb">학교 관리 열기 →</a></p>
      </div>
    `,
  }, { kind: "account_confirm", relatedType: "school" });
}

export async function sendStaleSentReminder(items: { email: string; name: string; notifiedAt: Date; schoolName: string; schoolTeam: string | null }[]): Promise<EmailResult> {
  const t = getTransporter();
  if (!t || !ADMIN_EMAIL || items.length === 0) return { success: false, skipped: true };
  const now = Date.now();
  const rows = items.map((i) => {
    const days = Math.floor((now - new Date(i.notifiedAt).getTime()) / 86400000);
    return `<tr><td style="padding:4px 8px;font-size:13px">${safe(i.schoolName)}${i.schoolTeam ? ` <span style="color:#999;font-size:11px">[${safe(i.schoolTeam)}]</span>` : ""}</td><td style="padding:4px 8px;font-family:monospace;font-size:12px">${safe(i.email)}</td><td style="padding:4px 8px;text-align:right;color:#dc2626;font-weight:600;font-size:12px">${days}일</td></tr>`;
  }).join("");
  try {
    await t.sendMail({
      from: ADMIN_EMAIL,
      to: ADMIN_EMAIL,
      subject: `[Snorkl] ⏰ Jon에게 발송 후 3일 넘은 건 ${items.length}건`,
      html: `
        <div style="max-width:640px;font-family:sans-serif">
          <h3 style="margin:0 0 12px">⏰ Stale Sent Reminder</h3>
          <p style="color:#666;margin:0 0 16px;font-size:13px">Jon에게 발송했지만 3일 넘게 확정 안 된 교사들이에요. Jon에게 리마인드 보낼지 검토 필요.</p>
          <table style="border-collapse:collapse;width:100%;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;overflow:hidden">
            <thead><tr style="background:#fee2e2"><th style="padding:8px;text-align:left;font-size:11px;color:#7f1d1d">학교</th><th style="padding:8px;text-align:left;font-size:11px;color:#7f1d1d">이메일</th><th style="padding:8px;text-align:right;font-size:11px;color:#7f1d1d">경과</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin:16px 0 0"><a href="${BASE_URL}/admin" style="color:#2563eb">대시보드 열기 →</a></p>
        </div>
      `,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
