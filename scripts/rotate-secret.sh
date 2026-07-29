#!/usr/bin/env bash
# Vercel 환경변수 교체 + 재배포 + 검증을 한 번에.
# 새 비밀값은 이 터미널에서만 입력받는다 (화면 표시 없음, 셸 히스토리 미기록).
# 여러 개를 한 번에 넘기면 전부 등록한 뒤 재배포 1회 — 다운타임을 줄일 수 있다.
#
#   ./scripts/rotate-secret.sh DATABASE_URL MARKET_DATABASE_URL
#   ./scripts/rotate-secret.sh GMAIL_CLIENT_ID GMAIL_CLIENT_SECRET GMAIL_REFRESH_TOKEN
#
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "사용법: $0 <ENV_KEY> [ENV_KEY ...]   (예: DATABASE_URL MARKET_DATABASE_URL)" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

KEYS=("$@")

# 1) 먼저 모든 값을 입력받는다 (Vercel 반영 전에 취소할 수 있도록)
declare -a VALUES=()
for KEY in "${KEYS[@]}"; do
  printf '새 %s 값을 붙여넣고 Enter (화면에 표시되지 않음): ' "$KEY"
  read -rs V
  printf '\n'
  [ -n "$V" ] || { echo "값이 비어 있음 — 아무것도 변경하지 않고 중단" >&2; exit 1; }
  VALUES+=("$V")
done

echo ""
echo "교체 대상: ${KEYS[*]}"
printf '진행할까요? (yes 입력): '
read -r CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "취소됨 — 아무것도 변경하지 않음"; exit 0; }

# 2) 전부 등록
for i in "${!KEYS[@]}"; do
  KEY="${KEYS[$i]}"
  echo "→ ${KEY} 교체"
  vercel env rm "$KEY" production --yes >/dev/null 2>&1 || echo "  (기존 값 없음 — 신규 등록)"
  printf '%s' "${VALUES[$i]}" | vercel env add "$KEY" production >/dev/null
done
unset VALUES

echo "→ 로컬 .env.local 은 직접 갱신할 것 (이 스크립트는 건드리지 않음)"

# 3) 재배포 1회
echo "→ 재배포 트리거 (env 반영에는 새 배포가 필요)"
git commit --allow-empty -q -m "chore: ${KEYS[*]} 로테이트 반영 재배포"
git push origin "$(git branch --show-current)" >/dev/null 2>&1

# 4) 검증
echo "→ 배포 대기 (최대 4분)"
BASE="https://snorkl-teacher-reg.vercel.app"
for _ in $(seq 1 24); do
  sleep 10
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/school" || echo 000)
  if [ "$CODE" = "200" ]; then
    echo "✓ 배포 완료 — /school 200"
    case " ${KEYS[*]} " in
      *" DATABASE_URL "*)
        # 실제 DB 쿼리가 도는 경로로 연결 확인 (존재하지 않는 주소라 메일 발송은 없음)
        LOGIN=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" \
          -d '{"email":"rotation-check@example.invalid"}' "$BASE/api/school/login" || echo 000)
        [ "$LOGIN" = "200" ] && echo "✓ DB 연결 확인 (school/login 200)" \
                             || echo "✗ DB 연결 실패 (HTTP $LOGIN) — Vercel 로그 확인 필요"
        ;;
    esac
    exit 0
  fi
  printf '.'
done
echo ""
echo "✗ 4분 내 확인 실패 — Vercel 대시보드에서 배포 상태 확인 요망" >&2
exit 1
