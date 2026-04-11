#!/usr/bin/env bash
# EcoReport 1~4단계 전략 파이프라인 실행기

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REQUESTED_DATE=""
RUN_DATE="${RUN_DATE:-$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" --field run_date)}"
EFFECTIVE_MARKET_DATE=""
RUN_ID="${ECOREPORT_RUN_ID:-}"
USE_MOCK_STAGE2=0
USE_GEMINI_STAGE2=0
USE_CLAUDE_STAGE2=0
ALLOW_STAGE2_MOCK_FALLBACK=1
BUILD_STAGE1_5_PROMPT=1
STAGE1_5_PID=""

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
      REQUESTED_DATE="$2"
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
    --run-id)
      RUN_ID="$2"
      shift 2
      ;;
    --no-mock-stage2)
      USE_MOCK_STAGE2=0
      shift
      ;;
    --mock-stage2)
      USE_MOCK_STAGE2=1
      shift
      ;;
    --gemini-stage2)
      USE_GEMINI_STAGE2=1
      USE_MOCK_STAGE2=0
      USE_CLAUDE_STAGE2=0
      shift
      ;;
    --claude-stage2)
      USE_CLAUDE_STAGE2=1
      USE_MOCK_STAGE2=0
      USE_GEMINI_STAGE2=0
      shift
      ;;
    --strict-gemini-stage2)
      ALLOW_STAGE2_MOCK_FALLBACK=0
      shift
      ;;
    --skip-stage1-5-prompt)
      BUILD_STAGE1_5_PROMPT=0
      shift
      ;;
    *)
      REQUESTED_DATE="$1"
      shift
      ;;
  esac
done

if [[ -z "$EFFECTIVE_MARKET_DATE" ]]; then
  RESOLVE_ARGS=()
  if [[ -n "$REQUESTED_DATE" ]]; then
    RESOLVE_ARGS+=(--date "$REQUESTED_DATE")
  fi
  if [[ -n "$RUN_DATE" ]]; then
    RESOLVE_ARGS+=(--run-date "$RUN_DATE")
  fi
  EFFECTIVE_MARKET_DATE="$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" "${RESOLVE_ARGS[@]}" --field effective_market_date)"
fi

DATE="$EFFECTIVE_MARKET_DATE"
if [[ -z "$RUN_ID" ]]; then
  RUN_ID="${RUN_DATE}-$(date -u +%H%M%S)"
fi
export ECOREPORT_RUN_ID="$RUN_ID"

cd "$ROOT_DIR"

echo "== Run Metadata =="
echo "run_id=$RUN_ID / run_date=$RUN_DATE / effective_market_date=$DATE"

echo "== Stage 1: report extracts =="
node scripts/build-stage1-report-extracts.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"

if [[ "$BUILD_STAGE1_5_PROMPT" == "1" ]]; then
  echo "== Stage 1.5: deep research prompt (background) =="
  node scripts/build-stage1-5-gemini-deep-research-prompt.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE" &
  STAGE1_5_PID=$!
fi

echo "== Stage 2: strategy prompt =="
node scripts/build-stage2-strategy-prompt.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"

STAGE2_COMMON_ARGS=(--date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE")
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
  "runId": "$RUN_ID",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "finalProvider": "$STAGE2_PROVIDER",
  "finalStatus": "$STAGE2_FINAL_STATUS",
  "totalElapsedSec": $total_elapsed,
  "attempts": [$attempts_json]
}
LOGEOF
  echo "== Stage 2 run log: $STAGE2_LOG =="
}

stage2_mock_fallback() {
  echo "!! $1 -> mock fallback으로 계속 진행"
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
  else
    stage2_log_attempt "gemini" "failed" "$(( $(date +%s) - t0 ))" "$(cat /tmp/stage2-gemini-err.txt)"
    return 1
  fi
}

stage2_run_claude() {
  local t0=$(date +%s)
  if node scripts/build-stage2-strategy-claude.js "${STAGE2_COMMON_ARGS[@]}" 2>/tmp/stage2-claude-err.txt; then
    stage2_log_attempt "claude" "success" "$(( $(date +%s) - t0 ))"
    STAGE2_PROVIDER="claude"
    STAGE2_FINAL_STATUS="success"
    return 0
  else
    stage2_log_attempt "claude" "failed" "$(( $(date +%s) - t0 ))" "$(cat /tmp/stage2-claude-err.txt)"
    return 1
  fi
}

if [[ "$USE_MOCK_STAGE2" == "1" ]]; then
  echo "== Stage 2 mock: strategy options =="
  local_start=$(date +%s)
  node scripts/build-stage2-strategy-mock.js "${STAGE2_COMMON_ARGS[@]}" --mock-mode test
  stage2_log_attempt "mock" "success" "$(( $(date +%s) - local_start ))"
  STAGE2_PROVIDER="mock"
  STAGE2_FINAL_STATUS="explicit_mock"
elif [[ "$USE_GEMINI_STAGE2" == "1" ]]; then
  echo "== Stage 2 actual: Gemini strategy options =="
  if ! stage2_run_gemini; then
    [[ "$ALLOW_STAGE2_MOCK_FALLBACK" != "1" ]] && { stage2_write_log; exit 1; }
    stage2_mock_fallback "Gemini Stage 2 실패"
  fi
elif [[ "$USE_CLAUDE_STAGE2" == "1" ]]; then
  echo "== Stage 2 actual: Claude strategy options =="
  if ! stage2_run_claude; then
    [[ "$ALLOW_STAGE2_MOCK_FALLBACK" != "1" ]] && { stage2_write_log; exit 1; }
    stage2_mock_fallback "Claude Stage 2 실패"
  fi
else
  # 기본: Gemini -> Claude -> Mock 폴백 체인
  echo "== Stage 2: Gemini (default) =="
  if stage2_run_gemini; then
    echo "== Stage 2: Gemini 성공 =="
  elif stage2_run_claude; then
    echo "== Stage 2: Claude fallback 성공 =="
  else
    stage2_mock_fallback "Gemini + Claude 모두 실패"
  fi
fi

stage2_write_log

echo "== Stage 2.5: impact map =="
node scripts/build-impact-map.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"

echo "== Stage 3: quant scores =="
node scripts/build-stage3-quant-scores.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"

echo "== Stage 4: execution plan =="
node scripts/build-stage4-execution-plan.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"

echo "== Feedback snapshot =="
node scripts/build-feedback-snapshot.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE" || echo "!! Feedback snapshot 실패 (non-blocking)"

if [[ -n "$STAGE1_5_PID" ]]; then
  if wait "$STAGE1_5_PID"; then
    echo "== Stage 1.5: deep research prompt complete =="
  else
    echo "!! Stage 1.5 prompt 생성 실패 (non-blocking)"
  fi
fi

echo "Done."
