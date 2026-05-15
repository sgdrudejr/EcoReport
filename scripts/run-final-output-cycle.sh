#!/usr/bin/env bash
# 기존 수집/LLM 산출물을 재사용해 최종 리포트 2종을 다시 생성합니다.

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REQUESTED_DATE=""
RUN_DATE="${RUN_DATE:-$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" --field run_date)}"
EFFECTIVE_MARKET_DATE=""
RUN_ID="${ECOREPORT_RUN_ID:-}"
SKIP_VERIFY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      REQUESTED_DATE="$2"
      shift 2
      ;;
    --run-date)
      RUN_DATE="$2"
      shift 2
      ;;
    --effective-market-date)
      EFFECTIVE_MARKET_DATE="$2"
      shift 2
      ;;
    --run-id)
      RUN_ID="$2"
      shift 2
      ;;
    --skip-verify)
      SKIP_VERIFY=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

DATE="${REQUESTED_DATE:-${EFFECTIVE_MARKET_DATE:-$RUN_DATE}}"
EFFECTIVE_MARKET_DATE="${EFFECTIVE_MARKET_DATE:-$DATE}"
if [[ -z "$RUN_ID" ]]; then
  EXISTING_RUN_ID="$(
    node --input-type=module -e "import fs from 'node:fs'; const p=process.argv[1]; try { const j=JSON.parse(fs.readFileSync(p,'utf8')); console.log(j.runId || j.run_id || ''); } catch { console.log(''); }" "$ROOT_DIR/data/analysis-state/$DATE/stage2-strategy-options.json"
  )"
  RUN_ID="${EXISTING_RUN_ID:-ecoreport-final-${DATE}-$(date +%Y%m%d%H%M%S)}"
fi
PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="python3"
fi

COMMON_ARGS=(
  --date "$DATE"
  --run-date "$RUN_DATE"
  --effective-market-date "$EFFECTIVE_MARKET_DATE"
  --run-id "$RUN_ID"
)

cd "$ROOT_DIR"

printf '== EcoReport final output cycle ==\n'
printf 'date=%s run_date=%s effective_market_date=%s run_id=%s\n' "$DATE" "$RUN_DATE" "$EFFECTIVE_MARKET_DATE" "$RUN_ID"

"$PYTHON_BIN" scripts/build-stage1-4-full-daily-report.py "${COMMON_ARGS[@]}"
if ! node scripts/collect-marketvoice-news.js "${COMMON_ARGS[@]}"; then
  printf 'WARN: marketvoice external enrichment failed; continuing with existing/empty artifact\n' >&2
fi
node scripts/build-impact-map.js "${COMMON_ARGS[@]}"
node scripts/calc-technicals.js --date "$DATE"
if ! node scripts/fetch-rss-news.js --date "$DATE"; then
  printf 'WARN: RSS news broad scan failed; continuing with remaining consensus sources\n' >&2
fi
npm run features:consensus -- "${COMMON_ARGS[@]}"
node scripts/collect-fundamental-snapshot.js "${COMMON_ARGS[@]}"
node scripts/build-stage3-quant-scores.js "${COMMON_ARGS[@]}"
node scripts/build-stage4-execution-plan.js "${COMMON_ARGS[@]}"
node scripts/build-holding-decision-cards.js "${COMMON_ARGS[@]}"
node scripts/build-dashboard-view.js "${COMMON_ARGS[@]}"
if ! "$PYTHON_BIN" scripts/build-qwen-cockpit-coach.py "${COMMON_ARGS[@]}" --web-search --forced-search --search-strategy turbo; then
  printf 'WARN: Qwen cockpit coach failed; continuing with deterministic dashboard view\n' >&2
fi
node scripts/build-dashboard-view.js "${COMMON_ARGS[@]}"
if ! "$PYTHON_BIN" scripts/build-qwen-account-strategy.py "${COMMON_ARGS[@]}" --web-search --forced-search --search-strategy turbo; then
  printf 'WARN: Qwen account strategy failed; continuing with deterministic account context\n' >&2
fi
node scripts/build-stock-pulse.js "${COMMON_ARGS[@]}"
node scripts/build-rotation-watch.js "${COMMON_ARGS[@]}"
node scripts/build-dashboard-view.js "${COMMON_ARGS[@]}"
node scripts/export-stage4-execution-plan-table.js "${COMMON_ARGS[@]}"
node scripts/build-llm-exchange-packets.js "${COMMON_ARGS[@]}"
node scripts/audit-data-quality.js "${COMMON_ARGS[@]}"
node scripts/build-llm-exchange-packets.js "${COMMON_ARGS[@]}"

if [[ "$SKIP_VERIFY" -eq 0 ]]; then
  node scripts/verify-daily-system.js "${COMMON_ARGS[@]}"
fi

node scripts/export-final-report-html.js "${COMMON_ARGS[@]}"

printf '== Final outputs ==\n'
printf '경제 리포트 HTML: %s\n' "$ROOT_DIR/reports/daily/$DATE-final.html"
printf '경제 리포트 Markdown: %s\n' "$ROOT_DIR/knowledge/daily/$DATE-full-daily-report.md"
printf 'AI 교환 JSON: %s\n' "$ROOT_DIR/data/analysis-state/$DATE/stage1-4-ai-exchange.json"
printf 'AI 교환 패킷: %s\n' "$ROOT_DIR/data/analysis-state/$DATE/llm-exchange/manifest.json"
printf '품질 감사 JSON: %s\n' "$ROOT_DIR/data/analysis-state/$DATE/data-quality-audit.json"
printf '펀더멘털/ETF 스냅샷: %s\n' "$ROOT_DIR/data/fundamentals/$DATE/security-fundamentals.json"
printf 'Qwen Cockpit 보강: %s\n' "$ROOT_DIR/data/analysis-state/$DATE/qwen-cockpit-coach.json"
printf 'Qwen 계좌전략: %s\n' "$ROOT_DIR/data/analysis-state/$DATE/qwen-account-strategy.json"
printf '개별주 속보판: %s\n' "$ROOT_DIR/data/stock-pulse/$DATE/stock-pulse.json"
printf '3주 로테이션 감지판: %s\n' "$ROOT_DIR/data/analysis-state/$DATE/rotation-watch.json"
printf '판단 Cockpit JSON: %s\n' "$ROOT_DIR/data/dashboard/$DATE-dashboard-view.json"
printf '실행 전략 Markdown: %s\n' "$ROOT_DIR/reports/daily/$DATE-stage4-execution-plan.md"
printf '실행 전략 Table: %s\n' "$ROOT_DIR/reports/daily/$DATE-stage4-execution-plan-table.md"
printf '보유종목 판단 카드: %s\n' "$ROOT_DIR/reports/daily/$DATE-holding-decision-cards.md"
