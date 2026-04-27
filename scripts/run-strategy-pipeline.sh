#!/usr/bin/env bash
# EcoReport 01~13 Strategy/Quality pipeline runner

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REQUESTED_DATE=""
RUN_DATE="${RUN_DATE:-$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" --field run_date)}"
EFFECTIVE_MARKET_DATE=""
RUN_ID="${ECOREPORT_RUN_ID:-}"
USE_QWEN_STAGE2=1
BUILD_STAGE1_5_PROMPT=1
RUN_STAGE1_4=1
STAGE2_PROVIDER="unknown"
STAGE2_FINAL_STATUS="pending"
STAGE2_TIMEOUT_SEC="${STAGE2_TIMEOUT_SEC:-240}"

python_bin() {
  if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
    echo "$ROOT_DIR/.venv/bin/python"
  else
    echo "python3"
  fi
}

env_value_from_sources() {
  local key="$1"
  local current="${!key:-}"
  if [[ -n "$current" ]]; then
    printf '%s\n' "$current"
    return 0
  fi

  local env_file="$ROOT_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi

  awk -F= -v target="$key" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      split(line, pair, "=")
      k = pair[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
      if (k != target) next
      value = substr(line, index(line, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if ((value ~ /^".*"$/) || (value ~ /^'\''.*'\''$/)) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      exit
    }
  ' "$env_file"
}

has_env_key() {
  [[ -n "$(env_value_from_sources "$1" 2>/dev/null || true)" ]]
}

stage2_qwen_preflight() {
  local py
  py="$(python_bin)"

  if ! has_env_key "DASHSCOPE_API_KEY" && ! has_env_key "QWEN_API_KEY"; then
    echo "DASHSCOPE_API_KEY or QWEN_API_KEY missing"
    return 1
  fi

  "$py" - <<'PY'
import importlib.util
import sys

if importlib.util.find_spec("openai") is None:
    print("openai missing")
    sys.exit(1)

print("ready")
PY
}

wait_with_timeout() {
  local pid="$1"
  local timeout_sec="$2"
  local elapsed=0

  while kill -0 "$pid" 2>/dev/null; do
    if (( elapsed >= timeout_sec )); then
      kill "$pid" 2>/dev/null || true
      wait "$pid" || true
      return 124
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  wait "$pid"
}

stage2_run_qwen() {
  local py err_file
  py="$(python_bin)"
  err_file="$(mktemp)"

  "$py" scripts/build-stage2-strategy-qwen.py "${STAGE2_COMMON_ARGS[@]}" --output "$STAGE2_OUTPUT" 2>"$err_file" &
  local pid=$!

  if wait_with_timeout "$pid" "$STAGE2_TIMEOUT_SEC"; then
    STAGE2_PROVIDER="qwen"
    STAGE2_FINAL_STATUS="success"
    rm -f "$err_file"
    return 0
  fi

  if [[ ! -s "$err_file" ]]; then
    printf 'Qwen 07. Strategy Options timed out after %ss\n' "$STAGE2_TIMEOUT_SEC" >"$err_file"
  fi
  echo "!! Qwen 07. Strategy Options 실행 실패 -> $(tr '\n' ' ' <"$err_file" | sed 's/[[:space:]]\+/ /g')" >&2
  rm -f "$err_file"
  return 1
}

try_stage2_qwen() {
  local preflight_output
  if ! preflight_output="$(stage2_qwen_preflight 2>&1)"; then
    echo "!! Qwen 07. Strategy Options 사전 점검 실패 (${preflight_output})"
    return 1
  fi

  stage2_run_qwen
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
      shift
      ;;
    --mock-stage2)
      echo "ERROR: --mock-stage2 is disabled. 07. Strategy Options must use a real LLM provider and fail-fast on errors." >&2
      exit 2
      ;;
    --gemini-stage2)
      echo "WARN: --gemini-stage2 is kept as a legacy alias. Running Qwen 07. Strategy Options with mock fallback disabled." >&2
      USE_QWEN_STAGE2=1
      shift
      ;;
    --qwen-stage2)
      USE_QWEN_STAGE2=1
      shift
      ;;
    --claude-stage2)
      echo "ERROR: --claude-stage2 is no longer supported." >&2
      exit 2
      ;;
    --strict-gemini-stage2)
      echo "WARN: --strict-gemini-stage2 is kept as a legacy alias. Mock fallback remains disabled." >&2
      shift
      ;;
    --strict-qwen-stage2)
      shift
      ;;
    --skip-stage1-5-prompt)
      BUILD_STAGE1_5_PROMPT=0
      shift
      ;;
    --skip-stage1-4)
      RUN_STAGE1_4=0
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
export ECOREPORT_ROOT="$ROOT_DIR"

STAGE2_COMMON_ARGS=(
  --date "$DATE"
  --run-date "$RUN_DATE"
  --effective-market-date "$DATE"
)
ANALYSIS_DIR="$ROOT_DIR/data/analysis-state/$DATE"
STAGE2_OUTPUT="$ANALYSIS_DIR/stage2-strategy-options.json"

