#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DATE=""
RUN_DATE=""
EFFECTIVE_MARKET_DATE=""
MODE="auto"

python_bin() {
  if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
    echo "$ROOT_DIR/.venv/bin/python"
  else
    echo "python3"
  fi
}

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
    --effective-market-date)
      EFFECTIVE_MARKET_DATE="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --strict)
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$DATE" ]]; then
  echo "DATE is required" >&2
  exit 1
fi

cd "$ROOT_DIR"

STAGE2_COMMON_ARGS=(--date "$DATE" --run-date "$RUN_DATE" --effective-market-date "${EFFECTIVE_MARKET_DATE:-$DATE}")
STAGE2_LOG="data/analysis-state/$DATE/stage2-run-log.json"
STAGE2_START=$(date +%s)
STAGE2_PROVIDER=""
STAGE2_ATTEMPTS=()
STAGE2_FINAL_STATUS=""

stage2_log_attempt() {
  local provider="$1" status="$2" elapsed="$3" error="${4:-}"
  STAGE2_ATTEMPTS+=("{\"provider\":\"$provider\",\"status\":\"$status\",\"elapsed_sec\":$elapsed,\"error\":$(printf '%s' "$error" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip() or None))')}")
}

stage2_write_log() {
  local total_elapsed=$(( $(date +%s) - STAGE2_START ))
  local attempts_json
  attempts_json=$(printf '%s,' "${STAGE2_ATTEMPTS[@]}" | sed 's/,$//')
  mkdir -p "data/analysis-state/$DATE"
  cat > "$STAGE2_LOG" <<LOGEOF
{
  "date": "$DATE",
  "runId": "${ECOREPORT_RUN_ID:-}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "finalProvider": "$STAGE2_PROVIDER",
  "finalStatus": "$STAGE2_FINAL_STATUS",
  "totalElapsedSec": $total_elapsed,
  "attempts": [$attempts_json]
}
LOGEOF
}

stage2_run_qwen() {
  local t0=$(date +%s)
  if "$(python_bin)" scripts/build-stage2-strategy-qwen.py "${STAGE2_COMMON_ARGS[@]}" 2>/tmp/stage2-qwen-err.txt; then
    stage2_log_attempt "qwen" "success" "$(( $(date +%s) - t0 ))"
    STAGE2_PROVIDER="qwen"
    STAGE2_FINAL_STATUS="success"
    return 0
  fi

  stage2_log_attempt "qwen" "failed" "$(( $(date +%s) - t0 ))" "$(cat /tmp/stage2-qwen-err.txt)"
  return 1
}

if [[ "$MODE" == "mock" ]]; then
  echo "ERROR: --mode mock is disabled. Stage 2 must use a real LLM provider and fail-fast on errors." >&2
  exit 2
elif [[ "$MODE" == "gemini" || "$MODE" == "qwen" || "$MODE" == "auto" ]]; then
  if ! stage2_run_qwen; then
    STAGE2_PROVIDER="qwen"
    STAGE2_FINAL_STATUS="failed"
    stage2_write_log
    exit 1
  fi
elif [[ "$MODE" == "claude" ]]; then
  echo "ERROR: --mode claude is no longer supported." >&2
  exit 2
else
  echo "ERROR: unknown Stage 2 mode: $MODE" >&2
  exit 2
fi

stage2_write_log
echo "$STAGE2_LOG"
