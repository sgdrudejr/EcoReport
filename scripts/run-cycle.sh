#!/usr/bin/env bash
# EcoReport 독립형 전체 분석 사이클을 실행하는 스크립트입니다.

set -euo pipefail

DATE="$(date +%F)"
TIME="$(date +%H%M)"
SKIP_LLM="${SKIP_LLM:-0}"
MANUAL_LLM="${MANUAL_LLM:-0}"
SKIP_COLLECT=0
AUTO_PUSH=0
FORCE_LLM=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      DATE="$2"
      shift 2
      ;;
    --skip-llm)
      SKIP_LLM=1
      shift
      ;;
    --manual-llm)
      MANUAL_LLM=1
      shift
      ;;
    --skip-collect)
      SKIP_COLLECT=1
      shift
      ;;
    --push)
      AUTO_PUSH=1
      shift
      ;;
    --force-llm)
      FORCE_LLM=1
      shift
      ;;
    *)
      DATE="$1"
      shift
      ;;
  esac
done

ROOT_DIR="${ROOT_DIR:-$HOME/stock-pilot}"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/$DATE-$TIME.log"

mkdir -p "$LOG_DIR"
cd "$ROOT_DIR"

log() {
  echo "$1" | tee -a "$LOG_FILE"
}

run_step() {
  local label="$1"
  shift

  log "$label"
  "$@" >> "$LOG_FILE" 2>&1
}

run_optional_step() {
  local label="$1"
  shift

  log "$label"
  if "$@" >> "$LOG_FILE" 2>&1; then
    return 0
  fi

  log "⚠️ 단계 실패, 다음 단계로 계속 진행합니다."
}

run_soft_step() {
  local label="$1"
  shift

  log "$label"
  if "$@" >> "$LOG_FILE" 2>&1; then
    return 0
  fi

  log "⚠️ 단계 실패, 다음 단계로 계속 진행합니다."
  return 1
}

should_run_llm_stage() {
  local stage="$1"
  local message=""

  if [[ "$FORCE_LLM" == "1" ]]; then
    echo "force-llm 옵션으로 강제 실행합니다."
    return 0
  fi

  if message=$(node scripts/llm-stage-gate.js check --stage "$stage" --date "$DATE"); then
    echo "$message"
    return 0
  fi

  local status=$?
  if [[ "$status" == "20" ]]; then
    echo "$message"
    return 20
  fi

  echo "$message"
  return "$status"
}

mark_llm_stage() {
  local stage="$1"
  node scripts/llm-stage-gate.js mark --stage "$stage" --date "$DATE" >> "$LOG_FILE" 2>&1
}

if [[ -z "${SECONDS:-}" ]]; then
  SECONDS=0
fi

log "=================================================="
log "🚀 [$TIME] EcoReport 분석 사이클 시작 ($DATE)"
log "=================================================="

if [[ "$SKIP_COLLECT" == "1" ]]; then
  log "📡 [1/6] 수집 단계 건너뜀 (--skip-collect)"
  log "📰 [2/6] 수집 단계 건너뜀 (--skip-collect)"
else
  run_optional_step "📡 [1/6] 네이버 리서치 수집..." \
    node scripts/crawl-naver-research.js --date "$DATE"

  run_optional_step "📰 [2/6] RSS/트위터/시장 데이터 수집..." \
    bash -lc "node scripts/fetch-rss-news.js --date '$DATE' && node scripts/fetch-twitter.js --date '$DATE' && node scripts/fetch-market-data.js --date '$DATE'"
fi

run_step "📊 [3/6] 기술적 분석 계산..." \
  node scripts/calc-technicals.js --date "$DATE"

if [[ "$MANUAL_LLM" == "1" ]]; then
  log "🧬 [4/6] 수동 LLM 모드: API 압축은 생략하고 PDF 요약 큐/프롬프트만 준비합니다."

  if report_queue_reason="$(should_run_llm_stage report-queue)"; then
    if run_soft_step "📚 [4/6] 수동 LLM용 PDF 요약 큐 생성... $report_queue_reason" \
      node scripts/build-report-summary-queue.js --date "$DATE"; then
      run_soft_step "🧭 [4/6] 수동 LLM용 리포트 선별 프롬프트 생성..." \
        node scripts/build-report-triage-prompt.js --date "$DATE" --output "knowledge/daily/$DATE-report-triage-prompt.md"
      mark_llm_stage report-queue
    fi
  else
    local_status=$?
    if [[ "$local_status" == "20" ]]; then
      log "📚 [4/6] PDF 요약 큐 생성 스킵... $report_queue_reason"
    else
      log "⚠️ PDF 요약 큐 생성 여부 판단 실패: $report_queue_reason"
    fi
  fi

  if synthesis_reason="$(should_run_llm_stage synthesis)"; then
    run_soft_step "🧩 [5/6] 수동 LLM용 시황 프롬프트 생성... $synthesis_reason" \
      node scripts/build-synthesis-prompt.js --date "$DATE" --output "knowledge/daily/$DATE-synthesis-prompt.md"
  else
    local_status=$?
    if [[ "$local_status" == "20" ]]; then
      log "🧩 [5/6] 시황 프롬프트 생성 스킵... $synthesis_reason"
    else
      log "⚠️ 시황 프롬프트 생성 여부 판단 실패: $synthesis_reason"
    fi
  fi
