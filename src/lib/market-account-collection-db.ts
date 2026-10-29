import { and, asc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { createPartnerTransactionDb } from '@/db/transaction';
import { accountRequests, marketAccountCollectionSync, marketOrderVoidFences, schools } from '@/db/schema';
import { CollectionSyncConflict, type CollectionSyncStore, type CollectionSyncTransaction } from './market-account-collection-service';
import { collectionWriteErrorCode } from './market-account-collection';

function fixedDatabaseConflict(error: unknown): CollectionSyncConflict | null {
  const collectionCode = collectionWriteErrorCode(error);
  if (collectionCode) return new CollectionSyncConflict(collectionCode);
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const value = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (value.code === '23505') return new CollectionSyncConflict(value.message === 'DUPLICATE_ACCOUNT_REQUEST'
      ? 'DUPLICATE_ACCOUNT_REQUEST' : 'COLLECTION_IDENTITY_CONFLICT');
    current = value.cause;
  }
  return null;
}

/** Neon interactive transaction, shared by every item and its immutable submission receipt. */
export function collectionSyncStore(db: ReturnType<typeof createPartnerTransactionDb>): CollectionSyncStore {
  return {
    transaction: async action => {
      try { return await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '10000ms'`);
      await tx.execute(sql`SET LOCAL lock_timeout = '5000ms'`);
      const store: CollectionSyncTransaction = {
        async lockResources(keys) {
          for (const key of keys) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
        },
        async readLedger(id) {
          const [row] = await tx.select().from(marketAccountCollectionSync).where(eq(marketAccountCollectionSync.collectionId, id));
          return row;
        },
        async ensureOrderFence(id, orderNumber) {
          // The same fence/unique constraints also serialize a concurrent legacy create.
          await tx.insert(marketOrderVoidFences).values({ marketOrderId: id, orderNumber, state: 'active' })
            .onConflictDoNothing({ target: marketOrderVoidFences.marketOrderId });
          const [row] = await tx.select({ state: marketOrderVoidFences.state, orderNumber: marketOrderVoidFences.orderNumber })
            .from(marketOrderVoidFences).where(eq(marketOrderVoidFences.marketOrderId, id)).for('update');
          return row;
        },
        async findIdentities(items) {
          return tx.select().from(accountRequests).where(or(
            inArray(accountRequests.marketRequestId, items.map(item => item.marketRequestId)),
            inArray(accountRequests.idempotencyKey, items.map(item => item.idempotencyKey)),
          )).orderBy(asc(accountRequests.id)).for('update');
        },
        async readRequests(ids) {
          return tx.select().from(accountRequests).where(inArray(accountRequests.id, ids)).orderBy(asc(accountRequests.id)).for('update');
        },
        async hasPreviousSubmission(ids) {
          if (!ids.length) return false;
          const [row] = await tx.select({ id: marketAccountCollectionSync.collectionId }).from(marketAccountCollectionSync).where(or(
            ...ids.map(requestId => sql`${marketAccountCollectionSync.requestIds} @> ${JSON.stringify([{ requestId }])}::jsonb`),
          )).limit(1);
          return Boolean(row);
        },
        async hasOpenDuplicate(schoolName, emails, excludingIds) {
          const [row] = await tx.select({ id: accountRequests.id }).from(accountRequests).where(and(
            sql`lower(btrim(${accountRequests.schoolName})) = ${schoolName.toLowerCase()}`,
            eq(accountRequests.type, 'upgrade'), inArray(accountRequests.status, ['draft', 'sent', 'invoiced', 'paid']),
            isNull(accountRequests.archivedAt), isNull(accountRequests.confirmedAt),
            ...(excludingIds.length ? [notInArray(accountRequests.id, excludingIds)] : []),
            sql`EXISTS (SELECT 1 FROM regexp_split_to_table(lower(${accountRequests.emails}), '[,;[:space:]]+') AS candidate(email)
              WHERE btrim(candidate.email) IN (${sql.join(emails.map(email => sql`${email}`), sql`, `)}))`,
          )).limit(1);
          return Boolean(row);
        },
        async updateRequest(id, values) {
          await tx.update(accountRequests).set({ ...values, updatedAt: new Date() }).where(eq(accountRequests.id, id));
        },
        async createRequest(batch, item, values) {
          const [school] = await tx.select({ nameEn: schools.nameEn }).from(schools).where(eq(schools.name, batch.schoolName)).limit(1);
          const [row] = await tx.insert(accountRequests).values({
            ...values, schoolName: batch.schoolName, schoolNameEn: school?.nameEn ?? null,
            channel: batch.source.kind === 'order' ? 'company' : 'school_store',
            applicantType: 'school', type: 'upgrade', status: 'draft', draftOnly: true,
            needsInvoice: true, externalSource: batch.source.kind === 'order' ? 'market' : 'market_collection', marketRequestId: item.marketRequestId,
            idempotencyKey: item.idempotencyKey,
            marketOrderId: batch.source.kind === 'order' ? batch.source.marketOrderId : null,
            orderNumber: batch.source.kind === 'order' ? batch.source.orderNumber : null,
            notes: `Market 계정정보 접수 · ${batch.collectionId} · ${item.planName}`,
          }).returning({ id: accountRequests.id });
          if (!row) throw new Error('COLLECTION_INSERT_FAILED');
          return row.id;
        },
        async insertLedger(ledger) { await tx.insert(marketAccountCollectionSync).values(ledger); },
      };
      return action(store);
      }); } catch (error) { throw fixedDatabaseConflict(error) ?? error; }
    },
  };
}
