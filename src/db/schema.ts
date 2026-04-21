import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const schools = pgTable("schools", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  nameEn: text("name_en"),
  domain: text("domain"),
  region: text("region"),
  team: text("team"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const schoolRequests = pgTable("school_requests", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull().default("company"), // company | school_store
  name: text("name").notNull(),
  nameEn: text("name_en"),
  region: text("region"),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  rejectReason: text("reject_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
});

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
  invoiceNumber: text("invoice_number"),
  invoiceAmount: text("invoice_amount"),
  invoiceDueDate: text("invoice_due_date"),
  paymentLink: text("payment_link"),
  paymentDate: text("payment_date"),
  paymentMethod: text("payment_method"),
  confirmToken: text("confirm_token").unique(),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const upgradeBatches = pgTable("upgrade_batches", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  teacherIds: text("teacher_ids").notNull(), // JSON array of teacher IDs
  confirmedIds: text("confirmed_ids"), // JSON array of confirmed teacher IDs
  status: text("status").notNull().default("pending"), // pending | confirmed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  confirmedAt: timestamp("confirmed_at"),
});

export const schoolsRelations = relations(schools, ({ many }) => ({
  teachers: many(teachers),
}));

export const teachersRelations = relations(teachers, ({ one }) => ({
  school: one(schools, {
    fields: [teachers.schoolId],
    references: [schools.id],
  }),
}));
