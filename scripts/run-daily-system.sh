#!/usr/bin/env bash
# EcoReport를 매일 운영 가능한 형태로 끝까지 실행하는 일일 마스터 러너

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REQUESTED_DATE=""
RUN_DATE="${RUN_DATE:-$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" --field run_date)}"
EFFECTIVE_MARKET_DATE=""
RUN_ID="${ECOREPORT_RUN_ID:-}"
SKIP_COLLECT=0
SKIP_RAG=0
SKIP_PUSH=0
SKIP_VERIFY=0
SKIP_STRATEGY=0
SKIP_WIKI=0
SKIP_TELEGRAM=0
FORCE_COLLECT=0
STAGE2_MODE="qwen"
RUN_GEMINI_BRIEFING="auto"
SOFT_FAILURE_COUNT=0
USE_DAG=0
BASELINE_ONLY=0

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
    --skip-collect)
      SKIP_COLLECT=1
      shift
      ;;
    --skip-rag)
      SKIP_RAG=1
      shift
      ;;
    --skip-push)
      SKIP_PUSH=1
      shift
      ;;
    --skip-verify)
      SKIP_VERIFY=1
      shift
      ;;
    --skip-strategy)
      SKIP_STRATEGY=1
      shift
      ;;
    --skip-wiki)
      SKIP_WIKI=1
      shift
      ;;
    --skip-telegram)
      SKIP_TELEGRAM=1
      shift
      ;;
    --force-collect)
      FORCE_COLLECT=1
      shift
      ;;
    --gemini-stage2)
      STAGE2_MODE="qwen"
      shift
      ;;
    --claude-stage2)
      echo "ERROR: --claude-stage2 is no longer supported." >&2
      exit 2
      ;;
    --mock-stage2)
      echo "ERROR: --mock-stage2 is disabled. Stage 2 must use a real LLM provider and fail-fast on errors." >&2
      exit 2
      ;;
    --use-dag)
      USE_DAG=1
      shift
      ;;
    --baseline-only)
      BASELINE_ONLY=1
      shift
      ;;
    --no-gemini-briefing)
      RUN_GEMINI_BRIEFING="no"
      shift
      ;;
    --gemini-briefing)
      RUN_GEMINI_BRIEFING="yes"
      shift
      ;;
    *)
      REQUESTED_DATE="$1"
      shift
      ;;
  esac
done

if [[ "$BASELINE_ONLY" == "1" ]]; then
  SKIP_STRATEGY=1
  SKIP_WIKI=1
  SKIP_PUSH=1
  SKIP_VERIFY=1
  RUN_GEMINI_BRIEFING="no"
fi

if [[ -z "$EFFECTIVE_MARKET_DATE" ]]; then
  RESOLVE_ARGS=()
  if [[ -n "$REQUESTED_DATE" ]]; then
    RESOLVE_ARGS+=(--date "$REQUESTED_DATE")
  fi
  if [[ -n "$RUN_DATE" ]]; then
    RESOLVE_ARGS+=(--run-date "$RUN_DATE")
  fi
  EFFECTIVE_MARKET_DATE="$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" "${RESOLVE_ARGS[@]}" --field effective_market_date)"
fi

DATE="$EFFECTIVE_MARKET_DATE"
if [[ -z "$RUN_ID" ]]; then
  RUN_ID="${RUN_DATE}-$(date -u +%H%M%S)"
fi
export ECOREPORT_RUN_ID="$RUN_ID"
RESOLVE_REASON_ARGS=()
if [[ -n "$REQUESTED_DATE" ]]; then
  RESOLVE_REASON_ARGS+=(--date "$REQUESTED_DATE")
fi
RESOLVE_REASON_ARGS+=(--run-date "$RUN_DATE")
RESOLUTION_REASON="$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" "${RESOLVE_REASON_ARGS[@]}" --field reason)"

cd "$ROOT_DIR"

LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"
TIME="$(date +%H%M)"
LOG_FILE="$LOG_DIR/$DATE-$TIME-daily-system.log"
FALLBACK_SUMMARY_JSON="$ROOT_DIR/data/analysis-state/$DATE/fallback-summary.json"
FALLBACK_SUMMARY_MD="$ROOT_DIR/data/analysis-state/$DATE/fallback-summary.md"
rm -f "$FALLBACK_SUMMARY_JSON" "$FALLBACK_SUMMARY_MD"

log() {
  echo "$1" | tee -a "$LOG_FILE"
}

run_step() {
  local label="$1"
  shift
  log "$label"
  "$@" >>"$LOG_FILE" 2>&1
}

run_retrying_step() {
  local label="$1"
  local attempts="$2"
  shift 2

  local attempt=1
  local exit_code=0

  while [[ "$attempt" -le "$attempts" ]]; do
    log "$label (attempt $attempt/$attempts)"
    if "$@" >>"$LOG_FILE" 2>&1; then
      return 0
    else
      exit_code=$?
    fi
    if [[ "$attempt" -lt "$attempts" ]]; then
      log "⚠️ 단계 실패 (exit $exit_code), 잠시 후 재시도합니다."
      sleep 2
    fi
    attempt=$((attempt + 1))
  done

  log "⚠️ 단계가 모든 재시도 후에도 실패했습니다. (exit $exit_code)"
  return "$exit_code"
}

run_soft_step() {
  local label="$1"
  shift
  log "$label"
  local exit_code=0
  if "$@" >>"$LOG_FILE" 2>&1; then
    return 0
  else
    exit_code=$?
  fi
  log "⚠️ 단계 실패 (exit $exit_code), 다음 단계로 계속 진행합니다."
  return 1
}

run_nonfatal_step() {
  if run_soft_step "$@"; then
    return 0
  fi
  SOFT_FAILURE_COUNT=$((SOFT_FAILURE_COUNT + 1))
  return 0
}

