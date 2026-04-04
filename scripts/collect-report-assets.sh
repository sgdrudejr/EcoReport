#!/usr/bin/env bash
# 리포트 수집 후 전문 텍스트화까지 하나의 단계로 묶어 실행합니다.

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$HOME/stock-pilot}"
DATE="$(node "$ROOT_DIR/scripts/resolve-cycle-date.js")"
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      DATE="$2"
      shift 2
      ;;
    --force)
      FORCE=1
      shift
      ;;
    *)
      DATE="$1"
      shift
      ;;
  esac
done

cd "$ROOT_DIR"

CRAWL_ARGS=(--date "$DATE")
TEXTIFY_ARGS=(--date "$DATE")

if [[ "$FORCE" == "1" ]]; then
  CRAWL_ARGS+=(--force)
  TEXTIFY_ARGS+=(--force)
fi

echo "📡 리포트 수집 시작 ($DATE)"
node scripts/crawl-naver-research.js "${CRAWL_ARGS[@]}"

echo "📝 전문 텍스트화 시작 ($DATE)"
node scripts/dump-report-texts.js "${TEXTIFY_ARGS[@]}"

echo "✅ 리포트 자산 수집 완료 ($DATE)"
