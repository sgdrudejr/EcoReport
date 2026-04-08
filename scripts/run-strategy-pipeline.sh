#!/usr/bin/env bash
# EcoReport 1~4단계 전략 파이프라인 실행기

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REQUESTED_DATE=""
RUN_DATE="${RUN_DATE:-$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" --field run_date)}"
EFFECTIVE_MARKET_DATE=""
RUN_ID="${ECOREPORT_RUN_ID:-}"
USE_MOCK_STAGE2=1
USE_GEMINI_STAGE2=0
ALLOW_STAGE2_MOCK_FALLBACK=1

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
    --gemini-stage2)
      USE_GEMINI_STAGE2=1
      USE_MOCK_STAGE2=0
      shift
      ;;
    --strict-gemini-stage2)
      ALLOW_STAGE2_MOCK_FALLBACK=0
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

echo "== Stage 2: strategy prompt =="
node scripts/build-stage2-strategy-prompt.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"

if [[ "$USE_GEMINI_STAGE2" == "1" ]]; then
  echo "== Stage 2 actual: Gemini strategy options =="
  if ! "$(python_bin)" scripts/build-stage2-strategy-gemini.py --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"; then
    if [[ "$ALLOW_STAGE2_MOCK_FALLBACK" != "1" ]]; then
      exit 1
    fi
    echo "!! Gemini Stage 2 실패 -> mock fallback으로 계속 진행"
    node scripts/build-stage2-strategy-mock.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE" --output "data/analysis-state/$DATE/stage2-strategy-options.json"
  fi
elif [[ "$USE_MOCK_STAGE2" == "1" ]]; then
  echo "== Stage 2 mock: strategy options =="
  node scripts/build-stage2-strategy-mock.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"
fi

echo "== Stage 2.5: impact map =="
node scripts/build-impact-map.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"

echo "== Stage 3: quant scores =="
node scripts/build-stage3-quant-scores.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"

echo "== Stage 4: execution plan =="
node scripts/build-stage4-execution-plan.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"

echo "Done."
