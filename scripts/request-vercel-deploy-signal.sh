#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIGNAL_FILE="$ROOT_DIR/.vercel-deploy-trigger"
REASON="${*:-manual vercel deploy}"
REQUESTED_AT="$(date '+%Y-%m-%dT%H:%M:%S%z')"

cat >"$SIGNAL_FILE" <<EOF
requested_at=$REQUESTED_AT
reason=$REASON
EOF

echo "[vercel-signal] updated $SIGNAL_FILE"
echo "[vercel-signal] requested_at=$REQUESTED_AT"
echo "[vercel-signal] reason=$REASON"
echo "[vercel-signal] commit and push this file on main to trigger the Vercel workflow."
