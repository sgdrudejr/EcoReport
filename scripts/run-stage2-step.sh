#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DATE=""
RUN_DATE=""
EFFECTIVE_MARKET_DATE=""
MODE="auto"
ALLOW_MOCK_FALLBACK=1

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
      ALLOW_MOCK_FALLBACK=0
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
STAGE2_MOCK_FALLBACK_CMD=(node scripts/build-stage2-strategy-mock.js "${STAGE2_COMMON_ARGS[@]}" --mock-mode fallback --output "data/analysis-state/$DATE/stage2-strategy-options.json")
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

stage2_mock_fallback() {
  local reason="$1"
  echo "!! $reason -> mock fallback"
  local fb_start=$(date +%s)
  "${STAGE2_MOCK_FALLBACK_CMD[@]}"
  stage2_log_attempt "mock" "success" "$(( $(date +%s) - fb_start ))"
  STAGE2_PROVIDER="mock"
  STAGE2_FINAL_STATUS="fallback"
}

stage2_run_gemini() {
  local t0=$(date +%s)
  if "$(python_bin)" scripts/build-stage2-strategy-gemini.py "${STAGE2_COMMON_ARGS[@]}" 2>/tmp/stage2-gemini-err.txt; then
    stage2_log_attempt "gemini" "success" "$(( $(date +%s) - t0 ))"
    STAGE2_PROVIDER="gemini"
    STAGE2_FINAL_STATUS="success"
    return 0
  fi

  stage2_log_attempt "gemini" "failed" "$(( $(date +%s) - t0 ))" "$(cat /tmp/stage2-gemini-err.txt)"
  return 1
}

stage2_run_claude() {
  local t0=$(date +%s)
  if node scripts/build-stage2-strategy-claude.js "${STAGE2_COMMON_ARGS[@]}" 2>/tmp/stage2-claude-err.txt; then
    stage2_log_attempt "claude" "success" "$(( $(date +%s) - t0 ))"
    STAGE2_PROVIDER="claude"
    STAGE2_FINAL_STATUS="success"
    return 0
  fi

  stage2_log_attempt "claude" "failed" "$(( $(date +%s) - t0 ))" "$(cat /tmp/stage2-claude-err.txt)"
  return 1
}

if [[ "$MODE" == "mock" ]]; then
  local_start=$(date +%s)
  node scripts/build-stage2-strategy-mock.js "${STAGE2_COMMON_ARGS[@]}" --mock-mode test
  stage2_log_attempt "mock" "success" "$(( $(date +%s) - local_start ))"
  STAGE2_PROVIDER="mock"
  STAGE2_FINAL_STATUS="explicit_mock"
elif [[ "$MODE" == "gemini" ]]; then
  if ! stage2_run_gemini; then
    [[ "$ALLOW_MOCK_FALLBACK" != "1" ]] && { stage2_write_log; exit 1; }
    stage2_mock_fallback "Gemini Stage 2 failed"
  fi
elif [[ "$MODE" == "claude" ]]; then
  if ! stage2_run_claude; then
    [[ "$ALLOW_MOCK_FALLBACK" != "1" ]] && { stage2_write_log; exit 1; }
    stage2_mock_fallback "Claude Stage 2 failed"
  fi
else
  if stage2_run_gemini; then
    :
  elif stage2_run_claude; then
    :
  else
    stage2_mock_fallback "Gemini + Claude failed"
  fi
fi

stage2_write_log
echo "$STAGE2_LOG"
