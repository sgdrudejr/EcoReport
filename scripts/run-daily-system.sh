#!/usr/bin/env bash
# EcoReport를 매일 운영 가능한 형태로 끝까지 실행하는 일일 마스터 러너

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REQUESTED_DATE=""
RUN_DATE="${RUN_DATE:-$(node "$ROOT_DIR/scripts/resolve-cycle-date.js" --field run_date)}"
EFFECTIVE_MARKET_DATE=""
SKIP_COLLECT=0
SKIP_RAG=0
SKIP_PUSH=0
SKIP_VERIFY=0
FORCE_COLLECT=0
STAGE2_MODE="auto"
RUN_GEMINI_BRIEFING="auto"

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
    --force-collect)
      FORCE_COLLECT=1
      shift
      ;;
    --gemini-stage2)
      STAGE2_MODE="gemini"
      shift
      ;;
    --mock-stage2)
      STAGE2_MODE="mock"
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

log() {
  echo "$1" | tee -a "$LOG_FILE"
}

run_step() {
  local label="$1"
  shift
  log "$label"
  "$@" >>"$LOG_FILE" 2>&1
}

run_soft_step() {
  local label="$1"
  shift
  log "$label"
  if "$@" >>"$LOG_FILE" 2>&1; then
    return 0
  fi
  log "⚠️ 단계 실패, 다음 단계로 계속 진행합니다."
  return 1
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

log "=================================================="
log "🚀 EcoReport Daily System 시작 (run: $RUN_DATE / effective: $DATE)"
log "🗓️ 날짜 해석 사유: $RESOLUTION_REASON"
log "📁 로그: $LOG_FILE"
log "=================================================="

if [[ "$SKIP_COLLECT" == "1" ]]; then
  log "📡 수집 단계 건너뜀 (--skip-collect)"
else
  COLLECT_ARGS=(--date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE")
  if [[ "$FORCE_COLLECT" == "1" ]]; then
    COLLECT_ARGS+=(--force)
  fi
  run_step "📡 리포트 수집 + 전문 텍스트화..." bash scripts/collect-report-assets.sh "${COLLECT_ARGS[@]}"
fi

run_step "📈 시장 데이터 수집..." node scripts/fetch-market-data.js --date "$DATE"

# FRED API 키가 있으면 거시경제 선행지표 수집 (레짐 감지 + Stage 3 선행지표 스코어에 활용)
PYTHON_BIN_DAILY="$(python_bin)"
if grep -Eq '^FRED_API_KEY=.+$' "$ROOT_DIR/.env" 2>/dev/null || [[ -n "${FRED_API_KEY:-}" ]]; then
  run_soft_step "🌐 FRED 거시경제 데이터 수집..." "$PYTHON_BIN_DAILY" scripts/fetch-fred-macro.py --date "$DATE"
else
  log "🌐 FRED 수집 스킵 (FRED_API_KEY 없음 — .env에 추가하면 선행지표 스코어 활성화)"
fi

run_step "📊 기술 지표 계산..." node scripts/calc-technicals.js --date "$DATE"

if [[ "$SKIP_RAG" == "1" ]]; then
  log "🧱 RAG 코퍼스 단계 건너뜀 (--skip-rag)"
else
  run_step "🧱 리포트 RAG 코퍼스 생성..." node scripts/build-report-rag-corpus.js --date "$DATE"
  run_step "🧱 포트폴리오 RAG 코퍼스 생성..." node scripts/build-portfolio-rag-corpus.js --date "$DATE"
  run_step "🧱 병렬 RAG 코퍼스 생성..." node scripts/build-parallel-rag-corpus.js --date "$DATE"
fi

if [[ "$RUN_GEMINI_BRIEFING" == "yes" ]] || { [[ "$RUN_GEMINI_BRIEFING" == "auto" ]] && has_gemini_key; }; then
  PYTHON_BIN="$(python_bin)"
  run_soft_step "🧠 Gemini 경제 브리핑 생성..." \
    "$PYTHON_BIN" scripts/generate_gemini_briefing.py \
      --run-date "$RUN_DATE" \
      --effective-market-date "$DATE" \
      --input "data/reports/$DATE/rag/chunks.jsonl" \
      --output "knowledge/daily/$DATE-gemini-briefing.md" \
      --min-chunks 15 \
      --max-chunks 20
  run_soft_step "🧠 Gemini 리치 브리핑 생성..." \
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

PIPELINE_ARGS=(--date "$DATE" --run-date "$RUN_DATE" --effective-market-date "$DATE")
if [[ "$STAGE2_MODE" == "gemini" ]]; then
  PIPELINE_ARGS+=(--gemini-stage2)
elif [[ "$STAGE2_MODE" == "auto" ]] && has_gemini_key; then
  PIPELINE_ARGS+=(--gemini-stage2)
fi

run_step "🧭 Stage 1~4 전략 파이프라인..." bash scripts/run-strategy-pipeline.sh "${PIPELINE_ARGS[@]}"

if [[ "$SKIP_PUSH" == "1" ]]; then
  log "📤 GitHub 동기화 건너뜀 (--skip-push)"
else
  run_soft_step "📤 data 브랜치 동기화..." bash scripts/push-to-github.sh "$DATE"
fi

if [[ "$SKIP_VERIFY" == "1" ]]; then
  log "🩺 시스템 검증 건너뜀 (--skip-verify)"
else
  run_step "🩺 일일 산출물 검증..." node scripts/verify-daily-system.js --date "$DATE"
fi

log "=================================================="
log "✅ EcoReport Daily System 종료 (run: $RUN_DATE / effective: $DATE)"
log "=================================================="
