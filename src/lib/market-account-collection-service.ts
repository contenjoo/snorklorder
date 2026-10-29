import {
  collectionLockKeys, collectionPayloadHash,
  type CollectionRequestIdentity, type CollectionSyncBatch, type CollectionSyncItem,
} from './market-account-collection.ts';

export class CollectionSyncConflict extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable = false) { super(code); this.code = code; this.retryable = retryable; this.name = 'CollectionSyncConflict'; }
}
export type CollectionLedger = {
  collectionId: string; submissionHash: string; payloadHash: string; sourceKind: string;
  marketOrderId: string | null; orderNumber: string | null; requestIds: unknown;
};
export type CollectionRequest = {
  id: number; schoolName: string; type: string; externalSource: string | null;
  marketCollectionId: string | null;
  marketRequestId: string | null; idempotencyKey: string | null; marketOrderId: string | null;
  orderNumber: string | null; draftOnly: boolean; status: string; archivedAt: unknown; confirmedAt: unknown;
  confirmToken: unknown; processingEmailSendStartedAt: unknown; processingEmailSentAt: unknown;
  invoiceEmailSendStartedAt: unknown; invoiceEmailSentAt: unknown; invoiceGmailMessageId: unknown;
  receiptGmailMessageId: unknown; invoiceNumber: unknown; invoiceAmount: unknown; invoiceDueDate: unknown;
  paymentLink: unknown; paymentDate: unknown; paymentMethod: unknown;
};
export type CollectionWrite = {
  emails: string; quantity: number; accountType: 'teacher' | 'admin'; externalPayloadHash: string; marketCollectionId: string;
};
export interface CollectionSyncTransaction {
  lockResources(keys: string[]): Promise<void>;
  readLedger(id: string): Promise<CollectionLedger | undefined>;
  ensureOrderFence(id: string, orderNumber: string): Promise<{ state: string; orderNumber: string } | undefined>;
  findIdentities(items: CollectionSyncItem[]): Promise<CollectionRequest[]>;
  readRequests(ids: number[]): Promise<CollectionRequest[]>;
  hasPreviousSubmission(ids: number[]): Promise<boolean>;
  hasOpenDuplicate(schoolName: string, emails: string[], excludingIds: number[]): Promise<boolean>;
  updateRequest(id: number, values: CollectionWrite): Promise<void>;
  createRequest(batch: CollectionSyncBatch, item: CollectionSyncItem, values: CollectionWrite): Promise<number>;
  insertLedger(ledger: CollectionLedger): Promise<void>;
}
export interface CollectionSyncStore {
  transaction<T>(action: (tx: CollectionSyncTransaction) => Promise<T>): Promise<T>;
}

function identityMatches(row: CollectionRequest, batch: CollectionSyncBatch, item: CollectionSyncItem) {
  return row.externalSource === (batch.source.kind === 'order' ? 'market' : 'market_collection')
    && row.marketRequestId === item.marketRequestId && row.idempotencyKey === item.idempotencyKey && row.draftOnly
    && row.marketOrderId === (batch.source.kind === 'order' ? batch.source.marketOrderId : null)
    && row.orderNumber === (batch.source.kind === 'order' ? batch.source.orderNumber : null);
}
function assertWritable(row: CollectionRequest) {
  if (row.status !== 'draft' || row.archivedAt || row.type !== 'upgrade'
    || row.confirmedAt || row.confirmToken || row.processingEmailSendStartedAt || row.processingEmailSentAt
    || row.invoiceEmailSendStartedAt || row.invoiceEmailSentAt || row.invoiceGmailMessageId || row.receiptGmailMessageId
    || row.invoiceNumber || row.invoiceAmount || row.invoiceDueDate || row.paymentLink || row.paymentDate || row.paymentMethod) {
    throw new CollectionSyncConflict('HQ_DELIVERY_STARTED');
  }
}
function savedIdentities(value: unknown): CollectionRequestIdentity[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30
    || value.some(row => !row || typeof row !== 'object' || typeof row.itemKey !== 'string'
      || typeof row.marketRequestId !== 'string' || !Number.isSafeInteger(row.requestId) || row.requestId < 1)) {
    throw new CollectionSyncConflict('COLLECTION_IDENTITY_CONFLICT');
  }
  return value.map(row => ({ itemKey: row.itemKey, marketRequestId: row.marketRequestId, requestId: row.requestId }));
}

