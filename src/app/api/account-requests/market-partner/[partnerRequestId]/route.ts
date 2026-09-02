import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createPartnerTransactionDb } from '@/db/transaction';
import { accountRequests, partnerRequestOperations } from '@/db/schema';
import { authorizeMarketStatusRequest } from '@/lib/market-status';
import { parsePartnerBatch } from '@/lib/partner-product-request';

class PartnerBatchConflict extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ partnerRequestId: string }> }) {
  const auth = authorizeMarketStatusRequest(req.headers.get('x-api-key'), process.env.INTEGRATION_API_KEY);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const partnerRequestId = (await params).partnerRequestId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/.test(partnerRequestId)) {
    return NextResponse.json({ error: 'Invalid partner request id' }, { status: 422 });
  }
  const parsed = parsePartnerBatch(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const batch = parsed.value;
  const db = createPartnerTransactionDb();

  try {
    const result = await db.transaction(async (tx) => {
      // partnerRequestId는 위 정규식으로 작은따옴표·공백을 허용하지 않는다.
      await tx.execute(sql.raw("SELECT pg_advisory_xact_lock(hashtext('" + partnerRequestId + "'))"));
      await tx.execute(sql.raw("SELECT id FROM account_requests WHERE partner_request_id = '" + partnerRequestId + "' FOR UPDATE"));

      const [operation] = await tx.select().from(partnerRequestOperations)
        .where(eq(partnerRequestOperations.operationId, batch.operationId)).limit(1);
      if (operation) {
        const same = operation.partnerRequestId === partnerRequestId
          && operation.revision === batch.revision
          && operation.mode === batch.mode
          && operation.payloadHash === batch.payloadHash;
        if (!same) throw new PartnerBatchConflict('OPERATION_ID_CONFLICT');
        return { duplicate: true };
      }

      // 취소가 최초 수신되어 account_requests 행이 아직 없어도 최고 revision은
      // operation 원장에 남는다. 이를 확인해야 늦게 도착한 과거 upsert가 취소 건을
      // 되살리지 못한다.
      const [latestOperation] = await tx.select().from(partnerRequestOperations)
        .where(eq(partnerRequestOperations.partnerRequestId, partnerRequestId))
        .orderBy(desc(partnerRequestOperations.revision), desc(partnerRequestOperations.createdAt))
        .limit(1);
      if (latestOperation?.revision != null && latestOperation.revision > batch.revision) {
        throw new PartnerBatchConflict('STALE_REVISION');
      }
      if (latestOperation?.revision === batch.revision) {
        if (latestOperation.mode !== batch.mode || latestOperation.payloadHash !== batch.payloadHash) {
          throw new PartnerBatchConflict('REVISION_PAYLOAD_CONFLICT');
        }
        await tx.insert(partnerRequestOperations).values({
          operationId: batch.operationId,
          partnerRequestId,
          revision: batch.revision,
          mode: batch.mode,
          payloadHash: batch.payloadHash,
        });
        return { duplicate: true };
      }
      if (latestOperation?.mode === 'cancel' && batch.mode === 'upsert') {
        throw new PartnerBatchConflict('CANCELLED_REQUEST');
      }

      const current = await tx.select().from(accountRequests)
        .where(eq(accountRequests.partnerRequestId, partnerRequestId));
      if (current.some((row) => (row.partnerRevision ?? 0) > batch.revision)) {
        throw new PartnerBatchConflict('STALE_REVISION');
      }
      if (current.some((row) => row.processingEmailSendStartedAt || row.processingEmailSentAt
        || row.confirmedAt || row.status !== 'draft')) {
        throw new PartnerBatchConflict('HQ_DELIVERY_STARTED');
      }
      const sameRevision = current.filter((row) => row.partnerRevision === batch.revision);
      if (sameRevision.length > 0) {
        if (sameRevision.some((row) => row.partnerPayloadHash !== batch.payloadHash)) {
          throw new PartnerBatchConflict('REVISION_PAYLOAD_CONFLICT');
        }
        await tx.insert(partnerRequestOperations).values({
          operationId: batch.operationId,
          partnerRequestId,
          revision: batch.revision,
          mode: batch.mode,
          payloadHash: batch.payloadHash,
        });
        return { duplicate: true };
      }

      if (batch.mode === 'cancel') {
        await tx.update(accountRequests).set({
          partnerRevision: batch.revision,
          partnerPayloadHash: batch.payloadHash,
          partnerLifecycleState: 'cancelled',
          updatedAt: new Date(),
        }).where(eq(accountRequests.partnerRequestId, partnerRequestId));
      } else {
        if (current.length > 0) {
          await tx.update(accountRequests).set({
            partnerRevision: batch.revision,
            partnerPayloadHash: batch.payloadHash,
            partnerLifecycleState: 'cancelled',
            updatedAt: new Date(),
          }).where(eq(accountRequests.partnerRequestId, partnerRequestId));
        }
        for (const item of batch.items) {
          const updated = await tx.update(accountRequests).set({
            schoolName: batch.schoolName,
            schoolNameEn: batch.schoolNameEn,
            emails: item.accountEmail,
            teacherName: item.teacherName,
            subject: item.subject,
            notes: 'Teacher: ' + item.teacherName + '\nSubject: ' + item.subject,
            needsInvoice: true,
            partnerRevision: batch.revision,
            partnerPayloadHash: batch.payloadHash,
            partnerLifecycleState: 'active',
            updatedAt: new Date(),
          }).where(and(
            eq(accountRequests.partnerRequestId, partnerRequestId),
            eq(accountRequests.partnerItemId, item.itemId),
          )).returning({ id: accountRequests.id });
          if (updated.length === 0) {
            await tx.insert(accountRequests).values({
              channel: 'partner',
              applicantType: 'school',
              type: 'upgrade',
              schoolName: batch.schoolName,
              schoolNameEn: batch.schoolNameEn,
              emails: item.accountEmail,
              accountType: 'teacher',
              quantity: 1,
              needsInvoice: true,
              status: 'draft',
              draftOnly: true,
              externalSource: 'market_partner',
              marketRequestId: 'partner:' + partnerRequestId + ':' + item.itemId,
              idempotencyKey: 'partner:' + partnerRequestId + ':' + item.itemId,
              partnerRequestId,
              partnerItemId: item.itemId,
              partnerRevision: batch.revision,
              partnerPayloadHash: batch.payloadHash,
              teacherName: item.teacherName,
              subject: item.subject,
              notes: 'Teacher: ' + item.teacherName + '\nSubject: ' + item.subject,
            });
          }
        }
      }
      await tx.insert(partnerRequestOperations).values({
        operationId: batch.operationId,
        partnerRequestId,
        revision: batch.revision,
        mode: batch.mode,
        payloadHash: batch.payloadHash,
      });
      return { duplicate: false };
    });
    return NextResponse.json({
      success: true,
      duplicate: result.duplicate,
      deliveryMode: 'manual_only',
      needsInvoice: true,
    });
  } catch (error) {
    if (error instanceof PartnerBatchConflict) {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    console.error('[market-partner] batch failed', error);
    return NextResponse.json({ error: 'Partner batch failed' }, { status: 500 });
  } finally {
    await db.$client.end().catch(() => {
      console.error('[market-partner] failed to close transaction connection');
    });
  }
}
