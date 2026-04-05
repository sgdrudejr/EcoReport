#!/bin/bash
set -euo pipefail

ROOT="${ECOREPORT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DATE="${1:-}"

find_latest_stage1_date() {
  find "$ROOT/data/analysis-state" -maxdepth 2 -type f -name "stage1-report-extracts-v2.json" \
    | sed -E 's#.*/data/analysis-state/([0-9]{4}-[0-9]{2}-[0-9]{2})/stage1-report-extracts-v2.json#\1#' \
    | sort \
    | tail -n 1
}

if [[ -z "$DATE" ]]; then
  DATE="$(find_latest_stage1_date)"
fi

if [[ -z "$DATE" ]]; then
  echo "Stage 1 파일을 찾지 못했습니다. 먼저 stage1:extracts를 실행해 주세요." >&2
  exit 1
fi

STAGE1_PATH="$ROOT/data/analysis-state/$DATE/stage1-report-extracts-v2.json"

if [[ ! -f "$STAGE1_PATH" ]]; then
  echo "Stage 1 파일이 없습니다: $STAGE1_PATH" >&2
  exit 1
fi

echo "Stage 1 file: $STAGE1_PATH"
echo "Running: npm run stage1.5:prompt -- --date $DATE"

cd "$ROOT"
npm run stage1.5:prompt -- --date "$DATE"

echo ""
echo "Clipboard preview:"
pbpaste | sed -n '1,40p'
