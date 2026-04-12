# EcoReport Repository Structure

이 문서는 현재 `/Users/seo/stock-pilot` 로컬 저장소의 실제 구조를 코드 기준으로 정리합니다.

## 최상위 구조

```text
stock-pilot/
├── config/                  전략, 계약, DAG, alerts, Telegram 설정
├── dashboard/               Next.js 16 대시보드 워크스페이스
├── data/                    일자별 산출물, 피드백, intraday, SQLite 저장소
├── docs/                    운영/구조 문서
├── knowledge/               daily 문서와 wiki 메모리
├── logs/                    일일 러너 로그
├── reports/                 브리핑/리포트 출력물
├── scripts/                 파이프라인, 검증, 수집, 보조 유틸
└── package.json             루트 스크립트 + workspaces
```

## config/

현재 운영에 직접 쓰이는 핵심 설정 파일:

- `config/strategy.json`: 배분/점수/세금 가정
- `config/watchlist.json`: 관심 종목/ETF
- `config/securities.json`: 보안 마스터와 카테고리 규칙
- `config/alerts.json`: 장중 경보 조건
- `config/pipeline-manifest.yaml`: DAG 정의
- `config/stage-contracts.json`: Stage JSON contract 규격
- `config/telegram.json`: Telegram bot 설정
- `config/market-calendar.json`: 휴장일/달력

## scripts/

### 일일 운영 엔트리

- `scripts/run-daily-system.sh`
- `scripts/run-strategy-pipeline.sh`
- `scripts/run-pipeline-dag.js`

### Stage 1 ~ 4

- `scripts/build-stage1-report-extracts.js`
- `scripts/build-stage1-5-gemini-deep-research-prompt.js`
- `scripts/build-stage1-6-rich-briefing.js`
- `scripts/build-stage1-7-followup-research-map.js`
- `scripts/build-stage1-7-gemini-follow-up-prompt.js`
- `scripts/build-stage2-strategy-prompt.js`
- `scripts/build-stage2-strategy-gemini.py`
- `scripts/build-stage2-strategy-claude.js`
- `scripts/build-stage2-strategy-mock.js`
- `scripts/build-impact-map.js`
- `scripts/build-stage3-quant-scores.js`
- `scripts/build-holding-clusters.js`
- `scripts/build-stage4-execution-plan.js`
- `scripts/build-stage4-critic.js`

### 운영 보강

- `scripts/send-telegram-summary.js`
- `scripts/fetch-market-data-lite.js`
- `scripts/evaluate-alert-triggers.js`
- `scripts/recompute-stage3-intraday.js`
- `scripts/run-intraday-alert-pipeline.js`
- `scripts/build-rebalancing-schedule.js`

### 피드백 / 검증 / 실험

- `scripts/build-feedback-snapshot.js`
- `scripts/build-feedback-analysis.js`
- `scripts/auto-tune-weights.js`
- `scripts/auto-tune-challenger.js`
- `scripts/backtest-challenger.js`
- `scripts/build-ghost-portfolio.js`
- `scripts/backtest-engine.js`
- `scripts/validate-stage-contracts.js`
- `scripts/validate-briefing-fidelity.js`
- `scripts/verify-daily-system.js`

### scripts/lib/

공용 헬퍼는 주로 여기 있습니다.

- `scripts/lib/pipeline-utils.js`: 공용 파일 IO, contract metadata, root/date helpers
- `scripts/lib/analysis-context.js`: Stage prompt용 공용 로더
- `scripts/lib/timeseries-db.js`: `better-sqlite3` 래퍼
- `scripts/lib/refinement-rounds.js`
- `scripts/lib/trading-calendar.js`

## data/

### 일자별 Stage 산출물

```text
data/analysis-state/YYYY-MM-DD/
├── stage1-report-extracts-v2.json
├── impact-map.json
├── stage2-strategy-options.json
├── stage3-quant-scores.json
├── holding-clusters.json
├── stage4-execution-plan.json
├── rebalancing-schedule.json
├── pipeline-run.json
├── stage-contract-validation.json
└── briefing-fidelity-validation.json
```

### 장중 상태

```text
data/intraday/
├── latest.json
└── YYYY-MM-DD/
    ├── market-lite.json
    ├── emergency-alerts.json
    └── emergency-alerts.md
```

### 피드백 / 검증

- `data/feedback/snapshots/`
- `data/feedback/analysis/`
- `data/feedback/challenger-weights.json`
- `data/feedback/challenger-backtest.json`
- `data/feedback/ghost-portfolio.jsonl`

### 저장소 / 백테스트

- `data/timeseries.db`
- `data/backtest/engine-latest.json`
- `data/backtest/engine-results.json`

## dashboard/

### app/

```text
dashboard/app/
├── api/
│   ├── intraday/route.ts
│   └── trigger/route.ts
├── components/
│   ├── BacktestSummary.tsx
│   ├── EvidenceChain.tsx
│   ├── GhostPortfolio.tsx
│   ├── IntradayAlertBanner.tsx
│   ├── IntradayAutoRefresh.tsx
│   └── ScoreBreakdownPanel.tsx
├── dashboard-test/
│   ├── page.tsx
│   ├── decision/page.tsx
│   └── feedback/page.tsx
├── feedback-report/page.tsx
├── market-news/page.tsx
├── reports/page.tsx
├── reports/[slug]/page.tsx
├── simulator/
│   ├── page.tsx
│   ├── simulator-client.tsx
│   ├── SimulatorEngine.ts
│   └── SliderPanel.tsx
├── lib/data-loader.ts
└── page.tsx
```

### components/

이 폴더에는 메인 페이지가 재사용하는 범용 UI 컴포넌트가 있습니다.

- `AccountTabs.tsx`
- `HoldingTabs.tsx`
- `RecommendationTabs.tsx`
- `RecommendationItemTabs.tsx`
- `AllocationHeatmap.tsx`
- `ClusterMap.tsx`
- `FeedbackPanel.tsx`
- `MainNav.tsx`
- `ExperimentalUiProvider.tsx`
- `ExperimentalVisibility.tsx`

## knowledge/

### knowledge/daily/

- 일별 브리핑
- manual-kit prompt / response
- fidelity / validation markdown

### knowledge/wiki/

- `memory/`: decision journal, operating rules, backlog
- `accounts/`: 계좌별 노트
- `securities/`: 종목/ETF별 메모
- `daily/`: 일일 요약 연결

## 단계별 진행 방식

### 일일 기본 흐름

1. 리포트 수집/텍스트화
2. 포트폴리오 동기화
3. 시장 데이터 / technical / marketvoice / FRED 수집
4. RAG 코퍼스 갱신
5. optional Gemini 브리핑 생성
6. Stage 1 -> 1.5 -> 1.6 -> 2 -> 2.5 -> 3 -> clusters -> 4
7. wiki / vault 게시
8. verify + Telegram summary
9. ghost / challenger 백그라운드 실행

### 장중 보강 흐름

1. `fetch-market-data-lite.js`
2. `evaluate-alert-triggers.js`
3. `recompute-stage3-intraday.js`
4. `data/intraday/latest.json` 갱신
5. dashboard polling 반영

### 구조를 읽는 권장 순서

1. `README.md`
2. `docs/REPO_STRUCTURE.md`
3. `docs/STAGE_1_4_ARCHITECTURE.md`
4. `dashboard/README.md`
