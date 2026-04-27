#!/usr/bin/env bash
# scripts/push-to-github.sh
# 분석 결과를 GitHub의 data 브랜치에 push

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATE="${1:-$(node "$REPO_ROOT/scripts/resolve-cycle-date.js" --field effective_market_date)}"
RUN_DATE="${RUN_DATE:-$(node "$REPO_ROOT/scripts/resolve-cycle-date.js" --field run_date)}"

cd "$REPO_ROOT"

echo "[push-to-github] 시작: $DATE"

require_complete_system_health() {
  local health_file="$REPO_ROOT/data/analysis-state/$DATE/system-health.json"

  if [[ "${ALLOW_INCOMPLETE_DATA_PUSH:-}" == "1" ]]; then
    echo "[push-to-github] ALLOW_INCOMPLETE_DATA_PUSH=1 설정으로 system-health gate를 건너뜁니다."
    return 0
  fi

  if [[ ! -f "$health_file" ]]; then
    echo "[push-to-github] 차단: $health_file 없음. verify-daily-system을 먼저 통과해야 합니다." >&2
    return 1
  fi

  node - "$health_file" <<'NODE'
const fs = require("fs");
const healthPath = process.argv[2];
const health = JSON.parse(fs.readFileSync(healthPath, "utf8"));
const status = health.overallStatus ?? health.status ?? "missing";

if (status !== "ok") {
  console.error(`[push-to-github] 차단: system-health overallStatus=${status}. 완성 데이터(ok)만 data 브랜치에 push합니다.`);
  const badChecks = (health.checks ?? [])
    .filter((item) => item.status && item.status !== "ok")
    .slice(0, 8)
    .map((item) => `- ${item.status} ${item.key ?? item.label ?? "unknown"}: ${item.detail ?? item.message ?? ""}`);
  if (badChecks.length) {
    console.error(badChecks.join("\n"));
  }
  process.exit(1);
}
NODE
}

require_complete_system_health

TMP_WORKTREE="$(mktemp -d "${TMPDIR:-/tmp}/ecoreport-data-XXXXXX")"
FILES_ADDED=0

cleanup() {
  git worktree remove --force "$TMP_WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$TMP_WORKTREE" >/dev/null 2>&1 || true
}

trap cleanup EXIT

