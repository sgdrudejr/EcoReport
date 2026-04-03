#!/usr/bin/env bash
# EcoReport 1~4단계 전략 파이프라인 실행기

set -euo pipefail

ROOT_DIR="/Users/seo/stock-pilot"
DATE="$(date +%F)"
USE_MOCK_STAGE2=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      DATE="$2"
      shift 2
      ;;
    --no-mock-stage2)
      USE_MOCK_STAGE2=0
      shift
      ;;
    *)
      DATE="$1"
      shift
      ;;
  esac
done

cd "$ROOT_DIR"

echo "== Stage 1: report extracts =="
node scripts/build-stage1-report-extracts.js --date "$DATE"

echo "== Stage 2: strategy prompt =="
node scripts/build-stage2-strategy-prompt.js --date "$DATE"

if [[ "$USE_MOCK_STAGE2" == "1" ]]; then
  echo "== Stage 2 mock: strategy options =="
  node scripts/build-stage2-strategy-mock.js --date "$DATE"
fi

echo "== Stage 3: quant scores =="
node scripts/build-stage3-quant-scores.js --date "$DATE"

echo "== Stage 4: execution plan =="
node scripts/build-stage4-execution-plan.js --date "$DATE"

echo "Done."
