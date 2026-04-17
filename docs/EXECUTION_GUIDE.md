# EcoReport Execution Guide

> **이 문서가 모든 실행의 단일 진입점입니다.**
> README, AGENTS, CLAUDE, DOCS_MAP, MULTI_TOOL_HANDOFF 모두 여기를 먼저 보도록 안내합니다.
> 핵심 원칙: "무엇을 하려면 어떤 명령어 → 어떤 산출물"

Last updated: 2026-04-17

---

## 프로젝트 기본 정보

| 항목 | 값 |
|------|-----|
| 프로젝트 루트 | `/Users/seo/Documents/Playground/economy-report` |
| 로컬 KIS helper | `/Users/seo/Documents/Playground/economy-report/open-trading-api` |
| 레거시 아카이브 | `/Users/seo/Documents/Playground/stock-pilot-archive` |
| GitHub | `sgdrudejr/EcoReport` |
| Python venv | `.venv/bin/python3` |
| Node | `node` (v25.8.1) |
| Windows LLM | `http://192.168.0.218:8080/v1` (`Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf`) |
| Windows MAC | `A0:AD:9F:CD:47:D2` (Wake-on-LAN) |
| Qwen API | `.env` → `QWEN_API_KEY` (주의: 30,720 토큰 한도, `/no_think` 태그 필수) |
| 구 프로젝트 | `igzun-daily-report` → **참고용 레퍼런스만**, 런타임 의존 없음 |

`stock-pilot` 체크아웃은 더 이상 실행 기준이 아닙니다. 옛 문서나 산출물을 복구할 때만 archive를 보고, 일상 작업은 모두 `economy-report` 루트에서 실행합니다.

---

## 작업별 빠른 진입

### A. 일일 전체 파이프라인 실행

상세: [`docs/DAILY_PIPELINE_RUNBOOK.md`](DAILY_PIPELINE_RUNBOOK.md)

```bash
DATE=2026-04-17  # 날짜 변경
cd /Users/seo/Documents/Playground/economy-report

# Phase 1: 수집
bash scripts/collect-report-assets.sh --date $DATE
node scripts/sync-kis-portfolio.js --date $DATE
node scripts/build-portfolio-rag-corpus.js --date $DATE
.venv/bin/python3 scripts/stockeasy_crawler.py --date $DATE
.venv/bin/python3 scripts/stockeasy_normalizer.py --date $DATE

# Phase 2: Windows LLM 요약
.venv/bin/python3 -c "from scripts.report_orchestrator.power import wake_windows; wake_windows('A0:AD:9F:CD:47:D2')"
# (60초 대기 후)
bash scripts/run-local-report-orchestrator.sh --date $DATE

# Phase 2.5: final_market_view 수동 병합 (orchestrator 미생성 시)
# scripts/merge_report_summaries.py --date $DATE  ← 별도 스크립트 또는 인라인 Python

# Phase 3: Qwen 브리핑 (로컬 LLM 방식, /no_think 필수)
# → 직접 Python으로 실행 (generate_briefing.py는 Qwen API 토큰 한도 문제 있음)

# Phase 4: 딥리서치 프롬프트 생성 + 클립보드 복사
# → 인라인 Python으로 브리핑+마켓뷰+StockEasy+포트폴리오 병합
# → 클립보드 복사 후 gemini.google.com → Deep Research → Cmd+V

# Phase 5: 인사이트 도출
.venv/bin/python3 scripts/generate_insights.py \
  --deepresearch knowledge/daily/$DATE-deepresearch.md \
  --portfolio data/portfolio/rag/$DATE/merged-portfolio.md \
  --briefing knowledge/daily/$DATE-briefing.md \
  --output knowledge/daily/$DATE-insights.md \
  --date $DATE
```

---

### B. Windows LLM 준비

```bash
# 켜기 (Wake-on-LAN)
.venv/bin/python3 -c "
from scripts.report_orchestrator.power import wake_windows
print(wake_windows('A0:AD:9F:CD:47:D2'))
"

# 연결 확인
curl -s --connect-timeout 5 http://192.168.0.218:8080/health

# 로컬 LLM API 호출 방식 (/no_think 태그 필수 — content가 비어있으면 reasoning_content에 있음)
from openai import OpenAI
client = OpenAI(api_key="dummy", base_url="http://192.168.0.218:8080/v1")
resp = client.chat.completions.create(
    model="Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf",
    messages=[{"role":"user","content":"/no_think\n여기에 프롬프트"}],
    max_tokens=4000,
)
# resp.choices[0].message.content  ← 실제 응답
# resp.choices[0].message.reasoning_content  ← thinking (무시)
```

---

### C. StockEasy 수집

```bash
# 전체 수집 (Chrome에 로그인 상태 필요 — browser_cookie3 자동 추출)
.venv/bin/python3 scripts/stockeasy_crawler.py --date 2026-04-17

# 컨텍스트 마크다운 생성 (LLM 불필요)
.venv/bin/python3 scripts/stockeasy_normalizer.py --date 2026-04-17
# → data/stockeasy/{date}/stockeasy-context.md
```

수집 항목: `sector` / `briefing` / `rs` / `report` / `industry_report` / `momentum` / `peak` / `value`

---

### D. 딥리서치 / manual-kit

