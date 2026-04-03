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
IGZUN_ROOT="/Users/seo/igzun-daily-report"
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

PROMPT_TEXT="$(cat "$TARGET_FILE")"

# ── AppleScript로 ChatGPT 열고 프롬프트 붙여넣기 ─────────────────────
osascript <<APPLESCRIPT
set promptText to $(python3 -c "
import sys, json
text = open('$TARGET_FILE', 'r', encoding='utf-8').read()
print(json.dumps(text))
")

set deepResearchMode to $DEEP_RESEARCH_MODE

-- ChatGPT URL로 이동 (새 탭 또는 현재 탭)
tell application "Google Chrome"
  activate
  if (count of windows) = 0 then
    make new window
  end if
  set targetTab to null

  -- 기존 ChatGPT 탭 찾기
  repeat with w in windows
    repeat with t in tabs of w
      if URL of t contains "chatgpt.com" then
        set targetTab to t
        set active tab index of w to index of t
        set index of w to 1
        exit repeat
      end if
    end repeat
    if targetTab is not null then exit repeat
  end repeat

  -- 없으면 새 탭
  if targetTab is null then
    tell front window to make new tab with properties {URL:"https://chatgpt.com/"}
    delay 3
  else
    delay 1
  end if

  -- Deep Research 토글 클릭 (research 모드일 때)
  if deepResearchMode then
    do JavaScript "
      (function() {
        const buttons = Array.from(document.querySelectorAll('button, [role=button]'));
        const researchBtn = buttons.find(b =>
          b.textContent.includes('Research') ||
          b.textContent.includes('딥 리서치') ||
          b.getAttribute('aria-label') && b.getAttribute('aria-label').includes('Research')
        );
        if (researchBtn) { researchBtn.click(); return 'clicked'; }
        return 'not found';
      })()
    " in front document
    delay 1
  end if

  -- 프롬프트 텍스트를 클립보드에 복사
  set the clipboard to promptText

  -- textarea 또는 contenteditable에 포커스 후 붙여넣기
  do JavaScript "
    (function() {
      const selectors = [
        'div[contenteditable=true]',
        'textarea#prompt-textarea',
        'textarea[placeholder]',
        'div[data-id=root]'
      ];
      let el = null;
      for (const s of selectors) {
        el = document.querySelector(s);
        if (el) break;
      }
      if (el) { el.focus(); return 'focused'; }
      return 'not found';
    })()
  " in front document
  delay 0.5

  -- Cmd+V로 붙여넣기
  tell application "System Events"
    keystroke "v" using {command down}
  end tell
  delay 1

end tell

display notification "프롬프트 붙여넣기 완료 (" & "$MODE" & ")" with title "EcoReport"
APPLESCRIPT

echo "[open-chatgpt] ✓ 프롬프트가 ChatGPT에 붙여넣어졌습니다."
echo "[open-chatgpt] 검토 후 직접 전송(Enter)하세요."
echo ""
echo "응답 저장:"
if [ "$MODE" = "impact" ]; then
  echo "  bash $ROOT/scripts/save_chatgpt_json_response.sh $ROOT/data/reports/$DATE/impact-map.json"
else
  echo "  bash $ROOT/scripts/save_chatgpt_markdown_response.sh $MODE $DATE"
fi
