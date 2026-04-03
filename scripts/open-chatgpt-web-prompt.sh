#!/bin/bash
set -euo pipefail

ROOT="/Users/seo/stock-pilot"
KNOWLEDGE_DIR="$ROOT/knowledge/daily"
REPORTS_DIR="$ROOT/reports/daily"
CHATGPT_URL="https://chatgpt.com/"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/open-chatgpt-web-prompt.sh [--no-submit] [advisory|synthesis|queue|file <path>]

Examples:
  bash scripts/open-chatgpt-web-prompt.sh advisory
  bash scripts/open-chatgpt-web-prompt.sh --no-submit synthesis
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

SUBMIT="true"
if [[ "${1:-}" == "--no-submit" ]]; then
  SUBMIT="false"
  shift
fi

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

PROMPT_B64="$(python3 - <<'PY' "$TARGET_FILE"
import base64
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
print(base64.b64encode(text.encode("utf-8")).decode("ascii"))
PY
)"

open -a Safari "$CHATGPT_URL"
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
