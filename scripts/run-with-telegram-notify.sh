#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/config/telegram_notify.env"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
fi

BOT_TOKEN="${BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}"
CHAT_ID="${CHAT_ID:-${TELEGRAM_CHAT_ID:-}}"

if [[ -z "${BOT_TOKEN}" || -z "${CHAT_ID}" ]]; then
  echo "Error: BOT_TOKEN/CHAT_ID가 비어 있습니다. ${ENV_FILE} 또는 환경변수(TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)를 설정하세요." >&2
  exit 2
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <command> [args ...]" >&2
  echo "Example: $0 npm run automation:daily -- --date 2026-04-20" >&2
  exit 1
fi

send_tg() {
  local message="$1"
  curl -fsS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${CHAT_ID}" \
    --data-urlencode "text=${message}" \
    >/dev/null || true
}

cmd_display="$*"
started_at="$(date '+%Y-%m-%d %H:%M:%S %Z')"
project_name="$(basename "${ROOT_DIR}")"

if "$@"; then
  finished_at="$(date '+%Y-%m-%d %H:%M:%S %Z')"
  send_tg "✅ Codex 작업 완료
프로젝트: ${project_name}
명령어: ${cmd_display}
시작: ${started_at}
완료: ${finished_at}"
  exit 0
else
  status=$?
  finished_at="$(date '+%Y-%m-%d %H:%M:%S %Z')"
  send_tg "❌ Codex 작업 실패 (exit ${status})
프로젝트: ${project_name}
명령어: ${cmd_display}
시작: ${started_at}
종료: ${finished_at}"
  exit "${status}"
fi
