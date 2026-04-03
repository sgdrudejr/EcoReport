#!/bin/bash
set -euo pipefail

ROOT="/Users/seo/stock-pilot"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/save-chatgpt-report-response.sh <date> <report_id>

Example:
  bash scripts/save-chatgpt-report-response.sh 2026-04-03 report_001
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ $# -lt 2 ]; then
  usage
  exit $([ $# -lt 2 ] && echo 1 || echo 0)
fi

DATE="$1"
REPORT_ID="$2"
QUEUE_JSON="$ROOT/knowledge/daily/${DATE}-report-summary-queue.json"
TARGET_JSON="$ROOT/data/reports/${DATE}/manual-compressed.json"
TMP_TEXT="/tmp/ecoreport-chatgpt-response-${DATE}-${REPORT_ID}.txt"
TMP_JSON="/tmp/ecoreport-chatgpt-response-${DATE}-${REPORT_ID}.json"

mkdir -p "$(dirname "$TARGET_JSON")"

osascript -e 'tell application "Safari" to do JavaScript "document.body.innerText;" in front document' > "$TMP_TEXT"

python3 - <<'PY' "$TMP_TEXT" "$TMP_JSON"
import json
import sys
from pathlib import Path

src = Path(sys.argv[1]).read_text()
out = Path(sys.argv[2])

user_marker = "나의 말:"
assistant_marker = "ChatGPT의 말:"

if user_marker in src:
    chunk = src[src.rfind(user_marker):]
else:
    chunk = src

if assistant_marker in chunk:
    chunk = chunk[chunk.find(assistant_marker):]
else:
    raise SystemExit("Could not find a ChatGPT response after the latest user message.")

def find_valid_json(text: str):
    positions = [i for i, ch in enumerate(text) if ch == "{"] 
    for start in positions:
        depth = 0
        in_str = False
        esc = False
        for idx in range(start, len(text)):
            ch = text[idx]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            else:
                if ch == '"':
                    in_str = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        candidate = text[start:idx + 1]
                        try:
                            return json.loads(candidate)
                        except Exception:
                            break
    return None

obj = find_valid_json(chunk)
if obj is None:
    raise SystemExit("Could not extract valid JSON from ChatGPT page.")

out.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(obj, ensure_ascii=False, indent=2))
PY

python3 - <<'PY' "$QUEUE_JSON" "$REPORT_ID" "$TMP_JSON" "$TARGET_JSON"
import json
import sys
from pathlib import Path

queue_path = Path(sys.argv[1])
report_id = sys.argv[2]
response_path = Path(sys.argv[3])
target_path = Path(sys.argv[4])

queue = json.loads(queue_path.read_text()) if queue_path.exists() else {}
items = queue.get("items", [])
meta = next((item for item in items if item.get("id") == report_id), None)
if meta is None:
    raise SystemExit(f"Report id not found in queue: {report_id}")

obj = json.loads(response_path.read_text())

existing = []
if target_path.exists():
    try:
        data = json.loads(target_path.read_text())
        if isinstance(data, list):
            existing = data
    except Exception:
        existing = []

item = {
    "id": report_id,
    "schemaVersion": obj.get("schema_version", 2) if isinstance(obj, dict) else 2,
    "savedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat().replace("+00:00", "Z"),
    "rank": meta.get("rank"),
    "title": meta.get("title"),
    "broker": meta.get("broker"),
    "category": meta.get("category"),
    "priorityLabel": meta.get("priorityLabel"),
    "priorityScore": meta.get("priorityScore"),
    "reasons": meta.get("reasons", []),
    "promptPath": meta.get("promptPath"),
    **obj,
}

updated = [x for x in existing if not isinstance(x, dict) or x.get("id") != report_id]
updated.append(item)
updated.sort(key=lambda x: x.get("rank", 9999) if isinstance(x, dict) else 9999)

target_path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n")
print(target_path)
PY

echo "Saved ChatGPT JSON response:"
echo "$TARGET_JSON"