/** All checks, request writes and the immutable submission receipt commit together. No mail is sent. */
export async function syncAccountCollection(batch: CollectionSyncBatch, store: CollectionSyncStore) {
  return store.transaction(async tx => {
    await tx.lockResources(collectionLockKeys(batch));
    const ledger = await tx.readLedger(batch.collectionId);
    if (ledger) {
      if (ledger.submissionHash !== batch.submissionHash || ledger.payloadHash !== batch.payloadHash
        || ledger.sourceKind !== batch.source.kind
        || ledger.marketOrderId !== (batch.source.kind === 'order' ? batch.source.marketOrderId : null)
        || ledger.orderNumber !== (batch.source.kind === 'order' ? batch.source.orderNumber : null)) {
        throw new CollectionSyncConflict('COLLECTION_PAYLOAD_CONFLICT');
      }
      const requests = savedIdentities(ledger.requestIds);
      if (requests.length !== batch.items.length || new Set(requests.map(item => item.requestId)).size !== requests.length) {
        throw new CollectionSyncConflict('COLLECTION_IDENTITY_CONFLICT');
      }
      const rows = await tx.readRequests(requests.map(item => item.requestId));
      for (const item of batch.items) {
        const saved = requests.find(row => row.itemKey === item.itemKey && row.marketRequestId === item.marketRequestId);
        const row = rows.find(row => row.id === saved?.requestId);
        if (!row || !identityMatches(row, batch, item) || row.marketCollectionId !== batch.collectionId) throw new CollectionSyncConflict('COLLECTION_IDENTITY_CONFLICT');
      }
      // A completed/invoiced/cancelled request remains the same successful submission receipt.
      return { requests, duplicate: true };
    }

    if (batch.source.kind === 'order') {
      const fence = await tx.ensureOrderFence(batch.source.marketOrderId, batch.source.orderNumber);
      if (!fence || fence.orderNumber !== batch.source.orderNumber) throw new CollectionSyncConflict('ORDER_IDENTITY_CONFLICT');
      if (fence.state === 'prepared') throw new CollectionSyncConflict('MARKET_REQUEST_VOID_PREPARED', true);
      if (fence.state === 'voided') throw new CollectionSyncConflict('MARKET_REQUEST_VOIDED');
      if (fence.state !== 'active') throw new CollectionSyncConflict('HQ_DELIVERY_STARTED');
    }
    const current = await tx.findIdentities(batch.items);
    const targets = new Map<string, CollectionRequest>();
    for (const item of batch.items) {
      const matches = current.filter(row => row.marketRequestId === item.marketRequestId || row.idempotencyKey === item.idempotencyKey);
      if (batch.source.kind === 'external') {
        if (matches.length) throw new CollectionSyncConflict('COLLECTION_IDENTITY_CONFLICT');
      } else {
        // New purchases send real accounts as the first atomic delivery, with no contact-only draft.
        if (matches.length === 0) continue;
        if (matches.length !== 1 || !identityMatches(matches[0], batch, item)
          || matches[0].schoolName.trim() !== batch.schoolName
          || (matches[0].marketCollectionId && matches[0].marketCollectionId !== batch.collectionId)) throw new CollectionSyncConflict('COLLECTION_IDENTITY_CONFLICT');
        assertWritable(matches[0]); targets.set(item.itemKey, matches[0]);
      }
    }
    const targetIds = [...targets.values()].map(row => row.id);
    if (await tx.hasPreviousSubmission(targetIds)) throw new CollectionSyncConflict('COLLECTION_TARGET_ALREADY_SUBMITTED');
    if (await tx.hasOpenDuplicate(batch.schoolName, batch.items.flatMap(item => item.emails), targetIds)) {
      throw new CollectionSyncConflict('DUPLICATE_ACCOUNT_REQUEST');
    }
    const requests: CollectionRequestIdentity[] = [];
    for (const item of batch.items) {
      const values: CollectionWrite = {
        emails: item.emails.join(', '), quantity: item.quantity, accountType: item.accountType,
        marketCollectionId: batch.collectionId,
        // Pin a new namespace so a late legacy create with the old contact cannot replay over real accounts.
        externalPayloadHash: collectionPayloadHash({ collectionId: batch.collectionId, submissionHash: batch.submissionHash,
          payloadHash: batch.payloadHash, itemKey: item.itemKey }),
      };
      const target = targets.get(item.itemKey);
      const requestId = target ? target.id : await tx.createRequest(batch, item, values);
      if (target) await tx.updateRequest(target.id, values);
      requests.push({ itemKey: item.itemKey, marketRequestId: item.marketRequestId, requestId });
    }
    await tx.insertLedger({ collectionId: batch.collectionId, submissionHash: batch.submissionHash,
      payloadHash: batch.payloadHash, sourceKind: batch.source.kind,
      marketOrderId: batch.source.kind === 'order' ? batch.source.marketOrderId : null,
      orderNumber: batch.source.kind === 'order' ? batch.source.orderNumber : null, requestIds: requests });
    return { requests, duplicate: false };
  });
}
