#!/usr/bin/env bash
# scripts/push-to-github.sh
# 분석 결과를 GitHub의 data 브랜치에 push

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATE="${1:-$(date +%F)}"

cd "$REPO_ROOT"

echo "[push-to-github] 시작: $DATE"

TMP_WORKTREE="$(mktemp -d "${TMPDIR:-/tmp}/ecoreport-data-XXXXXX")"
FILES_ADDED=0

cleanup() {
  git worktree remove --force "$TMP_WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$TMP_WORKTREE" >/dev/null 2>&1 || true
}

trap cleanup EXIT

git fetch origin data >/dev/null 2>&1 || true

if git show-ref --verify --quiet refs/heads/data; then
  git worktree add --force "$TMP_WORKTREE" data >/dev/null
else
  git worktree add --detach "$TMP_WORKTREE" >/dev/null
  git -C "$TMP_WORKTREE" checkout --orphan data >/dev/null
  git -C "$TMP_WORKTREE" rm -rf . --quiet >/dev/null 2>&1 || true
fi

copy_if_exists() {
  local pattern="$1"
  local src
  local rel
  local target_dir

  shopt -s nullglob
  for src in "$REPO_ROOT"/$pattern; do
    [ -f "$src" ] || continue
    rel="${src#$REPO_ROOT/}"
    target_dir="$TMP_WORKTREE/$(dirname "$rel")"
    mkdir -p "$target_dir"
    cp "$src" "$TMP_WORKTREE/$rel"
    git -C "$TMP_WORKTREE" add "$rel"
    FILES_ADDED=$((FILES_ADDED + 1))
    echo "  + $rel"
  done
  shopt -u nullglob
}

copy_if_exists "data/reports/${DATE}/compressed.json"
copy_if_exists "data/market/${DATE}.json"
copy_if_exists "data/technical/${DATE}.json"
copy_if_exists "knowledge/daily/${DATE}-digest.md"
copy_if_exists "reports/daily/${DATE}-briefing.md"
copy_if_exists "reports/daily/${DATE}-*-briefing.md"
copy_if_exists "config/strategy.json"

if [ "$FILES_ADDED" -eq 0 ]; then
  echo "[push-to-github] 추가할 파일이 없습니다. push 건너뜀."
  exit 0
fi

if git -C "$TMP_WORKTREE" diff --cached --quiet; then
  echo "[push-to-github] 스테이징된 변경이 없습니다. push 건너뜀."
  exit 0
fi

git -C "$TMP_WORKTREE" commit -m "📊 daily update: ${DATE}" >/dev/null
git -C "$TMP_WORKTREE" push -u origin data >/dev/null

echo "[push-to-github] push 완료."
