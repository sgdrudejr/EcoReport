#!/bin/bash
set -euo pipefail

ROOT="${ECOREPORT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
KNOWLEDGE_DIR="$ROOT/knowledge/daily"
REPORTS_DIR="$ROOT/reports/daily"
CHATGPT_URL="https://chatgpt.com/"
AUTO_SAVE="true"
AUTO_SAVE_TARGET=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/open-chatgpt-web-prompt.sh [--no-submit] [--no-auto-save] [advisory|synthesis|queue|triage|coach|ideas|ask <question>|file <path>]

Examples:
  bash scripts/open-chatgpt-web-prompt.sh advisory
  bash scripts/open-chatgpt-web-prompt.sh --no-submit synthesis
  bash scripts/open-chatgpt-web-prompt.sh queue
  bash scripts/open-chatgpt-web-prompt.sh triage
  bash scripts/open-chatgpt-web-prompt.sh coach
  bash scripts/open-chatgpt-web-prompt.sh ideas
  bash scripts/open-chatgpt-web-prompt.sh ask "오늘 내 포트폴리오에서 제일 위험한 계좌는 어디야?"
  bash scripts/open-chatgpt-web-prompt.sh file /Users/seo/Documents/Playground/economy-report/knowledge/daily/report-prompts/2026-04-03/report_001.md
  bash scripts/open-chatgpt-web-prompt.sh --no-auto-save file /Users/seo/Documents/Playground/economy-report/knowledge/daily/report-prompts/2026-04-03/report_001.md
EOF
}

latest_matching_file() {
  local search_dir="$1"
  local pattern="$2"

  find "$search_dir" -maxdepth 1 -type f -name "$pattern" -print0 \
    | xargs -0 ls -t 2>/dev/null \
    | head -n 1
}

SUBMIT="true"
while [[ "${1:-}" == --* ]]; do
  case "${1:-}" in
    --no-submit)
      SUBMIT="false"
      ;;
    --no-auto-save)
      AUTO_SAVE="false"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

MODE="${1:-advisory}"
TARGET_FILE=""
GENERATED_TMP_FILE=""

case "$MODE" in
  advisory)
    TARGET_FILE="$(latest_matching_file "$REPORTS_DIR" "*-advisory-prompt.md")"
    if [ -n "$TARGET_FILE" ]; then
      AUTO_SAVE_TARGET="${TARGET_FILE%-advisory-prompt.md}-briefing.md"
    fi
    ;;
  synthesis)
    TARGET_FILE="$(latest_matching_file "$KNOWLEDGE_DIR" "*-synthesis-prompt.md")"
    if [ -n "$TARGET_FILE" ]; then
      AUTO_SAVE_TARGET="${TARGET_FILE%-synthesis-prompt.md}-synthesis.md"
    fi
    ;;
  queue)
    TARGET_FILE="$(latest_matching_file "$KNOWLEDGE_DIR" "*-report-summary-queue.md")"
    ;;
  triage)
    TARGET_FILE="$(latest_matching_file "$KNOWLEDGE_DIR" "*-report-triage-prompt.md")"
    if [ -n "$TARGET_FILE" ]; then
      AUTO_SAVE_TARGET="${TARGET_FILE%-report-triage-prompt.md}-report-triage-response.md"
    fi
    ;;
  coach)
    TARGET_FILE="$(latest_matching_file "$REPORTS_DIR" "*-portfolio-coach-prompt.md")"
    if [ -n "$TARGET_FILE" ]; then
      AUTO_SAVE_TARGET="${TARGET_FILE%-portfolio-coach-prompt.md}-portfolio-coach.md"
    fi
    ;;
  ideas)
    TARGET_FILE="$(latest_matching_file "$REPORTS_DIR" "*-investment-ideas-prompt.md")"
    if [ -z "$TARGET_FILE" ]; then
      GENERATED_TMP_FILE="/tmp/ecoreport-investment-ideas-prompt.md"
      node "$ROOT/scripts/build-investment-ideas-prompt.js" \
        --date "$(date +%F)" \
        --output "$GENERATED_TMP_FILE" >/dev/null
      TARGET_FILE="$GENERATED_TMP_FILE"
    fi
    if [ -n "$TARGET_FILE" ]; then
      AUTO_SAVE_TARGET="${TARGET_FILE%-investment-ideas-prompt.md}-investment-ideas.md"
    fi
    ;;
  ask)
    shift
    QUESTION="${*:-}"
    if [ -z "$QUESTION" ]; then
      echo "Question text is required for ask mode." >&2
      exit 1
    fi
    GENERATED_TMP_FILE="/tmp/ecoreport-manual-question-prompt.md"
    node "$ROOT/scripts/build-manual-question-prompt.js" \
      --date "$(date +%F)" \
      --question "$QUESTION" \
      --output "$GENERATED_TMP_FILE" >/dev/null
    TARGET_FILE="$GENERATED_TMP_FILE"
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

