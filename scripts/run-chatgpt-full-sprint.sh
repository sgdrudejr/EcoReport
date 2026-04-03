#!/usr/bin/env bash
# 기존에 수집된 데이터로 ChatGPT 웹 대화형 스프린트를 순차 실행합니다.

set -euo pipefail

ROOT="${ROOT_DIR:-$HOME/stock-pilot}"
DATE="$(date +%F)"
TOP_N=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      DATE="$2"
      shift 2
      ;;
    --top)
      TOP_N="$2"
      shift 2
      ;;
    *)
      DATE="$1"
      shift
      ;;
  esac
done

cd "$ROOT"

echo "🚀 ChatGPT full sprint ($DATE)"
echo "- collection: skipped"
echo "- top report count: $TOP_N"

bash "$ROOT/scripts/run-manual-gpt-sprint.sh" --date "$DATE" --no-open

echo ""
echo "1) triage"
bash "$ROOT/scripts/open-chatgpt-web-prompt.sh" triage

QUEUE_JSON="$ROOT/knowledge/daily/$DATE-report-summary-queue.json"
mapfile -t REPORT_PROMPTS < <(python3 - <<'PY' "$QUEUE_JSON" "$TOP_N"
import json, sys
from pathlib import Path
queue = json.loads(Path(sys.argv[1]).read_text()) if Path(sys.argv[1]).exists() else {}
top_n = int(sys.argv[2])
items = queue.get("items", [])[:top_n]
for item in items:
    print(item.get("promptPath", ""))
PY
)

for relative_prompt in "${REPORT_PROMPTS[@]}"; do
  [ -n "$relative_prompt" ] || continue
  echo ""
  echo "2) file summary -> $relative_prompt"
  bash "$ROOT/scripts/open-chatgpt-web-prompt.sh" file "$ROOT/$relative_prompt"
done

echo ""
echo "3) synthesis"
bash "$ROOT/scripts/open-chatgpt-web-prompt.sh" synthesis

echo ""
echo "4) coach"
bash "$ROOT/scripts/open-chatgpt-web-prompt.sh" coach

echo ""
echo "5) advisory"
bash "$ROOT/scripts/open-chatgpt-web-prompt.sh" advisory

echo ""
echo "✅ Full sprint completed"
