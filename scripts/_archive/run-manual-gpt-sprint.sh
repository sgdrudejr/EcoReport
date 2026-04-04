#!/usr/bin/env bash
# 이미 수집된 데이터를 기준으로 수동 GPT 스프린트를 준비하고 첫 질문을 엽니다.

set -euo pipefail

ROOT="${ROOT_DIR:-$HOME/stock-pilot}"
DATE="$(date +%F)"
OPEN_STAGE="triage"
NO_OPEN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      DATE="$2"
      shift 2
      ;;
    --open)
      OPEN_STAGE="$2"
      shift 2
      ;;
    --no-open)
      NO_OPEN=1
      shift
      ;;
    *)
      DATE="$1"
      shift
      ;;
  esac
done

cd "$ROOT"

echo "🚀 Manual GPT sprint prep ($DATE)"
echo "- collection: skipped"
echo "- mode: manual LLM"

bash "$ROOT/scripts/run-cycle.sh" --date "$DATE" --manual-llm --skip-collect --force-llm

TRIAGE="$ROOT/knowledge/daily/$DATE-report-triage-prompt.md"
QUEUE="$ROOT/knowledge/daily/$DATE-report-summary-queue.md"
SYNTHESIS="$ROOT/knowledge/daily/$DATE-synthesis-prompt.md"
COACH="$ROOT/reports/daily/$DATE-portfolio-coach-prompt.md"
ADVISORY="$(find "$ROOT/reports/daily" -maxdepth 1 -type f -name "$DATE-*-advisory-prompt.md" | sort | tail -n 1)"

echo ""
echo "✅ Sprint files"
echo "- triage: $TRIAGE"
echo "- queue: $QUEUE"
echo "- synthesis: $SYNTHESIS"
echo "- coach: $COACH"
echo "- advisory: ${ADVISORY:-N/A}"

if [[ "$NO_OPEN" == "1" ]]; then
  exit 0
fi

echo ""
echo "🌐 Opening ChatGPT web with stage: $OPEN_STAGE"
bash "$ROOT/scripts/open-chatgpt-web-prompt.sh" "$OPEN_STAGE"
