# EcoReport

EcoReport는 증권사 리포트, 시장 데이터, 계좌 상태, 실행 계획, 피드백 루프를 하나의 로컬 워크벤치로 묶는 포트폴리오 인텔리전스 시스템입니다.

핵심 목표는 “요약”이 아니라 아래 연결을 재현 가능하게 유지하는 것입니다.

- 리포트를 구조화된 fact anchor로 바꾼다.
- LLM 전략 탐색 결과를 계좌별 실행안으로 번역한다.
- Stage 3 점수와 Stage 4 실행안을 코드로 다시 계산한다.
- 피드백, 챌린저, 고스트 포트폴리오를 통해 후행 검증을 남긴다.
- 대시보드와 위키가 같은 산출물을 읽도록 유지한다.

## 현재 운영 모델

- 실행 환경: `Mac Mini + 로컬 실행 + private access`
- 루트 워크스페이스: `/Users/seo/stock-pilot`
- 프론트엔드 워크스페이스: `dashboard/` (`package.json` workspaces 사용)
- 일일 마스터 러너: `scripts/run-daily-system.sh`
- 전략 파이프라인: `scripts/run-strategy-pipeline.sh`
- DAG 러너: `scripts/run-pipeline-dag.js`
- 장중 경보 파이프라인: `scripts/run-intraday-alert-pipeline.js`
- 대시보드 소스 오브 트루스: `dashboard/`
- 장기 기억 레이어: `knowledge/wiki/`

## 빠른 시작


## LLM 브리핑 + 딥리서치 파이프라인 (2026-04 현재)

증권사 리포트 청크 → Qwen 브리핑 → Gemini 딥리서치 → 인사이트 도출의 4단계 자동 파이프라인입니다.

```mermaid
flowchart TD
    A["chunks.jsonl<br/>data/reports/{date}/rag/"] --> B["① 브리핑 생성<br/>generate_briefing.py<br/>qwen3.5-flash"]
    P["merged-portfolio.md<br/>data/portfolio/rag/"] --> C

    B --> BR["{date}-briefing.md"]
    BR --> C["② Gemini 딥리서치<br/>Chrome → gemini.google.com<br/>Google Search 실시간 검색"]
    P --> C
    C --> DR["{date}-deepresearch.md"]

    DR --> E["③ 인사이트 도출<br/>qwen3.5-flash<br/>계좌별 운영방안 + 추천종목"]
    P --> E
    E --> INS["{date}-insights.md"]
```

### 역할 분담
| 단계 | 담당 | 이유 |
|------|------|------|
| 브리핑 (대용량 청크 → 요약) | **qwen3.5-flash** | 저렴, 컨텍스트 길어도 안정적 |
| 딥리서치 (실시간 검색 포함) | **Gemini 웹 Deep Research** | Google 검색 품질 최고, 무료 |
| 인사이트 도출 (요약 → 액션) | **qwen3.5-flash** | 저렴, Gemini 결과 재처리 |

### 실행 명령

```bash
cd /Users/seo/Documents/Playground/EcoReport
DATE=$(date +%F)

# ① 브리핑 생성 (qwen3.5-flash)
.venv/bin/python3 scripts/generate_briefing.py \
  --input data/reports/$DATE/rag/chunks.jsonl \
  --output knowledge/daily/$DATE-briefing.md \
  --model qwen3.5-flash \
  --max-chunks 80 --min-chunks 60 \
  --run-date $DATE --effective-market-date $DATE

# ② Gemini 웹 딥리서치 (Chrome 자동화 또는 수동)
#    브리핑 + 포트폴리오를 Gemini Deep Research에 입력

# ③ 인사이트 도출 (qwen3.5-flash, 딥리서치 결과 입력 후)
.venv/bin/python3 scripts/generate_insights.py \
  --deepresearch knowledge/daily/$DATE-deepresearch.md \
  --portfolio data/portfolio/rag/latest/merged-portfolio.md \
  --briefing knowledge/daily/$DATE-briefing.md \
  --output knowledge/daily/$DATE-insights.md \
  --date $DATE --model qwen3.5-flash
```

> `--briefing` 옵션을 지정하면 `portfolio_filter.py`가 자동으로 호출되어 브리핑 키워드와 관련 있는 보유종목만 컨텍스트에 포함합니다 (Relevant Chunking).
> 생성 직후 검증 루프(Self-Correction)가 실행되어 리스크 가이드라인 위반 여부를 체크합니다.

### Gemini 딥리서치 전용 브리핑 (레거시 / 수동)

`generate_gemini_briefing_deepresearch.py`는 `google-genai` SDK를 직접 사용하는 구버전입니다.

```bash
.venv/bin/python3 scripts/generate_gemini_briefing_deepresearch.py \
  --input data/reports/$DATE/rag/chunks.jsonl \
  --output knowledge/daily/$DATE-gemini-briefing.md
```


