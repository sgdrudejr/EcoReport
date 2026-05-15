#!/usr/bin/env bash
# 보고서/StockEasy/MarketVoice/기술지표/KIS ETF/뉴스를 공통 관측치로 정규화하고 교차 소스 합의도를 계산합니다.

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REQUESTED_DATE=""
RUN_DATE="${RUN_DATE:-$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" --field run_date)}"
EFFECTIVE_MARKET_DATE=""
RUN_ID="${ECOREPORT_RUN_ID:-}"

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
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

DATE="${REQUESTED_DATE:-${EFFECTIVE_MARKET_DATE:-$RUN_DATE}}"
EFFECTIVE_MARKET_DATE="${EFFECTIVE_MARKET_DATE:-$DATE}"
RUN_ID="${RUN_ID:-source-consensus-${DATE}-$(date +%Y%m%d%H%M%S)}"

COMMON_ARGS=(
  --date "$DATE"
  --run-date "$RUN_DATE"
  --effective-market-date "$EFFECTIVE_MARKET_DATE"
  --run-id "$RUN_ID"
)

cd "$ROOT_DIR"

run_optional() {
  local label="$1"
  shift
  printf '== %s ==\n' "$label"
  if ! "$@"; then
    printf 'WARN: %s failed; consensus will continue with remaining sources\n' "$label" >&2
  fi
}

run_optional "Normalize Reports" node scripts/build-normalized-reports.js "${COMMON_ARGS[@]}"
run_optional "Normalize StockEasy" node scripts/build-normalized-stockeasy.js "${COMMON_ARGS[@]}"
run_optional "Normalize MarketVoice" node scripts/build-normalized-marketvoice.js "${COMMON_ARGS[@]}"
run_optional "Normalize Technical" node scripts/build-normalized-technical.js "${COMMON_ARGS[@]}"
run_optional "Normalize KIS ETF" node scripts/build-normalized-kis-etf.js "${COMMON_ARGS[@]}"
run_optional "Normalize News" node scripts/build-normalized-news.js "${COMMON_ARGS[@]}"

printf '== Cross-source Decision Features ==\n'
node scripts/build-decision-features.js "${COMMON_ARGS[@]}"

printf '== New-source Supplement ==\n'
node scripts/build-source-consensus-supplement.js "${COMMON_ARGS[@]}"

printf '== Source consensus outputs ==\n'
printf '정규화 reports: %s\n' "$ROOT_DIR/data/normalized/$DATE/reports.normalized.json"
printf '정규화 stockeasy: %s\n' "$ROOT_DIR/data/normalized/$DATE/stockeasy.normalized.json"
printf '정규화 marketvoice: %s\n' "$ROOT_DIR/data/normalized/$DATE/marketvoice.normalized.json"
printf '정규화 technical: %s\n' "$ROOT_DIR/data/normalized/$DATE/technical.normalized.json"
printf '정규화 kis_etf: %s\n' "$ROOT_DIR/data/normalized/$DATE/kis_etf.normalized.json"
printf '정규화 news: %s\n' "$ROOT_DIR/data/normalized/$DATE/news.normalized.json"
printf '의사결정 feature: %s\n' "$ROOT_DIR/data/features/$DATE/decision-features.json"
printf '교차소스 합의: %s\n' "$ROOT_DIR/data/features/$DATE/cross-source-consensus.json"
printf '소스 충돌: %s\n' "$ROOT_DIR/data/features/$DATE/source-divergence.json"
printf '새 보강 리포트: %s\n' "$ROOT_DIR/reports/daily/$DATE-source-consensus-supplement.md"
