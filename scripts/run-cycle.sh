#!/usr/bin/env bash
# scripts/run-cycle.sh
# 전체 분석 사이클 실행

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATE="${1:-$(date +%F)}"

cd "$REPO_ROOT"

echo "[run-cycle] 날짜: $DATE"

# Step 1~6: 분석 파이프라인 (추후 추가)
# Step 1: ...
# Step 2: ...
# Step 3: ...
# Step 4: ...
# Step 5: ...
# Step 6: ...

# ── Step 7: GitHub data 브랜치에 결과 push ────────────────────────────
echo "[run-cycle] Step 7: GitHub push 시작..."
bash "$REPO_ROOT/scripts/push-to-github.sh" "$DATE"
echo "[run-cycle] Step 7: 완료."
