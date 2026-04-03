#!/bin/bash
# ~/stock-pilot/scripts/run-cycle.sh

DATE=$(date +%F)
LOG_FILE="$HOME/stock-pilot/logs/run-cycle-$DATE.log"

# 로그 폴더 생성
mkdir -p "$HOME/stock-pilot/logs"

echo "==================================================" | tee -a $LOG_FILE
echo "🚀 [$(date '+%T')] Stock Pilot 분석 사이클 시작 ($DATE)" | tee -a $LOG_FILE
echo "==================================================" | tee -a $LOG_FILE

IGZUN_DIR="$HOME/igzun-daily-report"
PILOT_DIR="$HOME/stock-pilot"

# ---------------------------------------------------------
# Step 1~5: 기존 igzun-daily-report 파이프라인 실행
# ---------------------------------------------------------
echo "🔄 [1/7] 기존 분석 파이프라인 실행 (igzun-daily-report)..." | tee -a $LOG_FILE
cd $IGZUN_DIR

if [ -f "scripts/daily_update.sh" ]; then
    bash scripts/daily_update.sh >> $LOG_FILE 2>&1
else
    echo "⚠️ scripts/daily_update.sh 를 찾을 수 없어 개별 스크립트를 실행합니다." | tee -a $LOG_FILE
fi

# ---------------------------------------------------------
# Step 6: 결과 데이터를 stock-pilot 대시보드용으로 복사
# ---------------------------------------------------------
echo "📂 [6/7] 분석 결과를 대시보드 저장소로 복사..." | tee -a $LOG_FILE
cd $PILOT_DIR

mkdir -p data/reports/$DATE
mkdir -p data/market
mkdir -p data/technical
mkdir -p knowledge/daily
mkdir -p reports/daily
mkdir -p config

# 시장 데이터
cp $IGZUN_DIR/data/market_data_latest.json        data/market/$DATE.json        2>/dev/null \
  && echo "  ✓ data/market/$DATE.json"            | tee -a $LOG_FILE \
  || echo "  - market_data_latest.json 없음 (스킵)" | tee -a $LOG_FILE

# 퀀트 스냅샷 (technical)
cp $IGZUN_DIR/data/market_quant_snapshot.json     data/technical/$DATE.json     2>/dev/null \
  && echo "  ✓ data/technical/$DATE.json"          | tee -a $LOG_FILE \
  || echo "  - market_quant_snapshot.json 없음 (스킵)" | tee -a $LOG_FILE

# LLM 인사이트 → compressed.json
cp $IGZUN_DIR/data/llm_insights/$DATE.json        data/reports/$DATE/compressed.json 2>/dev/null \
  && echo "  ✓ data/reports/$DATE/compressed.json" | tee -a $LOG_FILE \
  || echo "  - llm_insights/$DATE.json 없음 (스킵)"  | tee -a $LOG_FILE

# 어드바이저 브리핑
cp $IGZUN_DIR/data/manual_summary/$DATE.md        reports/daily/$DATE-briefing.md    2>/dev/null \
  && echo "  ✓ reports/daily/$DATE-briefing.md"    | tee -a $LOG_FILE \
  || echo "  - manual_summary/$DATE.md 없음 (스킵)"  | tee -a $LOG_FILE

# ---------------------------------------------------------
# Step 7: GitHub push (대시보드 업데이트 트리거)
# ---------------------------------------------------------
echo "📤 [7/7] GitHub push (대시보드 Vercel 배포 트리거)..." | tee -a $LOG_FILE
bash $PILOT_DIR/scripts/push-to-github.sh >> $LOG_FILE 2>&1

echo "==================================================" | tee -a $LOG_FILE
echo "✅ [$(date '+%T')] 모든 분석 사이클 및 대시보드 업데이트 완료" | tee -a $LOG_FILE
echo "==================================================" | tee -a $LOG_FILE
