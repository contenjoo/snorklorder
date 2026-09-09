# API 권한 표

최신 운영 main의 협력사 라우트 2개를 보존하고 이메일 확인·재발송·관리자 링크 재발급 3개를 추가했다. 총 49개 라우트다. 모든 권한은 메서드 기준이다.

| 메서드 및 경로 | 요구 권한 |
|---|---|
| `GET /api/account-confirm/[token]` | 범위 제한·만료 확인 토큰 |
| `POST /api/account-confirm/[token]` | 범위 제한·만료 확인 토큰 |
| `POST /api/account-email/batch` | 관리자 세션 |
| `POST /api/account-email/preview` | 관리자 세션 |
| `POST /api/account-email` | 관리자 세션 |
| `GET /api/account-requests/market-legacy-audit` | x-api-key |
| `GET /api/account-requests/market-status` | x-api-key |
| `POST /api/account-requests/market-void` | x-api-key |
| `GET /api/account-requests` | 관리자 세션 |
| `POST /api/account-requests` | 생성: 공개 제한 / 관리자 / Market 키; 변경: 관리자 |
| `GET /api/admin/confirmation-links` | 관리자 세션 |
| `POST /api/admin/confirmation-links` | 관리자 세션 |
| `GET /api/admin/insights` | 관리자 세션 |
| `POST /api/admin/request-paid-domain` | 관리자 세션 |
| `POST /api/admin/resend-failed-upgrades` | 관리자 세션 |
| `GET /api/admin/school-admins` | 관리자 세션 |
| `POST /api/admin/school-admins` | 관리자 세션 |
| `DELETE /api/admin/school-admins` | 관리자 세션 |
| `GET /api/admin/search` | 관리자 세션 |
| `POST /api/admin/send-account-completion` | 관리자 세션 |
| `GET /api/admin/summary` | 관리자 세션 |
| `POST /api/admin/sync-billing` | 관리자 세션 |
| `POST /api/admin/verify-teacher` | 관리자 세션 |
| `POST /api/auth` | 공개; 요청 제한 |
| `GET /api/confirm/[token]` | 범위 제한·만료 확인 토큰 |
| `POST /api/confirm/[token]` | 범위 제한·만료 확인 토큰 |
| `GET /api/cron/daily-digest` | Bearer CRON_SECRET 또는 x-api-key |
| `GET /api/cron/school-drift` | Bearer CRON_SECRET 또는 x-api-key |
| `GET /api/cron/sync-billing` | Bearer CRON_SECRET 또는 x-api-key |
| `POST /api/cron/sync-billing` | Bearer CRON_SECRET 또는 x-api-key |
| `GET /api/cron/verification-maintenance` | Bearer CRON_SECRET 또는 x-api-key |
| `POST /api/cron/verification-maintenance` | Bearer CRON_SECRET 또는 x-api-key |
| `GET /api/domain-confirm/[token]` | 범위 제한·만료 확인 토큰 |
| `POST /api/domain-confirm/[token]` | 범위 제한·만료 확인 토큰 |
| `GET /api/domain-requests` | 관리자 세션 |
| `POST /api/domain-requests` | 관리자 세션 |
| `GET /api/invoice` | 별도 조회 토큰; 읽기 전용 |
| `POST /api/partner/auth` | 공개; 요청 제한 |
| `GET /api/partner/auth` | 공개; 요청 제한 |
| `GET /api/partner` | 관리자 또는 파트너 세션 |
| `PATCH /api/partner` | Jon/Cailie 역할 |
| `POST /api/register/batch` | 공개; 요청 제한 |
| `POST /api/register/resend` | 공개; 요청 제한 |
| `POST /api/register` | 공개; 요청 제한 |
| `POST /api/register/verify` | 공개; 요청 제한; 토큰·동일 출처 |
| `POST /api/school/login` | 로그인 요청 공개; 확인 POST는 브라우저 바인딩·동일 출처·일회용 토큰 |
| `GET /api/school/login/verify/[token]` | 로그인 요청 공개; 확인 POST는 브라우저 바인딩·동일 출처·일회용 토큰 |
| `POST /api/school/login/verify/[token]` | 로그인 요청 공개; 확인 POST는 브라우저 바인딩·동일 출처·일회용 토큰 |
| `GET /api/school/summary` | 학교 세션 및 해당 학교 범위 |
| `PATCH /api/school/teachers/[id]` | 학교 세션 및 해당 학교 범위 |
| `DELETE /api/school/teachers/[id]` | 학교 세션 및 해당 학교 범위 |
| `POST /api/school/teachers` | 학교 세션 및 해당 학교 범위 |
| `POST /api/school-requests/approve` | 관리자 세션 |
| `POST /api/school-requests` | 공개; 요청 제한 |
| `GET /api/school-requests` | 관리자 세션 |
| `GET /api/schools/lookup` | 공개 학교 식별 정보 |
| `GET /api/schools` | 관리자 세션 |
| `POST /api/schools` | 관리자 세션 |
| `PATCH /api/schools` | 관리자 세션 |
| `DELETE /api/schools` | 관리자 세션 |
| `GET /api/schools/search` | 공개 학교 식별 정보 |
| `POST /api/send-email` | 관리자 세션 |
| `POST /api/sync-group-purchase` | x-api-key |
| `GET /api/teachers` | 관리자 세션 |
| `PATCH /api/teachers` | 관리자 세션 |
| `DELETE /api/teachers` | 관리자 세션 |
| `POST /api/translate` | 공개; 요청 제한 |

| `PUT /api/account-requests/market-partner/[partnerRequestId]` | Market x-api-key; 협력사 버전·상태 검증 |
| `POST /api/admin/partner-approval-notification` | 관리자 세션 |

## 운영 전환

0019 마이그레이션은 명시적인 DATABASE_URL과 SECURITY_MIGRATION_APPLY=confirmed로 실행한다. 기존 확인 링크는 첫 적용 시각부터 7일만 유예하며 재실행해도 연장하지 않는다. ADMIN_SESSION_SECRET 및 SCHOOL_SESSION_SECRET은 각각 별도 설정한다. BILLING_AUTH_VERIFIED=true는 정상·위조 메일 검증 이후에만 설정한다. PUBLIC_REGISTRATION_ENABLED=false로 신규 공개 등록을 일시 중지할 수 있다.

## 검증 방법

`npm run test:contracts`, `npm run lint`, `npm run build`를 실행한다. 격리 DB 테스트는 `SECURITY_TEST_DATABASE_URL=postgresql://contenjoo@127.0.0.1:55439/postgres node --test scripts/security-db.test.mjs scripts/security-rate.test.mjs`로 실행하며 다른 호스트를 거절한다. HTTP 테스트는 DB와 SMTP를 모의 어댑터로 바꾼 별도 임시 앱에서만 `SECURITY_HTTP_TEST=local node --test scripts/security-http.test.mjs`로 실행한다. 운영 URL에는 이 테스트를 실행하지 않는다.
