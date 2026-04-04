#!/usr/bin/env bash
# save_chatgpt_markdown_response.sh
# ChatGPT 웹 UI의 마지막 응답을 Markdown 파일로 저장한다.
#
# 사용법:
#   bash scripts/save_chatgpt_markdown_response.sh <mode> [date]
#   bash scripts/save_chatgpt_markdown_response.sh triage 2026-04-03
#   bash scripts/save_chatgpt_markdown_response.sh synthesis

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-response}"
DATE="${2:-$(date +%F)}"

# 모드별 저장 경로
case "$MODE" in
  triage)     OUT_FILE="$ROOT/knowledge/daily/${DATE}-triage-result.md" ;;
  synthesis)  OUT_FILE="$ROOT/knowledge/daily/${DATE}-synthesis-result.md" ;;
  advisory)   OUT_FILE="$ROOT/knowledge/daily/${DATE}-advisory-result.md" ;;
  research)   OUT_FILE="$ROOT/knowledge/weekly/${DATE}-deep-research-result.md" ;;
  *)          OUT_FILE="$ROOT/knowledge/daily/${DATE}-${MODE}-result.md" ;;
esac

mkdir -p "$(dirname "$OUT_FILE")"
TEMP_RAW="/tmp/chatgpt_md_raw_$$.txt"

# ── AppleScript로 ChatGPT 응답 추출 ────────────────────────────────────
osascript <<APPLESCRIPT > "$TEMP_RAW"
tell application "Google Chrome"
  set targetTab to null
  repeat with w in windows
    repeat with t in tabs of w
      if URL of t contains "chatgpt.com" then
        set targetTab to t
        exit repeat
      end if
    end repeat
    if targetTab is not null then exit repeat
  end repeat

  if targetTab is null then
    error "ChatGPT 탭을 찾을 수 없습니다."
  end if

  set responseText to do JavaScript "
    (function() {
      const messages = document.querySelectorAll(
        '[data-message-author-role=assistant], .markdown.prose'
      );
      if (messages.length === 0) return '';
      const last = messages[messages.length - 1];
      return last.innerText || last.textContent || '';
    })()
  " in targetTab

  return responseText
end tell
APPLESCRIPT

if [ ! -s "$TEMP_RAW" ]; then
  echo "[save-md] ❌ ChatGPT 응답을 읽을 수 없습니다."
  rm -f "$TEMP_RAW"
  exit 1
fi

# 메타데이터 헤더 추가 후 저장
{
  echo "---"
  echo "date: $DATE"
  echo "mode: $MODE"
  echo "saved: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "---"
  echo ""
  cat "$TEMP_RAW"
} > "$OUT_FILE"

rm -f "$TEMP_RAW"

LINES=$(wc -l < "$OUT_FILE")
echo "[save-md] ✓ 저장 완료: $OUT_FILE ($LINES 줄)"
