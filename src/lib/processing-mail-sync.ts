import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { accountRequests } from '@/db/schema';
import { createPartnerTransactionDb } from '@/db/transaction';
import { isReceiverFulfillmentPaused } from './receiver-fulfillment-pause';
import { pendingProcessingConfirmationCondition, processingConfirmationValues } from './processing-confirmation-db';
import { planProcessingReply, sameEmails, type ProcessingReply, type SentRequestSnapshot } from './processing-mail';
import { fetchProcessingReplies } from './processing-mail-imap';

export type ProcessingSyncItem = { requestId: number; outcome: string; reason: string };
export type ProcessingSyncResult = { scanned: number; applied: number[]; alreadyConfirmed: number[]; review: ProcessingSyncItem[]; incomplete: boolean; dryRun: boolean; paused?: boolean; error?: string };
type Row = typeof accountRequests.$inferSelect;
function snapshotMatches(row: Row, s: SentRequestSnapshot) {
  return sameEmails(row.emails, s.emails) && row.type === s.type && row.accountType === s.accountType
    && row.quantity === s.quantity && (row.type !== 'extension' || row.extensionDate === s.extensionDate);
}
const sentCondition = () => and(pendingProcessingConfirmationCondition(),
  inArray(accountRequests.status, ['sent','invoiced','paid']),
  sql`${accountRequests.processingEmailSentAt} IS NOT NULL`,
  sql`${accountRequests.processingEmailSendStartedAt} IS NULL`,
  inArray(accountRequests.type, ['upgrade','extension']), inArray(accountRequests.accountType, ['teacher','student']));

/** Evidence and state changes share a transaction. This path deliberately sends no notifications. */
export async function recordProcessingReply(reply: ProcessingReply, options: { dryRun?: boolean; allowRequestIds?: number[] } = {}) {
  const plan = planProcessingReply(reply);
  const database = createPartnerTransactionDb();
  try {
    return await database.transaction(async tx => {
      if (options.dryRun) await tx.execute(sql`SET TRANSACTION READ ONLY`);
      const ids = plan.related;
      const rows = ids.length ? await tx.select().from(accountRequests).where(inArray(accountRequests.id, ids)) : [];
      const eligible = ids.length ? await tx.select().from(accountRequests).where(and(inArray(accountRequests.id, ids), sentCondition())) : [];
      const selectedValid = plan.selected.every(id => {
        const r = rows.find(r => r.id === id), s = reply.snapshots.find(s => s.id === id);
        return r && s && snapshotMatches(r,s) && r.processingEmailSentAt
          && r.processingEmailSentAt.getTime() <= Date.parse(reply.receivedAt)
          && (r.confirmedAt || eligible.some(e => e.id === id));
      });
      if (!options.dryRun) {
        await tx.execute(sql`INSERT INTO processing_mail_evidence(message_id,parent_id,sender,received_at,gmail_id,authenticated,source_verified,excerpt,reason,snapshots,selected_ids,incomplete)
          VALUES (${reply.messageId},${reply.parentId},${reply.sender},${reply.receivedAt}::timestamptz,${reply.gmailId || null},${reply.authenticated},${reply.sourceVerified},${plan.evidence},${plan.reason},${JSON.stringify(reply.snapshots)}::jsonb,${JSON.stringify(plan.selected)}::jsonb,${!!reply.incomplete})
          ON CONFLICT(message_id) DO UPDATE SET parent_id=EXCLUDED.parent_id,source_verified=EXCLUDED.source_verified,reason=EXCLUDED.reason,snapshots=EXCLUDED.snapshots,selected_ids=EXCLUDED.selected_ids,incomplete=EXCLUDED.incomplete,updated_at=now()
          WHERE processing_mail_evidence.incomplete=true`);
        await tx.execute(sql`UPDATE processing_mail_evidence SET updated_at=now() WHERE message_id=${reply.messageId}`);
        // A stable message lock serializes duplicate automatic/manual decisions.
        await tx.execute(sql`SELECT message_id FROM processing_mail_evidence WHERE message_id=${reply.messageId} FOR UPDATE`);
      }
      const output: ProcessingSyncItem[] = [];
      for (const r of rows) {
        const previous = await tx.execute(sql`SELECT outcome,reason FROM processing_mail_decisions WHERE message_id=${reply.messageId} AND request_id=${r.id}`);
        if (previous.rows[0] && previous.rows[0].outcome !== 'review') {
          output.push({ requestId:r.id, outcome:previous.rows[0].outcome === 'applied' ? 'already_confirmed' : String(previous.rows[0].outcome), reason:String(previous.rows[0].reason) }); continue;
        }
        const selected = selectedValid && plan.selected.includes(r.id);
        const allowed = !options.allowRequestIds || options.allowRequestIds.includes(r.id);
        let outcome = 'review';
        let reason = !selectedValid ? '현재 요청 정보 또는 처리 가능 상태가 발송 당시와 다름'
          : !selected ? (plan.selected.length ? '이전 메일에만 등장: 직접 완료 대상 아님' : plan.reason)
          : !allowed ? '이번 운영 반영 대상 아님' : plan.reason;
        if (r.confirmedAt) { outcome = 'already_confirmed'; reason = '이미 처리 확인됨'; }
        else if (selected && allowed) {
          if (options.dryRun) outcome = 'would_apply';
          else if (process.env.PROCESSING_MAIL_SYNC_ENABLED !== 'true' || isReceiverFulfillmentPaused()) reason = '자동 반영 일시 중지';
          else {
            // Match the existing confirmation fence protocol inside this transaction.
            const claim = await tx.execute(sql`SELECT claim_market_request_side_effects(ARRAY[${r.id}]::integer[]) AS claimed`);
            if (claim.rows[0]?.claimed !== true) throw new Error('Processing completion fence rejected');
            const [locked] = await tx.select().from(accountRequests).where(eq(accountRequests.id,r.id)).for('update');
            const snapshot = reply.snapshots.find(s => s.id === r.id)!;
            if (!locked || !snapshotMatches(locked,snapshot) || !locked.processingEmailSentAt || locked.processingEmailSentAt.getTime()>Date.parse(reply.receivedAt)) throw new Error('Processing request changed during confirmation');
            if (locked.confirmedAt) outcome = 'already_confirmed';
            else {
              const updated = await tx.update(accountRequests).set(processingConfirmationValues()).where(and(eq(accountRequests.id,r.id),sentCondition())).returning({id:accountRequests.id});
              if (!updated.length) throw new Error('Processing request changed during confirmation');
              outcome = 'applied';
            }
          }
        }
        if (!options.dryRun) await tx.execute(sql`INSERT INTO processing_mail_decisions(message_id,request_id,outcome,reason) VALUES (${reply.messageId},${r.id},${outcome},${reason}) ON CONFLICT(message_id,request_id) DO UPDATE SET outcome=EXCLUDED.outcome,reason=EXCLUDED.reason,updated_at=now() WHERE processing_mail_decisions.outcome='review'`);
        output.push({ requestId:r.id,outcome,reason });
      }
      return { plan, items:output };
    });
  } finally { await database.$client.end(); }
}

