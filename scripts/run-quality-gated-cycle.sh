#!/usr/bin/env bash
# 품질 게이트를 통과할 때까지 일일 시스템을 재시도합니다.

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
MAX_ATTEMPTS="${ECOREPORT_MAX_ATTEMPTS:-3}"
ATTEMPT=1

DATE=""
RUN_DATE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      DATE="$2"
      shift 2
      ;;
    --run-date)
      RUN_DATE="$2"
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

EXTRA_ARGS=("$@")

log() {
  printf '%s\n' "$1"
}

while [[ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]]; do
  log "== Quality-gated cycle attempt $ATTEMPT/$MAX_ATTEMPTS =="

  RUN_ARGS=()
  if [[ -n "$DATE" ]]; then
    RUN_ARGS+=(--date "$DATE")
  fi
  if [[ -n "$RUN_DATE" ]]; then
    RUN_ARGS+=(--run-date "$RUN_DATE")
  fi

  if bash "$ROOT_DIR/scripts/run-daily-system.sh" "${RUN_ARGS[@]}" "${EXTRA_ARGS[@]}"; then
    log "== Base daily cycle succeeded =="
  else
    log "!! Base daily cycle failed"
  fi

  VERIFY_ARGS=()
  if [[ -n "$DATE" ]]; then
    VERIFY_ARGS+=(--date "$DATE")
  fi
  if [[ -n "$RUN_DATE" ]]; then
    VERIFY_ARGS+=(--run-date "$RUN_DATE")
  fi

  if node "$ROOT_DIR/scripts/verify-daily-system.js" "${VERIFY_ARGS[@]}"; then
    log "== Quality gate passed =="
    exit 0
  fi

  log "!! Quality gate failed, consulting fallback checklist"
  log "   See docs/FAILURE_FALLBACK_CHECKLIST.md"

  ATTEMPT=$((ATTEMPT + 1))
done

log "!! Exhausted all attempts without passing quality gate"
exit 1