cd "$ROOT_DIR"

echo "== Run Metadata =="
echo "run_id=$RUN_ID / run_date=$RUN_DATE / effective_market_date=$DATE"

echo "== 01. Portfolio Sync =="
if ! node scripts/sync-kis-portfolio.js "${STAGE2_COMMON_ARGS[@]}"; then
  echo "WARN: 포트폴리오 스냅샷 동기화 실패. 기존 data/portfolio/latest.json으로 계속 진행합니다." >&2
fi

echo "== 03. Report Extraction =="
node scripts/build-stage1-report-extracts.js "${STAGE2_COMMON_ARGS[@]}"

if [[ "$RUN_STAGE1_4" == "1" ]]; then
  echo "== 02. Chunk Summary + Full Daily Report =="
  if ! "$(python_bin)" scripts/build-stage1-4-full-daily-report.py \
    "${STAGE2_COMMON_ARGS[@]}"; then
    echo "WARN: 02. Chunk Summary(full daily report/atoms) 실패. 03. Report Indexing extracts 폴백으로 계속 진행합니다." >&2
  fi

  echo "== 03. Report Indexing =="
  if ! node scripts/build-stage2-enriched-report-index.js "${STAGE2_COMMON_ARGS[@]}"; then
    echo "WARN: 03. Report Indexing(enriched report index) 실패. 04/05 단계는 기존 입력으로 계속 진행합니다." >&2
  fi

  echo "== 04. Research Agenda =="
  if ! "$(python_bin)" scripts/build-stage1-4-research-agenda.py \
    "${STAGE2_COMMON_ARGS[@]}" \
    --max-input-summaries "${STAGE1_4_MAX_INPUT_SUMMARIES:-80}"; then
    echo "WARN: 04. Research Agenda 실패. 05. Deep Research는 extracts 추론 폴백으로 계속 진행합니다." >&2
  fi
fi

if [[ "$BUILD_STAGE1_5_PROMPT" == "1" ]]; then
  echo "== 05. Deep Research Prompt =="
  if ! node scripts/build-stage1-5-gemini-deep-research-prompt.js "${STAGE2_COMMON_ARGS[@]}"; then
    echo "WARN: 05. Deep Research prompt 생성 실패. 06 이후 단계는 계속 진행합니다." >&2
  fi
fi

echo "== 07. Strategy Prompt =="
node scripts/build-stage2-strategy-prompt.js "${STAGE2_COMMON_ARGS[@]}"

if [[ "$USE_QWEN_STAGE2" == "1" ]]; then
  echo "== 07. Qwen Strategy Options =="
  if ! try_stage2_qwen; then
    echo "ERROR: 07. Strategy Options(Qwen) failed. Mock fallback is disabled." >&2
    exit 1
  fi
else
  echo "== 07. Strategy Options default provider (Qwen, fail-fast) =="
  if ! try_stage2_qwen; then
    echo "ERROR: 07. Strategy Options(Qwen) failed. Mock fallback is disabled." >&2
    exit 1
  fi
fi

echo "== 07. Strategy Options result =="
echo "provider=$STAGE2_PROVIDER / status=$STAGE2_FINAL_STATUS / output=$STAGE2_OUTPUT"

echo "== 08. ETF Ranking =="
if ! "$(python_bin)" scripts/collectors/fetch-kis-etf-ranking.py --date "$DATE" --top-n 80; then
  echo "WARN: KIS ETF ranking 수집 실패. 기존/없음 데이터로 08. Candidate Matching을 계속 진행합니다." >&2
fi

echo "== 08. Candidate Matching =="
node scripts/build-stage2-5-etf-candidates.js "${STAGE2_COMMON_ARGS[@]}"

echo "== 09. Impact Mapping =="
node scripts/build-impact-map.js "${STAGE2_COMMON_ARGS[@]}"

echo "== Shadow Pipeline: 00~03 =="
bash scripts/shadow/run-shadow-pipeline.sh "${STAGE2_COMMON_ARGS[@]}"

echo "== 10. Quant Scoring =="
node scripts/build-stage3-quant-scores.js "${STAGE2_COMMON_ARGS[@]}"

echo "== 11. Execution Plan =="
node scripts/build-stage4-execution-plan.js "${STAGE2_COMMON_ARGS[@]}"

echo "== 13. Quality Gates =="
node scripts/audit-data-quality.js "${STAGE2_COMMON_ARGS[@]}"

echo "== Feedback Snapshot =="
node scripts/build-feedback-snapshot.js "${STAGE2_COMMON_ARGS[@]}"

echo "== Feedback Analysis =="
node scripts/build-feedback-analysis.js "${STAGE2_COMMON_ARGS[@]}"

echo "== Feedback Report =="
node scripts/build-feedback-report.js --date "$DATE"

echo "Done."
