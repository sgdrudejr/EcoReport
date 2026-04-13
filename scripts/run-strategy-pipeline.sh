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
ALLOW_STAGE2_MOCK_FALLBACK=1
BUILD_STAGE1_5_PROMPT=1
STAGE1_5_PID=""
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

stage2_gemini_preflight() {
  local py
  py="$(python_bin)"

  if ! has_env_key "GEMINI_API_KEY"; then
    echo "GEMINI_API_KEY missing"
    return 1
  fi

  "$py" - <<'PY'
import importlib.util
import sys

if importlib.util.find_spec("google.genai") is None:
    print("google.genai missing")
    sys.exit(1)

print("ready")
PY
}

wait_for_stage1_prompt() {
  if [[ -z "$STAGE1_5_PID" ]]; then
    return 0
  fi

  if ! wait "$STAGE1_5_PID"; then
    echo "!! Stage 1.5 prompt background step failed, but continuing with generated artifacts" >&2
  fi
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

stage2_run_gemini() {
  local py err_file
  py="$(python_bin)"
  err_file="$(mktemp)"

  "$py" scripts/build-stage2-strategy-gemini.py "${STAGE2_COMMON_ARGS[@]}" --output "$STAGE2_OUTPUT" 2>"$err_file" &
  local pid=$!

  if wait_with_timeout "$pid" "$STAGE2_TIMEOUT_SEC"; then
    STAGE2_PROVIDER="gemini"
    STAGE2_FINAL_STATUS="success"
    rm -f "$err_file"
    return 0
  fi

  if [[ ! -s "$err_file" ]]; then
    printf 'Gemini Stage 2 timed out after %ss\n' "$STAGE2_TIMEOUT_SEC" >"$err_file"
  fi
  echo "!! Gemini Stage 2 실행 실패 -> $(tr '\n' ' ' <"$err_file" | sed 's/[[:space:]]\+/ /g')" >&2
  rm -f "$err_file"
  return 1
}

stage2_run_mock() {
  local reason="${1:-fallback}"
  echo "!! ${reason} -> deterministic mock fallback으로 계속 진행"
  node scripts/build-stage2-strategy-mock.js "${STAGE2_COMMON_ARGS[@]}" --output "$STAGE2_OUTPUT" --mock-mode fallback
  STAGE2_PROVIDER="mock"
  STAGE2_FINAL_STATUS="fallback_mock"
}

try_stage2_gemini() {
  local preflight_output
  if ! preflight_output="$(stage2_gemini_preflight 2>&1)"; then
    echo "!! Gemini Stage 2 사전 점검 실패 (${preflight_output})"
    return 1
  fi

  stage2_run_gemini
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
      USE_GEMINI_STAGE2=0
      shift
      ;;
    --gemini-stage2)
      USE_GEMINI_STAGE2=1
      USE_MOCK_STAGE2=0
      shift
      ;;
    --claude-stage2)
      echo "ERROR: --claude-stage2 is no longer supported. Use --gemini-stage2 or --mock-stage2." >&2
      exit 2
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

echo "== Stage 1: report extracts =="
node scripts/build-stage1-report-extracts.js "${STAGE2_COMMON_ARGS[@]}"

if [[ "$BUILD_STAGE1_5_PROMPT" == "1" ]]; then
  echo "== Stage 1.5: deep research prompt (background) =="
  node scripts/build-stage1-5-gemini-deep-research-prompt.js "${STAGE2_COMMON_ARGS[@]}" &
  STAGE1_5_PID=$!
fi

echo "== Stage 2: strategy prompt =="
node scripts/build-stage2-strategy-prompt.js "${STAGE2_COMMON_ARGS[@]}"

if [[ "$USE_MOCK_STAGE2" == "1" ]]; then
  echo "== Stage 2 actual: Mock strategy options =="
  stage2_run_mock "명시적 mock 요청"
elif [[ "$USE_GEMINI_STAGE2" == "1" ]]; then
  echo "== Stage 2 actual: Gemini strategy options =="
  if ! try_stage2_gemini; then
    if [[ "$ALLOW_STAGE2_MOCK_FALLBACK" != "1" ]]; then
      exit 1
    fi
    stage2_run_mock "Gemini Stage 2 사용 불가"
  fi
else
  echo "== Stage 2 actual: default fallback chain (Gemini -> Mock) =="
  if ! try_stage2_gemini; then
    stage2_run_mock "기본 Stage 2 provider 실패"
  fi
fi

wait_for_stage1_prompt

echo "== Stage 2 result =="
echo "provider=$STAGE2_PROVIDER / status=$STAGE2_FINAL_STATUS / output=$STAGE2_OUTPUT"

echo "== Stage 2.5: impact map =="
node scripts/build-impact-map.js "${STAGE2_COMMON_ARGS[@]}"

echo "== Shadow pipeline: Stage 0~3 =="
bash scripts/shadow/run-shadow-pipeline.sh "${STAGE2_COMMON_ARGS[@]}"

echo "== Stage 3: quant scores =="
node scripts/build-stage3-quant-scores.js "${STAGE2_COMMON_ARGS[@]}"

echo "== Stage 4: execution plan =="
node scripts/build-stage4-execution-plan.js "${STAGE2_COMMON_ARGS[@]}"

echo "== Feedback: snapshot =="
node scripts/build-feedback-snapshot.js "${STAGE2_COMMON_ARGS[@]}"

echo "== Feedback: analysis =="
node scripts/build-feedback-analysis.js "${STAGE2_COMMON_ARGS[@]}"

echo "== Feedback: report =="
node scripts/build-feedback-report.js --date "$DATE"

echo "Done."