run_parallel_nonfatal_group() {
  local group_dir
  group_dir="$(mktemp -d)"
  local -a pids=()
  local -a names=()

  while [[ $# -gt 0 ]]; do
    local key="$1"
    local label="$2"
    local command="$3"
    shift 3

    local -a cmd_args=()
    while [[ $# -gt 0 && "$1" != "--next" ]]; do
      cmd_args+=("$1")
      shift
    done
    if [[ $# -gt 0 && "$1" == "--next" ]]; then
      shift
    fi

    names+=("$key")
    (
      log "$label"
      local exit_code=0
      if "$command" "${cmd_args[@]}" >>"$LOG_FILE" 2>&1; then
        echo "0" >"$group_dir/$key"
      else
        exit_code=$?
        log "⚠️ 단계 실패 (exit $exit_code), 다음 단계로 계속 진행합니다."
        echo "$exit_code" >"$group_dir/$key"
      fi
    ) &
    pids+=("$!")
  done

  for pid in "${pids[@]}"; do
    wait "$pid" || true
  done

  for key in "${names[@]}"; do
    local status_file="$group_dir/$key"
    if [[ ! -f "$status_file" ]]; then
      SOFT_FAILURE_COUNT=$((SOFT_FAILURE_COUNT + 1))
      continue
    fi
    local exit_code
    exit_code="$(cat "$status_file")"
    if [[ "$exit_code" != "0" ]]; then
      SOFT_FAILURE_COUNT=$((SOFT_FAILURE_COUNT + 1))
    fi
  done

  rm -rf "$group_dir"
}

has_gemini_key() {
  local env_file="$ROOT_DIR/.env"
  if [[ -f "$env_file" ]] && grep -Eq '^GEMINI_API_KEY=.+$' "$env_file"; then
    return 0
  fi
  [[ -n "${GEMINI_API_KEY:-}" ]]
}

python_bin() {
  if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
    echo "$ROOT_DIR/.venv/bin/python"
  else
    echo "python3"
  fi
}

read_report_count() {
  node -e "const fs=require('fs');const p=process.argv[1];try{const raw=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(Array.isArray(raw)?raw.length:0));}catch{process.stdout.write('0');}" "$ROOT_DIR/data/reports/$DATE/index.json"
}

read_report_text_success_count() {
  node -e "const fs=require('fs');const p=process.argv[1];try{const raw=JSON.parse(fs.readFileSync(p,'utf8'));process.stdout.write(String(Number(raw?.success_count ?? 0)));}catch{process.stdout.write('0');}" "$ROOT_DIR/data/reports/$DATE/text-manifest.json"
}

log_network_probe() {
  local label="$1"
  local targets="$2"
  local summary
  summary="$(node scripts/check-network-health.js --targets "$targets" --field summary --attempts 1 --timeout-ms 8000 2>/dev/null || true)"
  if [[ -n "$summary" ]]; then
    log "🌐 $label 네트워크 상태: $summary"
  fi
}

recover_same_day_collection() {
  local delays=(20 40 80)
  local report_count
  local text_success
  local attempt=1

  report_count="$(read_report_count)"
  text_success="$(read_report_text_success_count)"
  if [[ "${report_count:-0}" -gt 0 && "${text_success:-0}" -gt 0 ]]; then
    return 0
  fi

  for delay in "${delays[@]}"; do
    log "⚠️ same-day 리포트 산출물이 부족합니다. ${delay}s 대기 후 강제 재수집합니다. (recovery $attempt/${#delays[@]})"
    log_network_probe "리포트 수집" "https://finance.naver.com/research/company_list.naver?page=1,https://www.shinhansec.com/siw/etc/browse/search05/data.do"
    sleep "$delay"
    if run_retrying_step "📡 리포트 수집 + 전문 텍스트화 (same-day recovery)..." 1 bash scripts/collect-report-assets.sh --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE" --force; then
      report_count="$(read_report_count)"
      text_success="$(read_report_text_success_count)"
      if [[ "${report_count:-0}" -gt 0 && "${text_success:-0}" -gt 0 ]]; then
        log "✅ same-day 리포트 수집 복구 완료: ${report_count}건 / 전문 ${text_success}건"
        return 0
      fi
    fi
    attempt=$((attempt + 1))
  done

  return 1
}

log "=================================================="
log "🚀 EcoReport Daily System 시작 (run: $RUN_DATE / effective: $DATE)"
log "🧬 run-id: $RUN_ID"
log "🗓️ 날짜 해석 사유: $RESOLUTION_REASON"
log "📁 로그: $LOG_FILE"
if [[ "$BASELINE_ONLY" == "1" ]]; then
  log "🧩 baseline-only 모드: 수집/텍스트화/RAG까지만 실행하고 전략·위키·push·verify는 건너뜁니다."
fi
log "=================================================="

if [[ "$SKIP_COLLECT" == "1" ]]; then
  log "📡 수집 단계 건너뜀 (--skip-collect)"
else
  COLLECT_ARGS=(--date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE")
  if [[ "$FORCE_COLLECT" == "1" ]]; then
    COLLECT_ARGS+=(--force)
  fi
  collect_ready=0
  if run_retrying_step "📡 리포트 수집 + 전문 텍스트화..." 2 bash scripts/collect-report-assets.sh "${COLLECT_ARGS[@]}"; then
    collect_ready=1
  fi

  if [[ "$collect_ready" != "1" ]] || ! recover_same_day_collection; then
    log "⚠️ same-day 리포트 수집 복구에 실패했습니다. 이전 거래일 리포트 fallback 또는 placeholder로 계속 진행합니다."
    node scripts/ensure-daily-fallbacks.js \
      --date "$DATE" \
      --run-date "$RUN_DATE" \
      --effective-market-date "$DATE" \
      --mode reports \
      --reason "same-day report recovery exhausted" >>"$LOG_FILE" 2>&1
    SOFT_FAILURE_COUNT=$((SOFT_FAILURE_COUNT + 1))
  fi
fi

node scripts/ensure-daily-fallbacks.js \
  --date "$DATE" \
  --run-date "$RUN_DATE" \
  --effective-market-date "$DATE" \
  --mode reports \
  --reason "post-collect validation" >>"$LOG_FILE" 2>&1

if [[ "$BASELINE_ONLY" != "1" ]]; then
  run_step "🪟 Windows 로컬 요약(필수)..." \
    bash scripts/run-local-report-orchestrator.sh --date "$DATE"
fi

if ! run_retrying_step "🏦 KIS 포트폴리오 동기화..." 2 node scripts/sync-kis-portfolio.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"; then
  log "⚠️ KIS 포트폴리오 동기화 실패, 기존 latest.json 으로 계속 진행합니다."
  run_nonfatal_step "📨 Telegram KIS 오류 알림..." \
    node scripts/send-telegram-summary.js \
      --date "$DATE" \
      --event "kis-sync-error" \
      --message "KIS 포트폴리오 동기화 실패 - 기존 latest.json fallback 사용"
  SOFT_FAILURE_COUNT=$((SOFT_FAILURE_COUNT + 1))
fi

if ! run_retrying_step "📈 시장 데이터 수집..." 2 node scripts/fetch-market-data.js --date "$DATE"; then
  log "⚠️ 시장 데이터 수집 실패, fallback market snapshot으로 계속 진행합니다."
  node scripts/ensure-daily-fallbacks.js \
    --date "$DATE" \
    --run-date "$RUN_DATE" \
    --effective-market-date "$DATE" \
    --mode market \
    --reason "fetch-market-data failed after retries" >>"$LOG_FILE" 2>&1
  SOFT_FAILURE_COUNT=$((SOFT_FAILURE_COUNT + 1))
fi

node scripts/ensure-daily-fallbacks.js \
  --date "$DATE" \
  --run-date "$RUN_DATE" \
  --effective-market-date "$DATE" \
  --mode market \
  --reason "post-market validation" >>"$LOG_FILE" 2>&1

run_nonfatal_step "📣 머니토링 시황 이벤트 수집..." \
  node scripts/collect-marketvoice-news.js \
    --date "$DATE" \
    --run-date "$RUN_DATE" \
    --effective-market-date "$DATE"

# FRED API 키가 있으면 거시경제 선행지표 수집 (레짐 감지 + Stage 3 선행지표 스코어에 활용)
PYTHON_BIN_DAILY="$(python_bin)"
if grep -Eq '^FRED_API_KEY=.+$' "$ROOT_DIR/.env" 2>/dev/null || [[ -n "${FRED_API_KEY:-}" ]]; then
  run_nonfatal_step "🌐 FRED 거시경제 데이터 수집..." "$PYTHON_BIN_DAILY" scripts/fetch-fred-macro.py --date "$DATE"
else
  log "🌐 FRED 수집 스킵 (FRED_API_KEY 없음 — .env에 추가하면 선행지표 스코어 활성화)"
fi

if ! run_retrying_step "📊 기술 지표 계산..." 2 node scripts/calc-technicals.js --date "$DATE"; then
  log "⚠️ 기술 지표 계산 실패, fallback technical snapshot으로 계속 진행합니다."
  node scripts/ensure-daily-fallbacks.js \
    --date "$DATE" \
    --run-date "$RUN_DATE" \
    --effective-market-date "$DATE" \
    --mode technical \
    --reason "calc-technicals failed after retries" >>"$LOG_FILE" 2>&1
  SOFT_FAILURE_COUNT=$((SOFT_FAILURE_COUNT + 1))
fi

node scripts/ensure-daily-fallbacks.js \
  --date "$DATE" \
  --run-date "$RUN_DATE" \
  --effective-market-date "$DATE" \
  --mode technical \
  --reason "post-technical validation" >>"$LOG_FILE" 2>&1

if [[ "$SKIP_RAG" == "1" ]]; then
  log "🧱 RAG 코퍼스 단계 건너뜀 (--skip-rag)"
else
  run_parallel_nonfatal_group \
    report_rag "🧱 리포트 RAG 코퍼스 생성..." node scripts/build-report-rag-corpus.js --date "$DATE" --next \
    portfolio_rag "🧱 포트폴리오 RAG 코퍼스 생성..." node scripts/build-portfolio-rag-corpus.js --date "$DATE"
  run_nonfatal_step "🧱 병렬 RAG 코퍼스 생성..." node scripts/build-parallel-rag-corpus.js --date "$DATE"
fi

if [[ "$RUN_GEMINI_BRIEFING" == "yes" ]] || { [[ "$RUN_GEMINI_BRIEFING" == "auto" ]] && has_gemini_key; }; then
  PYTHON_BIN="$(python_bin)"
  run_nonfatal_step "🧠 Gemini 경제 브리핑 생성..." \
    "$PYTHON_BIN" scripts/generate_gemini_briefing.py \
      --run-date "$RUN_DATE" \
      --effective-market-date "$DATE" \
      --input "data/reports/$DATE/rag/chunks.jsonl" \
      --output "knowledge/daily/$DATE-gemini-briefing.md" \
      --min-chunks 15 \
      --max-chunks 20
  run_nonfatal_step "🧠 Gemini 리치 브리핑 생성..." \
    "$PYTHON_BIN" scripts/generate_gemini_briefing.py \
      --run-date "$RUN_DATE" \
      --effective-market-date "$DATE" \
      --input "data/reports/$DATE/rag/chunks.jsonl" \
      --output "knowledge/daily/$DATE-gemini-briefing-rich.md" \
      --min-chunks 50 \
      --max-chunks 60
else
  log "🧠 Gemini 브리핑 스킵 (API 키 없음 또는 --no-gemini-briefing)"
fi

PIPELINE_ARGS=(
  --date "$DATE"
  --run-date "$RUN_DATE"
  --effective-market-date "$DATE"
  --qwen-stage2
  --strict-qwen-stage2
)

if [[ "$SKIP_STRATEGY" == "1" ]]; then
  log "🧭 전략 파이프라인 건너뜀 (--skip-strategy)"
else
  if [[ "$USE_DAG" == "1" ]]; then
    run_step "🧭 Stage 1~4 DAG 파이프라인..." \
      node scripts/run-pipeline-dag.js \
        --date "$DATE" \
        --run-date "$RUN_DATE" \
        --effective-market-date "$DATE" \
        --stage2-mode "qwen"
  else
    run_step "🧭 Stage 1~4 전략 파이프라인..." bash scripts/run-strategy-pipeline.sh "${PIPELINE_ARGS[@]}"
  fi
fi

if [[ "$SKIP_WIKI" == "1" ]]; then
  log "📚 LLM Wiki 단계 건너뜀 (--skip-wiki)"
else
  run_step "📚 LLM Wiki 갱신..." node scripts/build-llm-wiki.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"
  run_step "🪄 Obsidian vault 게시..." node scripts/publish-llm-wiki-to-vault.js
fi

if [[ "$SKIP_VERIFY" == "1" ]]; then
  log "🩺 시스템 검증 건너뜀 (--skip-verify)"
else
  run_step "🩺 일일 산출물 검증..." node scripts/verify-daily-system.js --date "$DATE"
fi

if [[ "$SKIP_PUSH" == "1" ]]; then
  log "📤 GitHub 동기화 건너뜀 (--skip-push)"
else
  run_nonfatal_step "📤 검증 통과 데이터만 data 브랜치 동기화..." bash scripts/push-to-github.sh "$DATE"
fi

if [[ "$SKIP_TELEGRAM" == "1" ]]; then
  log "📨 Telegram 알림 건너뜀 (--skip-telegram)"
else
  run_nonfatal_step "📨 Telegram 파이프라인 요약 알림..." \
    node scripts/send-telegram-summary.js --date "$DATE"
fi

run_nonfatal_step "👻 Ghost Portfolio 스냅샷..." \
  node scripts/build-ghost-portfolio.js --date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE"

(
  node "$ROOT_DIR/scripts/auto-tune-challenger.js" --date "$DATE" >>"$LOG_FILE" 2>&1 && \
  node "$ROOT_DIR/scripts/backtest-challenger.js" --date "$DATE" >>"$LOG_FILE" 2>&1
) &

if [[ "$SOFT_FAILURE_COUNT" -gt 0 ]]; then
  log "⚠️ 소프트 실패 ${SOFT_FAILURE_COUNT}건이 있었지만 파이프라인은 계속 완료했습니다."
fi

log "=================================================="
log "✅ EcoReport Daily System 종료 (run: $RUN_DATE / effective: $DATE)"
log "=================================================="
