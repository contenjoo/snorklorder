#!/usr/bin/env bash
# Vercel 환경변수 교체 + 재배포 + 검증을 한 번에.
# 새 비밀값은 이 터미널에서만 입력받는다 (화면 표시 없음, 셸 히스토리 미기록).
#
#   ./scripts/rotate-secret.sh DATABASE_URL
#   ./scripts/rotate-secret.sh GMAIL_CLIENT_SECRET
#
set -euo pipefail

KEY="${1:-}"
if [ -z "$KEY" ]; then
  echo "사용법: $0 <ENV_KEY>   (예: DATABASE_URL)" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

printf '새 %s 값을 붙여넣고 Enter (화면에 표시되지 않음): ' "$KEY"
read -rs NEW_VALUE
printf '\n'
[ -n "$NEW_VALUE" ] || { echo "값이 비어 있음 — 중단" >&2; exit 1; }

echo "→ 기존 production 값 제거"
vercel env rm "$KEY" production --yes >/dev/null 2>&1 || echo "  (기존 값 없음 — 신규 등록으로 진행)"

echo "→ 새 값 등록"
printf '%s' "$NEW_VALUE" | vercel env add "$KEY" production >/dev/null
unset NEW_VALUE

echo "→ 로컬 .env.local 도 갱신하려면 직접 편집할 것 (이 스크립트는 건드리지 않음)"

echo "→ 재배포 트리거 (env 반영에는 새 배포가 필요)"
git commit --allow-empty -q -m "chore: ${KEY} 로테이트 반영 재배포"
git push origin "$(git branch --show-current)" >/dev/null 2>&1

echo "→ 배포 대기 (최대 4분)"
BASE="https://snorkl-teacher-reg.vercel.app"
for i in $(seq 1 24); do
  sleep 10
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/school" || echo 000)
  if [ "$CODE" = "200" ]; then
    echo "✓ 배포 완료 — /school 200"
    # DB 자격증명 교체였다면 실제 쿼리까지 확인
    if [ "$KEY" = "DATABASE_URL" ]; then
      LOGIN=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
        -d '{"email":"rotation-check@example.invalid"}' "$BASE/api/school/login" || echo 000)
      [ "$LOGIN" = "200" ] && echo "✓ DB 연결 확인 (school/login 200)" \
                           || echo "✗ DB 연결 실패 (HTTP $LOGIN) — Vercel 로그 확인 필요"
    fi
    exit 0
  fi
  printf '.'
done
echo ""
echo "✗ 4분 내 확인 실패 — Vercel 대시보드에서 배포 상태 확인 요망" >&2
exit 1
