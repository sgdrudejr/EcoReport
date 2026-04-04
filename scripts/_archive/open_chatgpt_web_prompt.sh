#!/usr/bin/env bash
# open_chatgpt_web_prompt.sh
# 지정된 프롬프트 파일을 ChatGPT 웹 UI에 자동으로 붙여넣고 전송한다.
#
# 사용법:
#   bash scripts/open_chatgpt_web_prompt.sh <mode> [--date YYYY-MM-DD]
#   bash scripts/open_chatgpt_web_prompt.sh impact
#   bash scripts/open_chatgpt_web_prompt.sh synthesis --date 2026-04-03
#   bash scripts/open_chatgpt_web_prompt.sh research
#   bash scripts/open_chatgpt_web_prompt.sh file path/to/prompt.md
#
# 모드: triage | synthesis | advisory | impact | research | file

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATE="$(date +%F)"
MODE="${1:-triage}"
DEEP_RESEARCH_MODE="false"
TARGET_FILE=""

# 인수 파싱
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --date) DATE="$2"; shift 2 ;;
    *) break ;;
  esac
done

KNOWLEDGE_DIR="$ROOT/knowledge/daily"
WEEKLY_DIR="$ROOT/knowledge/weekly"

latest_matching_file() {
  local dir="$1"
  local pattern="$2"
  find "$dir" -name "$pattern" 2>/dev/null | sort | tail -1
}

# ── 모드별 프롬프트 파일 선택 ─────────────────────────────────────────
case "$MODE" in
  triage)
    TARGET_FILE="$KNOWLEDGE_DIR/${DATE}-triage-prompt.md"
    if [ ! -f "$TARGET_FILE" ]; then
      echo "[open-chatgpt] triage 프롬프트 생성 중..."
      python3 "$ROOT/scripts/build_report_triage_prompt.py" --date "$DATE"
    fi
    ;;

  synthesis)
    TARGET_FILE="$KNOWLEDGE_DIR/${DATE}-synthesis-prompt.md"
    if [ ! -f "$TARGET_FILE" ]; then
      echo "[open-chatgpt] synthesis 프롬프트 생성 중..."
      python3 "$ROOT/scripts/build_synthesis_prompt.py" --date "$DATE"
    fi
    ;;

  advisory)
    # advisory는 synthesis 결과를 바탕으로 하는 후속 프롬프트
    TARGET_FILE="$(latest_matching_file "$KNOWLEDGE_DIR" "*-synthesis-prompt.md")"
    if [ -z "$TARGET_FILE" ]; then
      echo "[open-chatgpt] ⚠️ synthesis 프롬프트를 먼저 실행하세요."
      exit 1
    fi
    ;;

  impact)
    TARGET_FILE="$KNOWLEDGE_DIR/${DATE}-impact-map-prompt.md"
    if [ ! -f "$TARGET_FILE" ]; then
      echo "[open-chatgpt] impact-map 프롬프트 생성 중..."
      python3 "$ROOT/scripts/build_impact_map_prompt.py" --date "$DATE"
    fi
    ;;

  research)
    TARGET_FILE="$(latest_matching_file "$WEEKLY_DIR" "*-deep-research-prompt.md")"
    if [ -z "$TARGET_FILE" ]; then
      echo "[open-chatgpt] deep research 프롬프트 생성 중..."
      python3 "$ROOT/scripts/build_deep_research_prompt.py" --date "$DATE"
      TARGET_FILE="$WEEKLY_DIR/${DATE}-deep-research-prompt.md"
    fi
    DEEP_RESEARCH_MODE="true"
    ;;

  file)
    TARGET_FILE="${1:-}"
    if [ -z "$TARGET_FILE" ] || [ ! -f "$TARGET_FILE" ]; then
      echo "사용법: bash open_chatgpt_web_prompt.sh file path/to/prompt.md"
      exit 1
    fi
    ;;

  *)
    echo "알 수 없는 모드: $MODE"
    echo "사용 가능: triage | synthesis | advisory | impact | research | file"
    exit 1
    ;;
esac

if [ ! -f "$TARGET_FILE" ]; then
  echo "[open-chatgpt] ❌ 프롬프트 파일을 찾을 수 없습니다: $TARGET_FILE"
  exit 1
fi

echo "[open-chatgpt] 모드: $MODE | 파일: $TARGET_FILE"
echo "[open-chatgpt] Deep Research 모드: $DEEP_RESEARCH_MODE"

# ── 1. 프롬프트를 클립보드에 복사 (pbcopy 사용, AppleScript 이스케이프 문제 회피) ──
cat "$TARGET_FILE" | pbcopy
echo "[open-chatgpt] ✓ 클립보드에 복사 완료 ($(wc -c < "$TARGET_FILE") bytes)"

# ── 2. AppleScript: ChatGPT 탭 열기 + Cmd+V ─────────────────────────
APPLESCRIPT_FILE="/tmp/ecoreport_open_$$.applescript"
cat > "$APPLESCRIPT_FILE" <<'EOF'
tell application "Google Chrome"
  activate
  set foundTab to false
  repeat with w in windows
    set tabCount to count tabs of w
    repeat with i from 1 to tabCount
      set t to tab i of w
      if URL of t contains "chatgpt.com" then
        tell w
          set active tab index to i
        end tell
        set index of w to 1
        set foundTab to true
        exit repeat
      end if
    end repeat
    if foundTab then exit repeat
  end repeat
  if not foundTab then
    if (count of windows) = 0 then
      make new window
    end if
    tell front window to make new tab with properties {URL:"https://chatgpt.com/"}
    delay 4
  else
    delay 1
  end if
end tell
delay 1
tell application "System Events"
  tell process "Google Chrome"
    keystroke "v" using {command down}
  end tell
end tell
display notification "프롬프트 붙여넣기 완료" with title "EcoReport"
EOF

osascript "$APPLESCRIPT_FILE"
rm -f "$APPLESCRIPT_FILE"

echo "[open-chatgpt] ✓ 프롬프트가 ChatGPT에 붙여넣어졌습니다."
echo "[open-chatgpt] 검토 후 직접 전송(Enter)하세요."
echo ""
echo "응답 저장:"
if [ "$MODE" = "impact" ]; then
  echo "  bash $ROOT/scripts/save_chatgpt_json_response.sh $ROOT/data/reports/$DATE/impact-map.json"
else
  echo "  bash $ROOT/scripts/save_chatgpt_markdown_response.sh $MODE $DATE"
fi
