#!/usr/bin/env bash
# 리포트 수집 후 전문 텍스트화까지 하나의 단계로 묶어 실행합니다.

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REQUESTED_DATE=""
RUN_DATE="${RUN_DATE:-$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" --field run_date)}"
EFFECTIVE_MARKET_DATE=""
FORCE=0

read_report_count() {
  node -e "const fs=require('fs');const p=process.argv[1];try{const raw=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(Array.isArray(raw)?raw.length:0));}catch{process.stdout.write('0');}" "$1"
}

read_text_success_count() {
  node -e "const fs=require('fs');const p=process.argv[1];try{const raw=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(Number(raw?.success_count ?? 0)));}catch{process.stdout.write('0');}" "$1"
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

REPORT_INDEX_PATH="$ROOT_DIR/data/reports/$DATE/index.json"
TEXT_MANIFEST_PATH="$ROOT_DIR/data/reports/$DATE/text-manifest.json"
REPORT_COUNT="$(read_report_count "$REPORT_INDEX_PATH")"
TEXT_SUCCESS_COUNT="$(read_text_success_count "$TEXT_MANIFEST_PATH")"

if [[ "${REPORT_COUNT:-0}" -le 0 ]]; then
  echo "❌ 리포트 수집 결과가 0건입니다. same-day 재시도가 필요합니다."
  exit 11
fi

if [[ "${TEXT_SUCCESS_COUNT:-0}" -le 0 ]]; then
  echo "❌ 전문 텍스트화 성공 건수가 0건입니다. same-day 재시도가 필요합니다."
  exit 12
fi

echo "✅ 리포트 자산 수집 완료 (run: $RUN_DATE / effective: $DATE)"
