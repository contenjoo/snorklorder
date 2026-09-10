# Jon 처리 완료 메일 동기화

`/api/admin/sync-billing` 버튼과 기존 크론에서 청구 처리 후 Jon 답장을 수집한다. 자동 반영은 `PROCESSING_MAIL_SYNC_ENABLED=true`에서만 활성화되며, `RECEIVER_FULFILLMENT_PAUSED`가 우선한다. 응답의 `processing`은 처리 완료·이미 완료·검토·추가 수집 필요를 구분한다. `dryRun`에서는 근거 테이블과 커서도 변경하지 않는다.

`drizzle/0020_processing_mail_sync.sql`은 기존 요청을 수정하지 않는 재실행 가능한 추가 마이그레이션이다. 운영 적용은 `PROCESSING_MAIL_MIGRATION_APPLY=confirmed node scripts/apply-0020.mjs --apply`로 명시한다. 이후 검증된 Preview/Production 배포를 적용한다.

자동 판별은 Jon의 정확한 발신 주소와 Gmail 수신 인증, 실제 Sent 메일의 답장 연결, 당시 요청 번호·이메일·수량·유형·연장일을 확인한다. 판별 가능한 문장만 자동 처리하고 나머지는 검토로 남긴다. 인용문은 완료 근거가 아니다. 새 발송은 Message-ID와 대상 스냅샷을 SMTP 전에 기록하며, 불명확한 SMTP 결과는 기존 재발송 차단을 유지한다.

수집은 Gmail All Mail을 읽기 전용으로 열고 기본 14일·10통씩 UID 순으로 진행한다. 45초 수집/90초 해석 예산에 도달하면 미완료로 응답하고 기록이 끝난 UID까지만 커서를 전진시킨다. 선행 메일 누락은 별도로 재수집한다. IMAP UIDVALIDITY 변경 시 새 커서를 사용하고 Message-ID 원장으로 중복을 막는다. 두 동기화 엔드포인트의 실행 한도는 300초다. 수집 한도/실패 시 관리자에게 재시도 필요를 표시한다.

검토 화면은 `/admin/processing-mail`이다. 수동 확정도 관리자 인증·동일 출처·근거 입력·유효 대상 검사를 거친다. 결제 상태는 보존하며 모든 완료 경로는 추가 메일을 보내지 않는다. 인용문에만 있는 요청은 관리자가 별도 근거를 확인하기 전 완료로 확정하지 않는다.

검증: `npm run test:contracts`, `JON_TEST_DATABASE_URL=postgresql://USER@127.0.0.1:55449/postgres node --test scripts/processing-mail-db.test.mjs`, lint, build. DB 테스트는 로컬 포트 55449만 허용하며 실메일을 사용하지 않는다. `scripts/processing-mail-operate.mjs`는 2026-09-10의 확인된 답장 한 통을 검사하는 일회성 도구다. 기본은 읽기 전용이고, `PROCESSING_MAIL_APPLY=confirmed`와 `--apply-222`가 함께 있어야 #222만 반영한다.
