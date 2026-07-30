import { boolean, date, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const schools = pgTable("schools", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  nameEn: text("name_en"),
  domain: text("domain"),
  allowedDomains: text("allowed_domains"), // 콤마 구분 다중 도메인 (domain 보강) — 자동 승인 판정용
  region: text("region"),
  team: text("team"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("schools_team_idx").on(table.team),
  index("schools_region_idx").on(table.region),
]);

export const teachers = pgTable("teachers", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id")
    .notNull()
    .references(() => schools.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  subject: text("subject"),
  status: text("status").notNull().default("pending"), // pending | sent | upgraded
  notifiedAt: timestamp("notified_at"),
  // 검증 파이프라인: unverified → email_verified → approved | rejected
  verificationStatus: text("verification_status").notNull().default("unverified"),
  emailVerifiedAt: timestamp("email_verified_at"), // OTP 확인 시각 = 승인 큐 진입 시각
  approvedAt: timestamp("approved_at"),
  approvedBy: text("approved_by"), // domain | school_admin:<email> | hq | legacy
  rejectedReason: text("rejected_reason"),
  escalatedAt: timestamp("escalated_at"), // 본사 큐로 이관된 시각 (null=미이관)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("teachers_school_id_idx").on(table.schoolId),
  uniqueIndex("teachers_school_email_unique_idx").on(table.schoolId, table.email),
  index("teachers_status_idx").on(table.status),
  index("teachers_created_at_idx").on(table.createdAt),
  index("teachers_school_vstatus_idx").on(table.schoolId, table.verificationStatus),
]);

export const schoolRequests = pgTable("school_requests", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull().default("company"), // company | school_store
  name: text("name").notNull(),
  nameEn: text("name_en"),
  region: text("region"),
  domain: text("domain"),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  rejectReason: text("reject_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
}, (table) => [
  index("school_requests_status_created_at_idx").on(table.status, table.createdAt),
]);

export const accountRequests = pgTable("account_requests", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull().default("company"), // company | school_store
  applicantType: text("applicant_type").notNull().default("school"), // school | individual
  type: text("type").notNull().default("upgrade"), // upgrade | email_change | type_change | extension
  schoolName: text("school_name").notNull(),
  schoolNameEn: text("school_name_en"),
  emails: text("emails").notNull(),
  accountType: text("account_type").default("teacher"),
  quantity: integer("quantity").default(1),
  oldEmail: text("old_email"),
  fromType: text("from_type"),
  extensionDate: text("extension_date"),
  notes: text("notes"),
  status: text("status").notNull().default("draft"), // draft | sent | processed | invoiced | paid
  // 인보이스가 필요한 요청인지 — true 일 때만 본사 정산 담당(Cailie)을 CC 에 포함한다.
  // 기본값 true: 빠뜨렸을 때 인보이스 누락 손실 > 메일 한 통 더 가는 비용.
  needsInvoice: boolean("needs_invoice").notNull().default(true),
  invoiceNumber: text("invoice_number"),
  invoiceAmount: text("invoice_amount"),
  invoiceDueDate: date("invoice_due_date"), // 'YYYY-MM-DD' 문자열로 직렬화
  paymentLink: text("payment_link"),
  paymentDate: date("payment_date"), // 'YYYY-MM-DD' 문자열로 직렬화
  paymentMethod: text("payment_method"),
  confirmToken: text("confirm_token").unique(),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("account_requests_status_created_at_idx").on(table.status, table.createdAt),
  index("account_requests_created_at_idx").on(table.createdAt),
]);

export const upgradeBatches = pgTable("upgrade_batches", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  teacherIds: text("teacher_ids").notNull(), // JSON array of teacher IDs
  confirmedIds: text("confirmed_ids"), // JSON array of confirmed teacher IDs
  status: text("status").notNull().default("pending"), // pending | confirmed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  confirmedAt: timestamp("confirmed_at"),
});

export const domainRequests = pgTable("domain_requests", {
  id: serial("id").primaryKey(),
  schoolName: text("school_name").notNull(),
  schoolNameEn: text("school_name_en"),
  domain: text("domain").notNull(),
  team: text("team"),
  note: text("note"),
  status: text("status").notNull().default("pending"), // pending | done | invoiced | paid
  confirmToken: text("confirm_token").notNull().unique(),
  confirmedAt: timestamp("confirmed_at"),
  invoiceNumber: text("invoice_number").default(""),
  invoiceAmount: text("invoice_amount").default(""),
  invoiceDueDate: text("invoice_due_date").default(""),
  paymentLink: text("payment_link").default(""),
  paymentDate: text("payment_date").default(""),
  paymentMethod: text("payment_method").default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("domain_requests_status_idx").on(table.status),
  index("domain_requests_created_at_idx").on(table.createdAt),
]);

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // "서울1팀", "경기7팀", "취소" 등 — schools.team 과 동일 문자열
  labelEn: text("label_en"),
  colorPalette: text("color_palette"), // tailwind color name e.g. "blue", "rose"
  isActive: integer("is_active").notNull().default(1), // 1=active, 0=deactivated
  kind: text("kind").notNull().default("group"), // group | individual | system (취소 등)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("teams_code_idx").on(table.code),
]);

export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  kind: text("kind").notNull(), // batch_notification | teacher_upgraded | account_confirm | account_email | stale_reminder | daily_digest | school_code | admin_request
  status: text("status").notNull(), // success | failed | skipped
  errorMessage: text("error_message"),
  relatedType: text("related_type"), // teacher | account_request | upgrade_batch | school_request
  relatedId: integer("related_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("email_logs_created_at_idx").on(table.createdAt),
  index("email_logs_status_idx").on(table.status),
  index("email_logs_kind_idx").on(table.kind),
]);

// 학교 관리자 (공동구매 총무) — 한 학교에 복수 허용. 매직링크 로그인 대상.
export const schoolAdmins = pgTable("school_admins", {
  id: serial("id").primaryKey(),
  schoolId: integer("school_id")
    .notNull()
    .references(() => schools.id),
  email: text("email").notNull(),
  role: text("role").notNull().default("admin"), // admin
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("school_admins_email_idx").on(table.email),
  uniqueIndex("school_admins_school_email_unique_idx").on(table.schoolId, table.email),
]);

// 교사 이메일 소유 증명 (OTP 6자리 + 매직링크 토큰)
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id")
    .notNull()
    .references(() => teachers.id),
  code: text("code").notNull(), // 6자리 OTP
  token: text("token").notNull().unique(), // 매직링크용 토큰
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("email_verification_tokens_teacher_idx").on(table.teacherId),
  index("email_verification_tokens_token_idx").on(table.token),
]);

// 학교 관리자 매직링크 로그인 토큰
export const schoolLoginTokens = pgTable("school_login_tokens", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  schoolId: integer("school_id")
    .notNull()
    .references(() => schools.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("school_login_tokens_token_idx").on(table.token),
]);

export const schoolsRelations = relations(schools, ({ many }) => ({
  teachers: many(teachers),
  admins: many(schoolAdmins),
}));

export const schoolAdminsRelations = relations(schoolAdmins, ({ one }) => ({
  school: one(schools, {
    fields: [schoolAdmins.schoolId],
    references: [schools.id],
  }),
}));

export const teachersRelations = relations(teachers, ({ one }) => ({
  school: one(schools, {
    fields: [teachers.schoolId],
    references: [schools.id],
  }),
}));