export async function runProcessingMailSync(options: { dryRun?: boolean; newerThanDays?: number; maxPerKind?: number; allowRequestIds?: number[] } = {}): Promise<ProcessingSyncResult> {
  const result: ProcessingSyncResult = {scanned:0,applied:[],alreadyConfirmed:[],review:[],incomplete:false,dryRun:!!options.dryRun};
  if (isReceiverFulfillmentPaused()) return {...result,paused:true};
  const collected = await fetchProcessingReplies(options);
  result.scanned = collected.replies.length; result.incomplete = collected.incomplete;
  for (const reply of collected.replies) {
    const {items} = await recordProcessingReply(reply,options);
    for (const item of items) {
      if (item.outcome === 'applied' || item.outcome === 'would_apply') result.applied.push(item.requestId);
      else if (item.outcome === 'already_confirmed') result.alreadyConfirmed.push(item.requestId);
      else if (item.outcome === 'review') result.review.push(item);
    }
  }
  if (!options.dryRun) {
    const c = collected.checkpoint;
    await db.execute(sql`INSERT INTO processing_mail_cursor(mailbox,uid_validity,last_uid) VALUES (${c.mailbox},${c.validity},${c.lastUid}) ON CONFLICT(mailbox) DO UPDATE SET last_uid=CASE WHEN processing_mail_cursor.uid_validity=EXCLUDED.uid_validity THEN greatest(processing_mail_cursor.last_uid,EXCLUDED.last_uid) ELSE EXCLUDED.last_uid END,uid_validity=EXCLUDED.uid_validity,updated_at=now()`);
  }
  result.applied = [...new Set(result.applied)]; result.alreadyConfirmed = [...new Set(result.alreadyConfirmed)];
  return result;
}

export async function reviewProcessingMail(messageId: string, requestId: number, action: 'confirm'|'exclude', note: string) {
  if (isReceiverFulfillmentPaused()) throw new Error('PROCESSING_PAUSED');
  const database = createPartnerTransactionDb();
  try { return await database.transaction(async tx => {
    const evidence = await tx.execute(sql`SELECT * FROM processing_mail_evidence WHERE message_id=${messageId} FOR UPDATE`);
    const e = evidence.rows[0];
    const decision = await tx.execute(sql`SELECT outcome FROM processing_mail_decisions WHERE message_id=${messageId} AND request_id=${requestId}`);
    if (!e || decision.rows[0]?.outcome !== 'review') throw new Error('REVIEW_NOT_PENDING');
    if (action === 'confirm') {
      const snapshot = (e.snapshots as SentRequestSnapshot[]).find(s => s.id === requestId);
      const [row] = await tx.select().from(accountRequests).where(and(eq(accountRequests.id,requestId),sentCondition()));
      if (!e.authenticated || !e.source_verified || e.incomplete || !row || !snapshot || !snapshotMatches(row,snapshot) || !row.processingEmailSentAt || row.processingEmailSentAt.getTime()>new Date(String(e.received_at)).getTime()) throw new Error('REVIEW_SCOPE_INVALID');
      const claim = await tx.execute(sql`SELECT claim_market_request_side_effects(ARRAY[${requestId}]::integer[]) AS claimed`);
      if (claim.rows[0]?.claimed !== true) throw new Error('REVIEW_FENCED');
      const [locked] = await tx.select().from(accountRequests).where(eq(accountRequests.id,requestId)).for('update');
      if (!locked || !snapshotMatches(locked,snapshot) || !locked.processingEmailSentAt || locked.processingEmailSentAt.getTime()>new Date(String(e.received_at)).getTime()) throw new Error('REVIEW_STATE_CHANGED');
      const updated = await tx.update(accountRequests).set(processingConfirmationValues()).where(and(eq(accountRequests.id,requestId),sentCondition())).returning({id:accountRequests.id});
      if (!updated.length) throw new Error('REVIEW_STATE_CHANGED');
    }
    await tx.execute(sql`UPDATE processing_mail_decisions SET outcome=${action === 'confirm' ? 'applied' : 'excluded'},reason=${note},reviewed_by='admin',updated_at=now() WHERE message_id=${messageId} AND request_id=${requestId}`);
    return {ok:true};
  }); } finally {await database.$client.end();}
}
