# Market 계정정보 수신

`PUT /api/account-requests/market-collections/[collectionId]`는 구매자가 최종 제출한 계정 이메일을 저장한다. 본사 요청·인보이스·완료 메일은 보내지 않으며, 처리·결제 상태를 변경하지 않는다.

인증은 기존 `INTEGRATION_API_KEY`의 `x-api-key` 전용이다. 세션 인증 폴백은 없다. `Idempotency-Key`는 `market:snorkl:collection:{collectionId}:{submissionHash}`다. 서버 간 요청은 Origin 없이 호출할 수 있고, 브라우저 Origin은 수신 서비스 자체와 구매센터 운영 주소만 허용한다. JSON 본문은 실제 스트림 기준 128 KiB 이하로 제한한다.

본문:

```json
{
  "collectionId": "collection-123",
  "submissionHash": "64자리 소문자 SHA-256",
  "schoolName": "예시중학교",
  "draftOnly": true,
  "source": { "kind": "order", "marketOrderId": "order-123", "orderNumber": "ORD-123" },
  "items": [{
    "itemKey": "상품별 고정 키",
    "marketRequestId": "Market SnorklRequest ID",
    "idempotencyKey": "market:snorkl:draft:order-123:0",
    "accountType": "teacher",
    "quantity": 1,
    "emails": ["teacher@school.kr"],
    "planName": "Teacher"
  }]
}
```

- 일반 주문은 고정된 `market` 요청의 식별자를 보낸다. 원격 초안이 없으면 실계정 초안과 active 취소 fence를 같은 트랜잭션에서 만들고, 기존 초안이 있으면 정확한 identity를 확인한 뒤 반영한다. 별도의 연락처 전용 초안을 먼저 보내지 않는다. `s2b-` 주문을 일반 주문으로 전달할 수 없다.
- 독립 외부 주문은 `source: { "kind": "external" }`, 항목 멱등키 `market:snorkl:collection:{collectionId}:{index}`를 쓴다. `market_collection`·`school_store` 초안을 만들고 `marketOrderId`와 `orderNumber`는 null로 유지한다. 실제 Market 주문을 위조하지 않는다.
- Teacher 수량은 이메일 개수와 같아야 하고 School(`admin`)은 1개다. 전체 200계정·30항목 이하이며 중복 이메일과 항목 식별자는 거부한다.
- 같은 collection·제출 해시·정규화 본문은 처리·청구·결제 상태가 이후 바뀌어도 원본 요청 identity를 재검사한 뒤 동일 ID를 반환한다. 이메일 순서와 항목 순서는 정규화한다. 다른 내용은 `COLLECTION_PAYLOAD_CONFLICT`(409)다.
- 첫 반영은 collection·주문·이메일 advisory lock과 기존 주문 취소 fence, 대상 row lock을 같은 트랜잭션에서 검사한다. 발송 시작·처리확정·청구·결제 근거가 있는 대상과 취소 fence는 변경하지 않는다. 모든 항목과 제출 원장은 함께 커밋되거나 전부 롤백된다.
- 같은 학교·실계정의 미보관·미확정 upgrade가 draft/sent/invoiced/paid 상태로 다른 요청에 있으면 `DUPLICATE_ACCOUNT_REQUEST`(409)로 보류한다. 청구·결제만으로 본사 처리 완료를 추정하지 않는다. DB trigger도 모든 수동·협력사·기존 writer에서 같은 학교·이메일 잠금을 잡아, 어느 쪽이 먼저 저장하더라도 collection 관련 중복을 거부한다. 기존 non-collection끼리의 과거 중복과 처리 완료 계정·기간 연장은 보존한다.
- `GET /api/account-requests/market-status`는 기존 필드·권한으로 `market_collection`의 source identity도 되읽을 수 있다.

성공 응답은 `{ success: true, collectionId, submissionHash, requests: [{ itemKey, marketRequestId, requestId }], duplicate }`다. 계정 이메일·토큰은 응답하지 않는다. 오류는 `{ code, error, retryable }`를 반환한다. 취소 준비 중(`MARKET_REQUEST_VOID_PREPARED`)은 같은 요청으로 재시도할 수 있고, 취소 완료·본사 처리 시작 등 다른 409는 검토가 필요하다. 503은 제출 원장을 유지한 채 같은 요청으로 재시도할 수 있다.

배포 순서는 수신 서비스의 additive migration → 수신 API → Market 송신 기능 활성화다. `0028_market_account_collection_sync.sql`은 새 제출 원장·nullable `market_collection_id`·불변 및 중복 보호 trigger를 만들며 기존 요청을 소급 반영하거나 수정·삭제하지 않는다. 적용 스크립트는 기본 조회 전용이다.

```sh
node scripts/apply-0028.mjs --env-file /승인된/환경파일
# 별도 운영 적용 승인 후에만:
ACCOUNT_COLLECTION_MIGRATION_APPLY=confirmed node scripts/apply-0028.mjs --env-file /승인된/환경파일 --apply
```

로컬 검증은 `node --test scripts/market-account-collection.test.mjs`, `npm run test:contracts`, `npx tsc --noEmit`, `npm run build`로 수행한다. 메모리 트랜잭션 테스트는 PostgreSQL 실경합 검증과 구분한다.