elif [[ "$SKIP_LLM" == "1" || -z "${ANTHROPIC_API_KEY:-}" || "${ANTHROPIC_API_KEY:-}" == "sk-ant-xxxxx" ]]; then
  log "🧬 [4/6] LLM 단계는 건너뜁니다. (skip-llm 또는 API 미설정)"
else
  if compress_reason="$(should_run_llm_stage compress)"; then
    if run_soft_step "🧬 [4/6] 리포트 압축... $compress_reason" \
      node scripts/compress-reports.js --date "$DATE" --force; then
      mark_llm_stage compress
    fi
  else
    local_status=$?
    if [[ "$local_status" == "20" ]]; then
      log "🧬 [4/6] 리포트 압축 스킵... $compress_reason"
    else
      log "⚠️ 리포트 압축 실행 여부 판단 실패: $compress_reason"
    fi
  fi

  if synthesis_reason="$(should_run_llm_stage synthesis)"; then
    if run_soft_step "🧩 [5/6] 일일 시황 종합... $synthesis_reason" \
      node scripts/synthesize-daily.js --date "$DATE" --force; then
      mark_llm_stage synthesis
    fi
  else
    local_status=$?
    if [[ "$local_status" == "20" ]]; then
      log "🧩 [5/6] 일일 시황 종합 스킵... $synthesis_reason"
    else
      log "⚠️ 일일 시황 종합 실행 여부 판단 실패: $synthesis_reason"
    fi
  fi
fi

if [[ "$MANUAL_LLM" == "1" ]]; then
  if advisory_reason="$(should_run_llm_stage advisory)"; then
    run_step "🧠 [6/6] 수동 LLM용 어드바이저 프롬프트 생성... $advisory_reason" \
      bash scripts/run-advisory.sh --date "$DATE" --manual-llm --force
    run_soft_step "🧮 [6/6] 수동 LLM용 포트폴리오 코치 프롬프트 생성..." \
      node scripts/build-portfolio-coach-prompt.js --date "$DATE" --output "reports/daily/$DATE-portfolio-coach-prompt.md"
  else
    local_status=$?
    if [[ "$local_status" == "20" ]]; then
      log "🧠 [6/6] 어드바이저 프롬프트 생성 스킵... $advisory_reason"
    else
      log "⚠️ 어드바이저 실행 여부 판단 실패: $advisory_reason"
    fi
  fi
elif [[ "$SKIP_LLM" == "1" || -z "${ANTHROPIC_API_KEY:-}" || "${ANTHROPIC_API_KEY:-}" == "sk-ant-xxxxx" ]]; then
  run_step "🧠 [6/6] 어드바이저 컨텍스트/브리핑 생성..." \
    bash scripts/run-advisory.sh --date "$DATE" $( [[ "$SKIP_LLM" == "1" ]] && echo "--skip-llm" )
else
  if advisory_reason="$(should_run_llm_stage advisory)"; then
    if run_soft_step "🧠 [6/6] 어드바이저 컨텍스트/브리핑 생성... $advisory_reason" \
      bash scripts/run-advisory.sh --date "$DATE" --force; then
      mark_llm_stage advisory
    fi
  else
    local_status=$?
    if [[ "$local_status" == "20" ]]; then
      log "🧠 [6/6] 어드바이저 생성 스킵... $advisory_reason"
    else
      log "⚠️ 어드바이저 실행 여부 판단 실패: $advisory_reason"
    fi
  fi
fi

if [[ "$AUTO_PUSH" == "1" ]]; then
  if [[ -x "$ROOT_DIR/scripts/push-to-github.sh" ]]; then
    run_optional_step "📤 [extra] GitHub push..." \
      bash "$ROOT_DIR/scripts/push-to-github.sh" "$DATE"
  else
    log "⚠️ push-to-github.sh 가 없어 push는 생략합니다."
  fi
fi

log "=================================================="
log "✅ [$TIME] EcoReport 분석 사이클 종료 (소요 ${SECONDS}초)"
log "📁 로그: $LOG_FILE"
log "=================================================="
