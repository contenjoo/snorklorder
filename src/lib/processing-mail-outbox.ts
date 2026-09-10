import { randomUUID } from 'node:crypto';
import type { Transporter, SendMailOptions } from 'nodemailer';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import type { SentRequestSnapshot } from './processing-mail';

export async function sendTrackedProcessingMail(transporter: Transporter, mail: SendMailOptions, requests: (Omit<SentRequestSnapshot, 'emails'> & {emails:string|string[]})[]) {
  const messageId = `<${randomUUID()}@learntoday.kr>`;
  const snapshots = requests.map(({ id, emails, type, accountType, quantity, extensionDate }) =>
    ({ id, emails: Array.isArray(emails) ? emails.join(', ') : emails, type, accountType, quantity, extensionDate }));
  await db.execute(sql`INSERT INTO processing_mail_outbox(message_id,snapshots,state) VALUES (${messageId},${JSON.stringify(snapshots)}::jsonb,'prepared')`);
  await transporter.sendMail({ ...mail, messageId });
  await db.execute(sql`UPDATE processing_mail_outbox SET state='sent',sent_at=now() WHERE message_id=${messageId}`);
}