```bash
# 딥리서치 프롬프트 생성 및 클립보드 복사
.venv/bin/python3 - <<'EOF'
from pathlib import Path; import subprocess, json

DATE = "2026-04-17"
base = Path(f"/Users/seo/Documents/Playground/economy-report")

briefing  = (base / f"knowledge/daily/{DATE}-briefing.md").read_text()[:6000]
mktview   = (base / f"reports/merged/final_market_view_{DATE}.md").read_text()[:2500]
stockeasy = (base / f"data/stockeasy/{DATE}/stockeasy-context.md").read_text()[:8000]
portfolio = (base / f"data/portfolio/rag/{DATE}/merged-portfolio.md").read_text()[:5000]

prompt = f"""당신은 한국 주식시장 전문 리서처입니다...
[참고 자료 1 브리핑]\n{briefing}
[참고 자료 2 마켓뷰]\n{mktview}
[참고 자료 3 StockEasy]\n{stockeasy}
[참고 자료 4 포트폴리오]\n{portfolio}"""

out = base / f"knowledge/daily/{DATE}-deepresearch-prompt.md"
out.write_text(prompt)
subprocess.run(['pbcopy'], input=prompt.encode('utf-8'), check=True)
print(f"✅ {len(prompt):,}자 클립보드 복사 완료")
EOF
```

이후: `gemini.google.com` → Deep Research → Cmd+V → 결과를 `knowledge/daily/{date}-deepresearch.md`로 저장

---

### E. Stage 1~4 재실행

상세: [`docs/STAGE_1_4_ARCHITECTURE.md`](STAGE_1_4_ARCHITECTURE.md)

```bash
# Stage 1: 리포트 수집 + 전문화
bash scripts/collect-report-assets.sh --date $DATE

# Stage 2: LLM 분석 (Windows LLM)
bash scripts/run-local-report-orchestrator.sh --date $DATE

# Stage 3: RAG + 포트폴리오
node scripts/build-report-rag-corpus.js --date $DATE
node scripts/build-portfolio-rag-corpus.js --date $DATE

# Stage 4: 인사이트
.venv/bin/python3 scripts/generate_insights.py --date $DATE ...
```

---

### F. 검증 / Handoff

```bash
# 날짜별 산출물 확인
ls data/reports/$DATE/          # 리포트 PDF/텍스트
ls data/stockeasy/$DATE/        # StockEasy 원시 + context.md
ls data/portfolio/rag/$DATE/    # 포트폴리오 RAG
ls reports/report_summaries/$DATE/ | wc -l  # LLM 요약 건수
ls reports/merged/              # final_market_view
ls knowledge/daily/ | grep $DATE  # 브리핑/딥리서치/인사이트
```

handoff 파일 위치: [`docs/SESSION_HANDOFF.md`](SESSION_HANDOFF.md)

---

## 핵심 파일 위치

| 산출물 | 경로 |
|--------|------|
| 리포트 PDF | `data/reports/{date}/*.pdf` |
| 리포트 청크 | `data/reports/{date}/rag/chunks.jsonl` |
| LLM 요약 | `reports/report_summaries/{date}/*.json` |
| Final 마켓뷰 | `reports/merged/final_market_view_{date}.md` |
| StockEasy 원시 | `data/stockeasy/{date}/*.json` |
| StockEasy 컨텍스트 | `data/stockeasy/{date}/stockeasy-context.md` |
| 포트폴리오 RAG | `data/portfolio/rag/{date}/merged-portfolio.md` |
| 브리핑 | `knowledge/daily/{date}-briefing.md` |
| 딥리서치 프롬프트 | `knowledge/daily/{date}-deepresearch-prompt.md` |
| 딥리서치 결과 | `knowledge/daily/{date}-deepresearch.md` |
| 인사이트 | `knowledge/daily/{date}-insights.md` |

---

## 알려진 주의사항

| 이슈 | 해결 |
|------|------|
| Qwen API 30,720 토큰 한도 | max-chunks 줄이기 or 로컬 LLM 사용 |
| 로컬 LLM content 비어있음 | `/no_think` 태그 추가 (reasoning 모드 비활성화) |
| StockEasy 인증 실패 | Chrome에 stockeasy.intellio.kr 로그인 상태 유지 필요 |
| orchestrator provider 오류 | `config/local-report-orchestrator.json` → `"provider": "local"` 확인 |
| 04-17 리포트 0건 시 | 전날(`2026-04-16`) `chunks.jsonl` 사용 |

---

## 관련 문서

| 문서 | 역할 |
|------|------|
| [`docs/DAILY_PIPELINE_RUNBOOK.md`](DAILY_PIPELINE_RUNBOOK.md) | Phase별 상세 명령어 |
| [`docs/STAGE_1_4_ARCHITECTURE.md`](STAGE_1_4_ARCHITECTURE.md) | 파이프라인 아키텍처 |
| [`docs/OPERATOR_RUNBOOK.md`](OPERATOR_RUNBOOK.md) | 운영 절차 |
| [`docs/MULTI_TOOL_HANDOFF.md`](MULTI_TOOL_HANDOFF.md) | 툴간 handoff 규칙 |
| [`docs/EXPERIMENT_PLAYBOOK.md`](EXPERIMENT_PLAYBOOK.md) | 실험/검증 절차 |
| [`FAILURES_AND_FALLBACKS.md`](../FAILURES_AND_FALLBACKS.md) | 실패 패턴 및 폴백 |
