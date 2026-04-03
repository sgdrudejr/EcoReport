#!/usr/bin/env bash
# scripts/run-cycle.sh
# 전체 분석 사이클 실행

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IGZUN_ROOT="/Users/seo/igzun-daily-report"
VENV="$IGZUN_ROOT/.venv/bin"
DATE="${1:-$(TZ=Asia/Seoul date +%F)}"

export TZ="Asia/Seoul"

echo "[run-cycle] =============================="
echo "[run-cycle] 날짜: $DATE"
echo "[run-cycle] =============================="

# ── Step 1: 자동 수집 (collectors) ────────────────────────────────────
echo "[run-cycle] Step 1: 데이터 수집..."
"$VENV/python" -m collectors.runner --date "$DATE" --base-dir "$IGZUN_ROOT" || true
"$VENV/python" -m collectors.bridge --date "$DATE" --base-dir "$IGZUN_ROOT" || true

# ── Step 2: PDF 처리 & 인사이트 정제 ──────────────────────────────────
echo "[run-cycle] Step 2: 인사이트 정제..."
"$VENV/python" "$IGZUN_ROOT/scripts/process_pdfs.py"                    || true
"$VENV/python" "$IGZUN_ROOT/scripts/refine_insights.py"                  || true
"$VENV/python" "$IGZUN_ROOT/scripts/integrate_refined_insights.py"       || true

# ── Step 3: 시장 데이터 + 퀀트 분석 ──────────────────────────────────
echo "[run-cycle] Step 3: 시장 데이터 & 퀀트..."
"$VENV/python" "$IGZUN_ROOT/scripts/load_market_data.py"                 || true
"$VENV/python" "$IGZUN_ROOT/scripts/apply_market_quant.py"               || true
"$VENV/python" "$IGZUN_ROOT/scripts/macro_analysis.py"   --date "$DATE" --base-dir "$IGZUN_ROOT" || true
"$VENV/python" "$IGZUN_ROOT/scripts/etf_recommender.py"  --date "$DATE" --base-dir "$IGZUN_ROOT" || true

# ── Step 4: 밸류에이션 / 신호 / LLM 인사이트 ─────────────────────────
echo "[run-cycle] Step 4: 신호 & LLM 인사이트..."
"$VENV/python" "$IGZUN_ROOT/scripts/valuation_engine.py"    --date "$DATE" --base-dir "$IGZUN_ROOT" || true
"$VENV/python" "$IGZUN_ROOT/scripts/signal_engine.py"       --date "$DATE" --base-dir "$IGZUN_ROOT" || true
"$VENV/python" "$IGZUN_ROOT/scripts/build_research_context.py" --date "$DATE" --base-dir "$IGZUN_ROOT" || true
"$VENV/python" "$IGZUN_ROOT/scripts/build_hierarchical_index.py" --date "$DATE" --base-dir "$IGZUN_ROOT" || true
"$VENV/python" "$IGZUN_ROOT/scripts/build_research_graph.py"  --date "$DATE" --base-dir "$IGZUN_ROOT" || true
"$VENV/python" "$IGZUN_ROOT/scripts/build_research_loop.py"   --date "$DATE" --base-dir "$IGZUN_ROOT" || true
"$VENV/python" "$IGZUN_ROOT/scripts/llm_insights.py"          --date "$DATE" --base-dir "$IGZUN_ROOT" || true

# ── Step 5: 사이트 리포트 & 요약 생성 ────────────────────────────────
echo "[run-cycle] Step 5: 리포트 생성..."
"$VENV/python" "$IGZUN_ROOT/scripts/build_site_report.py"         --date "$DATE" --base-dir "$IGZUN_ROOT" || true
"$VENV/python" "$IGZUN_ROOT/scripts/build_manual_summary_brief.py" --date "$DATE" --base-dir "$IGZUN_ROOT" || true
"$VENV/python" "$IGZUN_ROOT/scripts/storage_retention.py"          --base-dir "$IGZUN_ROOT" --today "$DATE" --delete-originals || true
"$VENV/python" "$IGZUN_ROOT/scripts/build_horizon_views.py"        --base-dir "$IGZUN_ROOT" || true

# ── Step 6: stock-pilot 포맷으로 데이터 내보내기 ─────────────────────
echo "[run-cycle] Step 6: stock-pilot 데이터 내보내기..."

mkdir -p "$REPO_ROOT/data/reports/$DATE"
mkdir -p "$REPO_ROOT/data/market"
mkdir -p "$REPO_ROOT/data/technical"
mkdir -p "$REPO_ROOT/knowledge/daily"
mkdir -p "$REPO_ROOT/reports/daily"

# 시장 데이터
if [ -f "$IGZUN_ROOT/data/market_data_latest.json" ]; then
  cp "$IGZUN_ROOT/data/market_data_latest.json" "$REPO_ROOT/data/market/${DATE}.json"
  echo "  → data/market/${DATE}.json"
fi

# 퀀트 스냅샷 (technical)
if [ -f "$IGZUN_ROOT/data/market_quant_snapshot.json" ]; then
  cp "$IGZUN_ROOT/data/market_quant_snapshot.json" "$REPO_ROOT/data/technical/${DATE}.json"
  echo "  → data/technical/${DATE}.json"
fi

# LLM 인사이트 → compressed.json
INSIGHTS_FILE="$IGZUN_ROOT/data/llm_insights/${DATE}_insights.json"
if [ -f "$INSIGHTS_FILE" ]; then
  cp "$INSIGHTS_FILE" "$REPO_ROOT/data/reports/${DATE}/compressed.json"
  echo "  → data/reports/${DATE}/compressed.json"
fi

# 브리핑 → reports/daily/
BRIEF_SRC=$(find "$IGZUN_ROOT/data/manual_summary" -name "${DATE}*briefing*.md" 2>/dev/null | head -1)
if [ -n "$BRIEF_SRC" ]; then
  BRIEF_DEST="$REPO_ROOT/reports/daily/$(basename "$BRIEF_SRC")"
  cp "$BRIEF_SRC" "$BRIEF_DEST"
  echo "  → reports/daily/$(basename "$BRIEF_SRC")"
fi

# knowledge digest (site/ 폴더의 날짜별 요약)
DIGEST_SRC=$(find "$IGZUN_ROOT/site/$DATE" -name "*.md" 2>/dev/null | head -1)
if [ -n "$DIGEST_SRC" ]; then
  cp "$DIGEST_SRC" "$REPO_ROOT/knowledge/daily/${DATE}-digest.md"
  echo "  → knowledge/daily/${DATE}-digest.md"
fi

echo "[run-cycle] Step 6: 완료."

# ── Step 7: GitHub data 브랜치에 결과 push ────────────────────────────
echo "[run-cycle] Step 7: GitHub push 시작..."
bash "$REPO_ROOT/scripts/push-to-github.sh" "$DATE"
echo "[run-cycle] Step 7: 완료."

echo "[run-cycle] 전체 사이클 완료: $DATE"