wait_for_github() {
  local delays=(0 15 30)
  local delay
  local index=0

  for delay in "${delays[@]}"; do
    if node "$REPO_ROOT/scripts/check-network-health.js" --targets "https://github.com" --field ready --attempts 1 --timeout-ms 8000 >/dev/null 2>&1; then
      return 0
    fi

    if [[ "$delay" -gt 0 && "$index" -lt $((${#delays[@]} - 1)) ]]; then
      echo "[push-to-github] github.com 네트워크 회복 대기 ${delay}s"
      sleep "$delay"
    fi
    index=$((index + 1))
  done

  echo "[push-to-github] github.com 네트워크 점검 실패"
  node "$REPO_ROOT/scripts/check-network-health.js" --targets "https://github.com" --field summary --attempts 1 --timeout-ms 8000 || true
  return 1
}

run_git_with_retry() {
  local label="$1"
  shift
  local attempt
  local exit_code=0

  for attempt in 1 2 3; do
    if "$@"; then
      return 0
    else
      exit_code=$?
    fi
    echo "[push-to-github] ${label} 실패 (attempt ${attempt}/3, exit ${exit_code})"
    if [[ "$attempt" -lt 3 ]]; then
      wait_for_github || true
      sleep 2
    fi
  done

  return "$exit_code"
}

wait_for_github

if run_git_with_retry "ls-remote data" git ls-remote --exit-code --heads origin data >/dev/null 2>&1; then
  run_git_with_retry "fetch data" git fetch origin data >/dev/null
  git worktree add --detach "$TMP_WORKTREE" "$(git rev-parse FETCH_HEAD)" >/dev/null
elif git show-ref --verify --quiet refs/heads/data; then
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
copy_if_exists "data/portfolio/latest.json"
copy_if_exists "data/technical/${DATE}.json"
copy_if_exists "data/technical/${DATE}-coverage-gap.json"
copy_if_exists "data/reports/${DATE}/crawl-manifest.json"
copy_if_exists "data/reports/${DATE}/crawl-manifest.md"
copy_if_exists "data/reports/${DATE}/text-manifest.json"
copy_if_exists "data/reports/${DATE}/text-manifest.md"
copy_if_exists "data/reports/${DATE}/rag/chunk-manifest.json"
copy_if_exists "data/analysis-state/${DATE}/stage1-report-extracts-v2.json"
copy_if_exists "data/analysis-state/${DATE}/stage2-strategy-options.json"
copy_if_exists "data/analysis-state/${DATE}/stage2-strategy-options.raw.txt"
copy_if_exists "data/analysis-state/${DATE}/marketvoice-linked.json"
copy_if_exists "data/analysis-state/${DATE}/stage3-quant-scores.json"
copy_if_exists "data/analysis-state/${DATE}/stage4-execution-plan.json"
copy_if_exists "data/analysis-state/${DATE}/stage1-4-full-daily-report.json"
copy_if_exists "data/analysis-state/${DATE}/stage1-4-ai-exchange.json"
copy_if_exists "data/analysis-state/${DATE}/stage1-4-insight-atoms.json"
copy_if_exists "data/analysis-state/${DATE}/data-quality-audit.json"
copy_if_exists "data/analysis-state/${DATE}/llm-exchange/*.json"
copy_if_exists "data/analysis-state/${DATE}/system-health.json"
copy_if_exists "data/analysis-state/${DATE}/automation-cycle.json"
copy_if_exists "knowledge/daily/${DATE}-report-summary-queue.json"
copy_if_exists "knowledge/daily/${DATE}-report-summary-queue.md"
copy_if_exists "knowledge/daily/${DATE}-report-triage-prompt.md"
copy_if_exists "knowledge/daily/${DATE}-report-triage-response.md"
copy_if_exists "knowledge/daily/${DATE}-synthesis-prompt.md"
copy_if_exists "knowledge/daily/${DATE}-marketvoice.md"
copy_if_exists "knowledge/daily/${DATE}-stage1-report-extracts-v2.md"
copy_if_exists "knowledge/daily/${DATE}-digest.md"
copy_if_exists "knowledge/daily/${DATE}-gemini-briefing.md"
copy_if_exists "knowledge/daily/${DATE}-gemini-briefing.md.meta.json"
copy_if_exists "knowledge/daily/${DATE}-gemini-briefing-rich.md"
copy_if_exists "knowledge/daily/${DATE}-gemini-briefing-rich.md.meta.json"
copy_if_exists "knowledge/daily/${DATE}-full-daily-report.md"
copy_if_exists "knowledge/daily/${DATE}-system-health.md"
copy_if_exists "knowledge/daily/${DATE}-automation-cycle.md"
copy_if_exists "knowledge/daily/manual-kit/${DATE}/*.md"
copy_if_exists "knowledge/daily/report-prompts/${DATE}/*.md"
copy_if_exists "knowledge/rag/${DATE}/parallel-manifest.json"
copy_if_exists "knowledge/rag/${DATE}/parallel-corpus.md"
copy_if_exists "reports/daily/${DATE}-briefing.md"
copy_if_exists "reports/daily/${DATE}-*-briefing.md"
copy_if_exists "reports/daily/${DATE}-portfolio-coach-prompt.md"
copy_if_exists "reports/daily/${DATE}-investment-ideas-prompt.md"
copy_if_exists "reports/daily/${DATE}-*-advisory-prompt.md"
copy_if_exists "reports/daily/${DATE}-stage4-execution-plan.md"
copy_if_exists "reports/daily/${DATE}-stage4-execution-plan-table.md"
copy_if_exists "reports/daily/${DATE}-stage4-execution-plan-telegram.txt"
copy_if_exists "reports/daily/${DATE}-final.html"
copy_if_exists "config/strategy.json"

if [ "$FILES_ADDED" -eq 0 ]; then
  echo "[push-to-github] 추가할 파일이 없습니다. push 건너뜀."
  exit 0
fi

if git -C "$TMP_WORKTREE" diff --cached --quiet; then
  echo "[push-to-github] 스테이징된 변경이 없습니다. push 건너뜀."
  exit 0
fi

COMMIT_MESSAGE="📊 daily update: ${DATE}"
if [ "$RUN_DATE" != "$DATE" ]; then
  COMMIT_MESSAGE="${COMMIT_MESSAGE} (run ${RUN_DATE})"
fi
git -C "$TMP_WORKTREE" commit -m "$COMMIT_MESSAGE" >/dev/null
run_git_with_retry "push data" git -C "$TMP_WORKTREE" push -u origin HEAD:data >/dev/null

echo "[push-to-github] push 완료."
