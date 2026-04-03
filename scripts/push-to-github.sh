#!/usr/bin/env bash
# scripts/push-to-github.sh
# 분석 결과를 GitHub의 data 브랜치에 push

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATE="${1:-$(date +%F)}"

cd "$REPO_ROOT"

echo "[push-to-github] 시작: $DATE"

# ── 1. data 브랜치로 전환 (없으면 로컬 생성) ──────────────────────────
CURRENT_BRANCH="$(git symbolic-ref --short HEAD)"

if git show-ref --verify --quiet refs/heads/data; then
  git checkout data
else
  git checkout --orphan data
  git rm -rf . --quiet || true
fi

# ── 2. 파일 add ────────────────────────────────────────────────────────
FILES_ADDED=0

add_if_exists() {
  local pattern="$1"
  # glob 확장 후 존재하는 파일만 add
  for f in $pattern; do
    if [ -f "$f" ]; then
      git add "$f"
      FILES_ADDED=$((FILES_ADDED + 1))
      echo "  + $f"
    fi
  done
}

add_if_exists "data/reports/${DATE}/compressed.json"
add_if_exists "data/market/${DATE}.json"
add_if_exists "data/technical/${DATE}.json"
add_if_exists "knowledge/daily/${DATE}-digest.md"
add_if_exists "reports/daily/${DATE}-*-briefing.md"
add_if_exists "config/strategy.json"

if [ "$FILES_ADDED" -eq 0 ]; then
  echo "[push-to-github] 추가할 파일이 없습니다. push 건너뜀."
  git checkout "$CURRENT_BRANCH"
  exit 0
fi

# ── 3. 커밋 ────────────────────────────────────────────────────────────
git commit -m "📊 daily update: ${DATE}"

# ── 4. origin/data 브랜치로 push ──────────────────────────────────────
git push -u origin data

echo "[push-to-github] push 완료."

# ── 5. main 브랜치로 복귀 ─────────────────────────────────────────────
git checkout "$CURRENT_BRANCH"

echo "[push-to-github] '${CURRENT_BRANCH}' 브랜치로 복귀 완료."
