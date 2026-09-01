import { boolean, check, date, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

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
  channel: text("channel").notNull().default("company"), // company | school_store | partner
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
  // Gmail 메시지 단위 선점키. thread는 인보이스와 영수증이 같을 수 있으므로 고유하지 않다.
  invoiceGmailMessageId: text("invoice_gmail_message_id"),
  invoiceGmailThreadId: text("invoice_gmail_thread_id"),
  receiptGmailMessageId: text("receipt_gmail_message_id"),
  receiptGmailThreadId: text("receipt_gmail_thread_id"),
  // 본사 메일 2단계 발송 원장. Jon 성공 후 Cailie 실패를 durable partial success로 보존한다.
  processingEmailSendStartedAt: timestamp("processing_email_send_started_at"),
  processingEmailSentAt: timestamp("processing_email_sent_at"),
  invoiceEmailSendStartedAt: timestamp("invoice_email_send_started_at"),
  invoiceEmailSentAt: timestamp("invoice_email_sent_at"),
  invoiceEmailLastError: text("invoice_email_last_error"),
  confirmToken: text("confirm_token").unique(),
  confirmedAt: timestamp("confirmed_at"),
  // market 주문 수신 추적. 기존 수동/공개 요청은 모두 null이며 market API 수신 건만 채운다.
  externalSource: text("external_source"),
  marketRequestId: text("market_request_id"),
  marketOrderId: text("market_order_id"),
  orderNumber: text("order_number"),
  idempotencyKey: text("idempotency_key"),
  externalPayloadHash: text("external_payload_hash"),
  draftOnly: boolean("draft_only").notNull().default(false),
  // Market 주문 취소 saga 상태. 실제 경합 차단의 SSOT는 market_order_void_fences이며,
  // 이 컬럼들은 개별 요청의 감사 추적·UI/상태 되읽기용이다.
  marketVoidState: text("market_void_state").notNull().default("active"), // active | non_voidable | prepared | voided
  marketVoidOperationId: text("market_void_operation_id"),
  marketVoidPreparedAt: timestamp("market_void_prepared_at"),
  marketVoidedAt: timestamp("market_voided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("account_requests_status_created_at_idx").on(table.status, table.createdAt),
  index("account_requests_created_at_idx").on(table.createdAt),
  uniqueIndex("account_requests_invoice_gmail_message_id_unique_idx").on(table.invoiceGmailMessageId),
  uniqueIndex("account_requests_receipt_gmail_message_id_unique_idx").on(table.receiptGmailMessageId),
  uniqueIndex("account_requests_idempotency_key_unique_idx").on(table.idempotencyKey),
  uniqueIndex("account_requests_external_request_unique_idx").on(table.externalSource, table.marketRequestId),
  index("account_requests_market_order_id_idx").on(table.marketOrderId),
  index("account_requests_order_number_idx").on(table.orderNumber),
  index("account_requests_market_void_state_idx").on(table.marketVoidState),
  check(
    "account_requests_market_void_state_check",
    sql`${table.marketVoidState} in ('active', 'non_voidable', 'prepared', 'voided')`,
  ),
]);

/**
 * Market 주문 단위 취소 fence.
 *
 * 같은 주문에 여러 account_request가 있거나 아직 원격 create가 도착하지 않았어도
 * 한 행의 조건부 UPDATE로 발송 선점(non_voidable)과 취소 선점(prepared)을 직렬화한다.
 */
export const marketOrderVoidFences = pgTable("market_order_void_fences", {
  marketOrderId: text("market_order_id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  state: text("state").notNull().default("active"), // active | non_voidable | prepared | voided
  operationId: text("operation_id"),
  reasonCode: text("reason_code"),
  requestFingerprint: text("request_fingerprint"),
  version: integer("version").notNull().default(0),
  preparedAt: timestamp("prepared_at"),
  voidedAt: timestamp("voided_at"),
  abortedAt: timestamp("aborted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("market_order_void_fences_state_idx").on(table.state),
  index("market_order_void_fences_operation_id_idx").on(table.operationId),
  uniqueIndex("market_order_void_fences_operation_id_unique_idx")
    .on(table.operationId)
    .where(sql`${table.operationId} is not null`),
  check(
    "market_order_void_fences_state_check",
    sql`${table.state} in ('active', 'non_voidable', 'prepared', 'voided')`,
  ),
]);

/** abort/commit 이전 operationId까지 영구 보존하는 ABA 방지 원장. */
export const marketOrderVoidOperations = pgTable("market_order_void_operations", {
  operationId: text("operation_id").primaryKey(),
  marketOrderId: text("market_order_id")
    .notNull()
    .references(() => marketOrderVoidFences.marketOrderId, { onDelete: "restrict" }),
  orderNumber: text("order_number").notNull(),
  requestFingerprint: text("request_fingerprint").notNull(),
  state: text("state").notNull(), // prepared | aborted | voided
  preparedAt: timestamp("prepared_at").defaultNow().notNull(),
  abortedAt: timestamp("aborted_at"),
  voidedAt: timestamp("voided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("market_order_void_operations_order_id_idx").on(table.marketOrderId),
  check(
    "market_order_void_operations_state_check",
    sql`${table.state} in ('prepared', 'aborted', 'voided')`,
  ),
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
