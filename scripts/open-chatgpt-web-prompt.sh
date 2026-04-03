#!/bin/bash
set -euo pipefail

ROOT="/Users/seo/stock-pilot"
KNOWLEDGE_DIR="$ROOT/knowledge/daily"
REPORTS_DIR="$ROOT/reports/daily"
CHATGPT_URL="https://chatgpt.com/"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/open-chatgpt-web-prompt.sh [advisory|synthesis|queue|file <path>]

Examples:
  bash scripts/open-chatgpt-web-prompt.sh advisory
  bash scripts/open-chatgpt-web-prompt.sh synthesis
  bash scripts/open-chatgpt-web-prompt.sh queue
  bash scripts/open-chatgpt-web-prompt.sh file /Users/seo/stock-pilot/knowledge/daily/report-prompts/2026-04-03/report_001.md
EOF
}

latest_matching_file() {
  local search_dir="$1"
  local pattern="$2"

  find "$search_dir" -maxdepth 1 -type f -name "$pattern" -print0 \
    | xargs -0 ls -t 2>/dev/null \
    | head -n 1
}

MODE="${1:-advisory}"
TARGET_FILE=""

case "$MODE" in
  advisory)
    TARGET_FILE="$(latest_matching_file "$REPORTS_DIR" "*-advisory-prompt.md")"
    ;;
  synthesis)
    TARGET_FILE="$(latest_matching_file "$KNOWLEDGE_DIR" "*-synthesis-prompt.md")"
    ;;
  queue)
    TARGET_FILE="$(latest_matching_file "$KNOWLEDGE_DIR" "*-report-summary-queue.md")"
    ;;
  file)
    TARGET_FILE="${2:-}"
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    usage
    exit 1
    ;;
esac

if [ -z "$TARGET_FILE" ] || [ ! -f "$TARGET_FILE" ]; then
  echo "Prompt file not found." >&2
  exit 1
fi

pbcopy < "$TARGET_FILE"
open "$CHATGPT_URL"
osascript -e "display notification \"프롬프트가 클립보드에 복사되었습니다. 브라우저에서 Cmd+V 후 전송하세요.\" with title \"EcoReport\" subtitle \"$(basename "$TARGET_FILE")\""

echo "Opened ChatGPT web."
echo "Copied to clipboard:"
echo "$TARGET_FILE"
