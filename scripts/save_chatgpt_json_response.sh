#!/usr/bin/env bash
# save_chatgpt_json_response.sh
# ChatGPT 웹 UI의 마지막 응답에서 JSON 배열을 추출하여 파일로 저장한다.
#
# 사용법:
#   bash scripts/save_chatgpt_json_response.sh /path/to/output.json

set -euo pipefail

OUTPUT_FILE="${1:-}"
if [ -z "$OUTPUT_FILE" ]; then
  echo "사용법: bash save_chatgpt_json_response.sh /path/to/output.json"
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"
TEMP_RAW="/tmp/chatgpt_raw_$$.txt"

# ── AppleScript로 ChatGPT 응답 텍스트 추출 ─────────────────────────────
osascript <<APPLESCRIPT > "$TEMP_RAW"
tell application "Google Chrome"
  -- ChatGPT 탭 찾기
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

  -- 마지막 assistant 메시지 텍스트 추출
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
  echo "[save-json] ❌ ChatGPT 응답을 읽을 수 없습니다."
  rm -f "$TEMP_RAW"
  exit 1
fi

echo "[save-json] 응답 텍스트 추출 완료 ($(wc -c < "$TEMP_RAW") bytes)"

# ── Python으로 JSON 배열 추출 ──────────────────────────────────────────
python3 - "$TEMP_RAW" "$OUTPUT_FILE" <<'PYEOF'
import sys
import json
import re

raw_file = sys.argv[1]
out_file = sys.argv[2]

text = open(raw_file, encoding='utf-8').read()

# JSON 블록 찾기 (```json ... ``` 또는 [ ... ] 패턴)
patterns = [
    r'```json\s*(\[[\s\S]*?\])\s*```',   # ```json [...] ```
    r'```\s*(\[[\s\S]*?\])\s*```',        # ``` [...] ```
    r'(\[[\s\S]*?\])',                     # 그냥 [ ... ]
]

json_data = None
for pattern in patterns:
    matches = re.findall(pattern, text, re.DOTALL)
    for m in reversed(matches):  # 마지막 매칭 우선
        try:
            parsed = json.loads(m.strip())
            if isinstance(parsed, list):
                json_data = parsed
                break
        except json.JSONDecodeError:
            continue
    if json_data is not None:
        break

if json_data is None:
    print("[save-json] ❌ 유효한 JSON 배열을 찾을 수 없습니다.", file=sys.stderr)
    print(f"[save-json] 원본 텍스트 앞부분:\n{text[:500]}", file=sys.stderr)
    sys.exit(1)

with open(out_file, 'w', encoding='utf-8') as f:
    json.dump(json_data, f, ensure_ascii=False, indent=2)

print(f"[save-json] ✓ {len(json_data)}개 항목 저장: {out_file}")
PYEOF

STATUS=$?
rm -f "$TEMP_RAW"

if [ $STATUS -eq 0 ]; then
  echo "[save-json] 유효성 검사 중..."
  python3 -c "import json,sys; data=json.load(open('$OUTPUT_FILE')); print(f'[save-json] ✓ JSON 유효 ({len(data)}개 항목)')"
fi

exit $STATUS
