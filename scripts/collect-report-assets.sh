#!/usr/bin/env bash
# 리포트 수집 후 전문 텍스트화까지 하나의 단계로 묶어 실행합니다.

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$HOME/stock-pilot}"
REQUESTED_DATE=""
RUN_DATE="${RUN_DATE:-$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" --field run_date)}"
EFFECTIVE_MARKET_DATE=""
FORCE=0

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
    --force)
      FORCE=1
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

cd "$ROOT_DIR"

CRAWL_ARGS=(--date "$DATE")
TEXTIFY_ARGS=(--date "$DATE")

if [[ "$FORCE" == "1" ]]; then
  CRAWL_ARGS+=(--force)
  TEXTIFY_ARGS+=(--force)
fi

echo "📡 리포트 수집 시작 (run: $RUN_DATE / effective: $DATE)"
node scripts/crawl-naver-research.js "${CRAWL_ARGS[@]}"

echo "📝 전문 텍스트화 시작 (effective: $DATE)"
node scripts/dump-report-texts.js "${TEXTIFY_ARGS[@]}"

echo "✅ 리포트 자산 수집 완료 (run: $RUN_DATE / effective: $DATE)"
