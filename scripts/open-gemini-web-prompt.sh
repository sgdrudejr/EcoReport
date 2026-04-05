#!/bin/bash
set -euo pipefail

ROOT="${ECOREPORT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
GEMINI_URL="https://gemini.google.com/app"
DATE="$(date +%F)"
MODE="stage1.5"
SUBMIT="false"
TARGET_FILE=""
GENERATED_TMP_FILE=""

usage() {
  cat <<'EOF'
Usage:
  bash scripts/open-gemini-web-prompt.sh [--date YYYY-MM-DD] [--submit] [stage1.5|file <path>]

Examples:
  bash scripts/open-gemini-web-prompt.sh --date 2026-04-03
  bash scripts/open-gemini-web-prompt.sh stage1.5 --date 2026-04-03
  bash scripts/open-gemini-web-prompt.sh file /absolute/path/to/prompt.md
  bash scripts/open-gemini-web-prompt.sh --submit file /absolute/path/to/prompt.md
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      DATE="$2"
      shift 2
      ;;
    --submit)
      SUBMIT="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    stage1.5|file)
      MODE="$1"
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

case "$MODE" in
  stage1.5)
    TARGET_FILE="$ROOT/knowledge/daily/manual-kit/$DATE/07-stage1-5-gemini-deep-research-prompt.md"
    if [[ ! -f "$TARGET_FILE" ]]; then
      node "$ROOT/scripts/build-stage1-5-gemini-deep-research-prompt.js" --date "$DATE" >/dev/null
    fi
    ;;
  file)
    TARGET_FILE="${1:-}"
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    usage
    exit 1
    ;;
esac

if [[ -z "$TARGET_FILE" || ! -f "$TARGET_FILE" ]]; then
  echo "Prompt file not found: $TARGET_FILE" >&2
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
  set targetDoc to missing value
  repeat with currentDoc in documents
    try
      set currentUrl to URL of currentDoc
    on error
      set currentUrl to ""
    end try
    if currentUrl starts with "$GEMINI_URL" then
      set targetDoc to currentDoc
      exit repeat
    end if
  end repeat
  if targetDoc is missing value then
    if (count of documents) = 0 then
      make new document with properties {URL:"$GEMINI_URL"}
    else
      set targetDoc to front document
      set URL of targetDoc to "$GEMINI_URL"
    end if
  end if
end tell
APPLESCRIPT

sleep 4

RESULT_JSON=""
for _ in {1..10}; do
  RESULT_JSON="$(osascript <<APPLESCRIPT
tell application "Safari"
  set targetDoc to missing value
  repeat with currentDoc in documents
    try
      set currentUrl to URL of currentDoc
    on error
      set currentUrl to ""
    end try
    if currentUrl starts with "$GEMINI_URL" then
      set targetDoc to currentDoc
      exit repeat
    end if
  end repeat
  if targetDoc is missing value then error "gemini-document-not-found"
  set js to "(() => {
    const decodeBase64Utf8 = (value) => {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    };
    const text = decodeBase64Utf8('$PROMPT_B64');
    const composer =
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable=\"true\"][role=\"textbox\"]') ||
      document.querySelector('[contenteditable=\"true\"]') ||
      document.querySelector('rich-textarea textarea');

    let injected = false;
    if (composer) {
      composer.focus();
      if (composer.tagName === 'TEXTAREA') {
        composer.value = text;
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        composer.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        composer.textContent = text;
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      }
      injected = true;
    }

    let submitted = false;
    if ('$SUBMIT' === 'true' && injected) {
      const sendButton = document.querySelector('button[aria-label*=\"Send\"]') ||
        document.querySelector('button[aria-label*=\"보내\"]') ||
        Array.from(document.querySelectorAll('button')).find((button) => {
          const label = (button.getAttribute('aria-label') || button.textContent || '').trim();
          return /send|보내기/i.test(label);
        });
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
      composerFound: Boolean(composer),
      textareaLength: document.querySelector('textarea')?.value?.length || 0,
      editableLength: document.querySelector('[contenteditable=\"true\"]')?.textContent?.length || 0
    });
  })();"
  return do JavaScript js in targetDoc
end tell
APPLESCRIPT
)"

  if [[ -n "$RESULT_JSON" && "$RESULT_JSON" == *'"injected":true'* ]]; then
    break
  fi
  sleep 1
done

pbcopy < "$TARGET_FILE"

echo "Opened Gemini web."
echo "Loaded prompt:"
echo "$TARGET_FILE"
echo "Submit mode: $SUBMIT"
echo "Injection result: $RESULT_JSON"

if [[ "$SUBMIT" != "true" ]]; then
  echo "Deep Research 도구를 먼저 누른 뒤 전송하세요."
fi