## 빠른 시작

### 1. 일일 전체 러너

```bash
cd /Users/seo/stock-pilot
bash scripts/run-daily-system.sh --date YYYY-MM-DD
```

주요 옵션:

- `--use-dag`: `config/pipeline-manifest.yaml` 기반 DAG 실행
- `--gemini-stage2`: Stage 2를 Gemini 우선으로 실행
- `--claude-stage2`: Stage 2를 Claude 우선으로 실행
- `--mock-stage2`: Stage 2를 mock으로 고정
- `--skip-collect`, `--skip-rag`, `--skip-strategy`, `--skip-wiki`, `--skip-verify`
- `--no-gemini-briefing`, `--gemini-briefing`

### 2. 전략 파이프라인만 재실행

```bash
cd /Users/seo/stock-pilot
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD
```

이 러너는 Stage 1 -> 1.5 -> 1.6 -> 2 -> 2.5 -> 3 -> holding-clusters -> 4 -> feedback snapshot까지 집중 실행합니다.

### 2-1. Shadow 파이프라인만 재실행

```bash
cd /Users/seo/stock-pilot
npm run shadow:pipeline -- --date YYYY-MM-DD
```

이 러너는 아래 흐름만 따로 검증합니다.

- Stage 0: `build-report-chunk-index.js`
- Stage 1 shadow: `build-stage1-shadow-extracts.js`
- Stage 2 shadow: `build-stage2-shadow-topic-buckets.js`
- Stage 3 shadow: `build-stage3-shadow-final-insights.js`

### 3. 장중 경보/부분 재점수

```bash
cd /Users/seo/stock-pilot
node scripts/run-intraday-alert-pipeline.js --date YYYY-MM-DD --dry-run
```

현재 장중 파이프라인은 아래를 수행합니다.

- `fetch-market-data-lite.js`로 경량 시세 스냅샷 수집
- `evaluate-alert-triggers.js`로 VIX/환율/보유종목 급변 경보 평가
- 트리거 발생 시 `recompute-stage3-intraday.js`로 intraday overlay 생성
- `data/intraday/latest.json` 갱신
- Telegram 긴급 알림 전송

### 4. 대시보드

```bash
cd /Users/seo/stock-pilot/dashboard
npm install
npm run dev -- --hostname 0.0.0.0
```

검증:

```bash
cd /Users/seo/stock-pilot/dashboard
npm run build
```

### 5. 리포트 요약 충실도 검증

```bash
cd /Users/seo/stock-pilot
node scripts/validate-briefing-fidelity.js --date YYYY-MM-DD
```

이 검증은 `rich briefing`과 `Stage 2 prompt`가 중요한 extract의 제목, 숫자 anchor, 조건/반론 anchor를 얼마나 보존했는지 확인합니다.

## 현재 파이프라인 구조

```mermaid
flowchart TD
    A["Report Sources"] --> C["collect-report-assets.sh"]
    C --> R["data/reports/YYYY-MM-DD/*"]

    P["Portfolio latest.json"] --> S2
    P --> S3
    P --> S4
    T["technical YYYY-MM-DD.json"] --> S2
    T --> S3
    T --> S4
    M["market YYYY-MM-DD.json"] --> S3
    M --> S4
    MV["marketvoice-linked.json"] --> S2
    W["strategy/watchlist config"] --> S3

    R --> S1["Stage 1<br/>build-stage1-report-extracts.js"]
    S1 --> S15["Stage 1.5<br/>deep research prompt"]
    S15 --> DR["manual deep research response"]
    DR --> S16["Stage 1.6<br/>rich briefing"]
    S1 --> S2["Stage 2<br/>strategy prompt + Gemini/Claude/mock"]
    S1 --> S25["Stage 2.5<br/>build-impact-map.js"]
    S16 --> S2

    S2 --> S3["Stage 3<br/>build-stage3-quant-scores.js"]
    S25 --> S3
    S3 --> HC["build-holding-clusters.js"]
    HC --> S4["Stage 4<br/>build-stage4-execution-plan.js"]
    S4 --> CR["optional critic<br/>build-stage4-critic.js"]

    S3 --> TS["timeseries.db"]
    S4 --> TS
    S4 --> FB["feedback snapshot / analysis"]
    FB --> CH["challenger / ghost / weight tuning"]
    FB --> UI["dashboard + wiki"]

    IA["intraday alert pipeline"] --> IU["data/intraday/latest.json"]
    IU --> UI
```

요약:

- `Stage 1`: 리포트 구조화 + 포트폴리오 연결
- `Stage 1.5 / 1.6`: Deep Research와 rich briefing 보강
- `Stage 2`: 전략 옵션 탐색
- `Stage 2.5`: 리포트 영향 확정 레이어
- `Stage 3`: 점수화, 분해 점수, SQLite 적재
- `Stage 4`: 실행안, critic 병합, Telegram 요약 입력
- `Feedback / Challenger / Ghost`: 사후 검증과 가중치 실험
- `Intraday`: 경량 경보와 intraday score overlay