PROMPT_B64="$(python3 - <<'PY' "$TARGET_FILE"
import base64
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
print(base64.b64encode(text.encode("utf-8")).decode("ascii"))
PY
)"

osascript <<APPLESCRIPT
tell application "Safari"
  activate
  if (count of documents) = 0 then
    make new document with properties {URL:"$CHATGPT_URL"}
  else
    try
      set currentUrl to URL of front document
    on error
      set currentUrl to ""
    end try
    if currentUrl does not start with "$CHATGPT_URL" then
      set URL of front document to "$CHATGPT_URL"
    end if
  end if
end tell
APPLESCRIPT
sleep 3

osascript <<APPLESCRIPT
tell application "Safari"
  activate
  set js to "(() => {
    const decodeBase64Utf8 = (value) => {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    };
    const text = decodeBase64Utf8('$PROMPT_B64');
    const textarea = document.querySelector('textarea[aria-label=\"ChatGPT와 채팅\"]') || document.querySelector('textarea');
    const editable = document.querySelector('[contenteditable=\"true\"][aria-label=\"ChatGPT와 채팅\"]') || document.querySelector('[contenteditable=\"true\"]');
    let injected = false;

    if (textarea) {
      textarea.focus();
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      injected = true;
    }

    if (editable) {
      editable.focus();
      editable.textContent = text;
      editable.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      injected = true;
    }

    let submitted = false;
    if ('$SUBMIT' === 'true') {
      const sendButton = document.querySelector('#composer-submit-button') || document.querySelector('button[data-testid=\"send-button\"]') || Array.from(document.querySelectorAll('button')).find((button) => (button.getAttribute('aria-label') || '').includes('보내기'));
      if (sendButton && !sendButton.disabled) {
        sendButton.click();
        submitted = true;
      }
    }

    return JSON.stringify({
      injected,
      submitted,
      title: document.title,
      url: location.href,
      textareaLength: textarea?.value?.length || 0,
      editableLength: editable?.textContent?.length || 0
    });
  })();"
  set resultJson to do JavaScript js in front document
end tell
APPLESCRIPT

pbcopy < "$TARGET_FILE"

echo "Opened ChatGPT web."
echo "Loaded prompt:"
echo "$TARGET_FILE"
echo "Submit mode: $SUBMIT"

if [[ "$MODE" == "file" && "$SUBMIT" == "true" && "$AUTO_SAVE" == "true" ]]; then
  REPORT_BASENAME="$(basename "$TARGET_FILE" .md)"
  REPORT_DATE="$(basename "$(dirname "$TARGET_FILE")")"

  if [[ "$REPORT_BASENAME" =~ ^report_[0-9]+$ && "$REPORT_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "Watching ChatGPT response for auto-save..."
    for _ in {1..36}; do
      sleep 5
      if bash "$ROOT/scripts/save-chatgpt-report-response.sh" "$REPORT_DATE" "$REPORT_BASENAME" >/tmp/ecoreport-auto-save.log 2>/tmp/ecoreport-auto-save.err; then
        echo "Auto-saved ChatGPT response:"
        cat /tmp/ecoreport-auto-save.log
        exit 0
      fi
    done

    echo "Auto-save timed out. You can save manually with:" >&2
    echo "bash $ROOT/scripts/save-chatgpt-report-response.sh $REPORT_DATE $REPORT_BASENAME" >&2
    exit 1
  fi
fi

if [[ "$SUBMIT" == "true" && "$AUTO_SAVE" == "true" && -n "$AUTO_SAVE_TARGET" ]]; then
  echo "Watching ChatGPT response for markdown auto-save..."
  for _ in {1..48}; do
    sleep 5
    if bash "$ROOT/scripts/save-chatgpt-markdown-response.sh" "$AUTO_SAVE_TARGET" >/tmp/ecoreport-auto-save.log 2>/tmp/ecoreport-auto-save.err; then
      echo "Auto-saved ChatGPT response:"
      cat /tmp/ecoreport-auto-save.log
      exit 0
    fi
  done

  echo "Auto-save timed out. You can save manually with:" >&2
  echo "bash $ROOT/scripts/save-chatgpt-markdown-response.sh $AUTO_SAVE_TARGET" >&2
  exit 1
fi
