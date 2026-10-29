import { NextRequest, NextResponse } from 'next/server';
import { createPartnerTransactionDb } from '@/db/transaction';
import { authorizeMarketStatusRequest } from '@/lib/market-status';
import { collectionIdempotencyKey, collectionOriginAllowed, parseCollectionSync, readCollectionBody } from '@/lib/market-account-collection';
import { CollectionSyncConflict, syncAccountCollection } from '@/lib/market-account-collection-service';
import { collectionSyncStore } from '@/lib/market-account-collection-db';
import { getReceiverFulfillmentPausedResponse } from '@/lib/receiver-fulfillment-pause';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const failure = (code: string, status: number, retryable = false) => json({ code, error: code, retryable }, status);

/** Stores real account emails only. Jon/invoice/completion mail remains a separate administrator action. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ collectionId: string }> }) {
  const auth = authorizeMarketStatusRequest(request.headers.get('x-api-key'), process.env.INTEGRATION_API_KEY);
  if (!auth.ok) return failure(auth.error, auth.status);
  if (!collectionOriginAllowed(request.url, request.headers.get('origin'))) return failure('ORIGIN_NOT_ALLOWED', 403);
  const paused = getReceiverFulfillmentPausedResponse();
  if (paused) return paused;
  const { collectionId } = await params;
  let body: unknown;
  try { body = await readCollectionBody(request); }
  catch (error) { return failure(error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INVALID_BODY', error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 400); }
  const parsed = parseCollectionSync(body, collectionId);
  if (!parsed.ok) return failure(parsed.error, 422);
  const batch = parsed.value;
  if (request.headers.get('idempotency-key') !== collectionIdempotencyKey(batch.collectionId, batch.submissionHash)) {
    return failure('IDEMPOTENCY_KEY_MISMATCH', 422);
  }
  let db: ReturnType<typeof createPartnerTransactionDb> | undefined;
  try {
    db = createPartnerTransactionDb();
    const result = await syncAccountCollection(batch, collectionSyncStore(db));
    return json({ success: true, collectionId: batch.collectionId, submissionHash: batch.submissionHash, ...result });
  } catch (error) {
    if (error instanceof CollectionSyncConflict) return failure(error.code, 409, error.retryable);
    // SQL failures may contain account emails; return/log only a fixed code.
    console.error('[market-collections] transaction unavailable');
    return failure('COLLECTION_SYNC_UNAVAILABLE', 503, true);
  } finally {
    if (db) await db.$client.end().catch(() => { console.error('[market-collections] connection close failed'); });
  }
}
