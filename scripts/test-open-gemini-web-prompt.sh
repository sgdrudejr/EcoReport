#!/bin/bash
set -euo pipefail

ROOT="${ECOREPORT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DATE="${1:-2026-04-03}"

echo "Preparing Stage 1.5 prompt for $DATE"
cd "$ROOT"
npm run stage1.5:prompt -- --date "$DATE"

echo "Opening Gemini web and injecting prompt..."
bash "$ROOT/scripts/open-gemini-web-prompt.sh" --date "$DATE"
