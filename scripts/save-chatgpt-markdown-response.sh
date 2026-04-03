#!/bin/bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/save-chatgpt-markdown-response.sh <target_path>

Example:
  bash scripts/save-chatgpt-markdown-response.sh /Users/seo/stock-pilot/knowledge/daily/2026-04-03-synthesis.md
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ $# -lt 1 ]; then
  usage
  exit $([ $# -lt 1 ] && echo 1 || echo 0)
fi

TARGET_PATH="$1"
TMP_TEXT="/tmp/ecoreport-chatgpt-markdown-response.txt"

mkdir -p "$(dirname "$TARGET_PATH")"

osascript -e 'tell application "Safari" to do JavaScript "document.body.innerText;" in front document' > "$TMP_TEXT"

python3 - <<'PY' "$TMP_TEXT" "$TARGET_PATH"
import sys
from pathlib import Path

src = Path(sys.argv[1]).read_text()
target = Path(sys.argv[2])

user_marker = "나의 말:"
assistant_marker = "ChatGPT의 말:"

if user_marker in src:
    chunk = src[src.rfind(user_marker):]
else:
    chunk = src

if assistant_marker not in chunk:
    raise SystemExit("Could not find a ChatGPT response after the latest user message.")

response = chunk[chunk.find(assistant_marker) + len(assistant_marker):].strip()

footer_markers = [
    "ChatGPT는 실수를 할 수 있습니다.",
    "쿠키 기본 설정을 참고하세요.",
]
for marker in footer_markers:
    if marker in response:
        response = response[:response.find(marker)].rstrip()

lines = [line.rstrip() for line in response.splitlines()]
cleaned = []
for line in lines:
    stripped = line.strip()
    if not cleaned and stripped in {"몇 초 동안 생각함", "생각 중"}:
        continue
    cleaned.append(line)

while cleaned and cleaned[-1].strip() in {"", "생각 중"}:
    cleaned.pop()

result = "\n".join(cleaned).strip()
if not result:
    raise SystemExit("No assistant markdown response was extracted.")

if "생각 중" in result.splitlines()[-1]:
    raise SystemExit("ChatGPT is still generating.")

target.write_text(result + "\n")
print(target)
PY

echo "Saved ChatGPT markdown response:"
echo "$TARGET_PATH"