## 저장소 구조

상세 구조는 [docs/REPO_STRUCTURE.md](docs/REPO_STRUCTURE.md)에 정리되어 있습니다.

핵심 디렉터리만 먼저 보면:

- `scripts/`: 운영 파이프라인과 데이터 산출 로직
- `scripts/lib/`: 공용 유틸, 분석 컨텍스트, SQLite 래퍼
- `config/`: 전략, 계약, DAG, Telegram, alerts 설정
- `data/analysis-state/YYYY-MM-DD/`: 일자별 Stage 산출물
- `data/feedback/`: 스냅샷, 분석, challenger, ghost 추적
- `data/intraday/`: 장중 스냅샷과 경보 상태
- `data/timeseries.db`: Stage 3/4 이중화 저장소
- `dashboard/app/`: Next.js 16 app router 엔트리와 실험 페이지
- `dashboard/components/`: 범용 시각화/탭/패널 컴포넌트
- `knowledge/daily/`: 브리핑, prompt, 검증 메모
- `knowledge/wiki/`: 누적 기억, 운영 규칙, 증권별 메모

## 대시보드 현재 구조

메인 엔트리:

- `dashboard/app/page.tsx`: 메인 대시보드 조립
- `dashboard/app/lib/data-loader.ts`: intraday / ghost / backtest 보조 로더
- `dashboard/app/api/intraday/route.ts`: 장중 polling endpoint
- `dashboard/app/simulator/page.tsx`: What-if simulator

최근 추가된 app 전용 컴포넌트:

- `dashboard/app/components/IntradayAutoRefresh.tsx`
- `dashboard/app/components/IntradayAlertBanner.tsx`
- `dashboard/app/components/EvidenceChain.tsx`
- `dashboard/app/components/ScoreBreakdownPanel.tsx`
- `dashboard/app/components/GhostPortfolio.tsx`
- `dashboard/app/components/BacktestSummary.tsx`

기존 공용 대시보드 컴포넌트:

- `dashboard/components/MainNav.tsx`
- `dashboard/components/FeedbackPanel.tsx`
- `dashboard/components/AllocationHeatmap.tsx`
- `dashboard/components/ClusterMap.tsx`
- `dashboard/components/AccountTabs.tsx`
- `dashboard/components/HoldingTabs.tsx`
- `dashboard/components/RecommendationTabs.tsx`

## 핵심 산출물

### 전략 / 운영 산출물

- `data/analysis-state/YYYY-MM-DD/stage1-report-extracts-v2.json`
- `data/analysis-state/YYYY-MM-DD/impact-map.json`
- `data/analysis-state/YYYY-MM-DD/stage2-strategy-options.json`
- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`
- `data/analysis-state/YYYY-MM-DD/holding-clusters.json`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`
- `data/analysis-state/YYYY-MM-DD/rebalancing-schedule.json`
- `data/analysis-state/YYYY-MM-DD/pipeline-run.json`
- `data/analysis-state/YYYY-MM-DD/stage-contract-validation.json`
- `data/analysis-state/YYYY-MM-DD/briefing-fidelity-validation.json`

### 장중 / 운영 알림

- `data/intraday/latest.json`
- `data/intraday/YYYY-MM-DD/market-lite.json`
- `data/intraday/YYYY-MM-DD/emergency-alerts.json`
- `data/analysis-state/YYYY-MM-DD/stage3-intraday-updates.json`

### 피드백 / 검증 / 백테스트

- `data/feedback/snapshots/YYYY-MM-DD.json`
- `data/feedback/analysis/YYYY-MM-DD-feedback.json`
- `data/feedback/challenger-weights.json`
- `data/feedback/challenger-backtest.json`
- `data/feedback/ghost-portfolio.jsonl`
- `data/backtest/engine-latest.json`
- `data/timeseries.db`

## 문서 진입 순서

1. `README.md`
2. `docs/REPO_STRUCTURE.md`
3. `docs/OPERATOR_RUNBOOK.md`
4. `docs/STAGE_1_4_ARCHITECTURE.md`
5. `docs/SCORE_SYSTEM_V2.md`
6. `dashboard/README.md`
7. `docs/SHADOW_PIPELINE_OVERVIEW.md`
8. `docs/SHADOW_OUTPUT_SCHEMAS.md`

## 운영 원칙

- 공개 배포보다 로컬 운영을 우선합니다.
- 날짜 기준 산출물은 `data/analysis-state/YYYY-MM-DD`, `data/intraday`, `data/feedback`에서 추적합니다.
- 대시보드와 위키는 가능한 한 동일 파일 산출물을 읽습니다.
- 구조가 바뀌면 코드와 함께 README와 구조 문서도 같이 갱신합니다.
