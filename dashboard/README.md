# EcoReport Dashboard

이 디렉터리는 EcoReport의 로컬 Next.js 16 대시보드 워크스페이스입니다.

## 역할

- 날짜별 산출물을 서버에서 직접 읽어 UI로 렌더링
- 일일 `03. Report Indexing`~`13. Quality Gates` 결과, 피드백, intraday 상태, ghost/backtest 요약을 한 화면에 통합
- 메인 운영 화면과 보조 실험 화면을 같은 앱 안에서 유지

## 실행

```bash
cd /Users/seo/Documents/Playground/economy-report/dashboard
npm install
npm run dev -- --hostname 0.0.0.0
```

검증:

```bash
npm run build
```

## 현재 app 구조

### 핵심 라우트

- `app/page.tsx`: 메인 대시보드
- `app/dashboard-test/page.tsx`: 테스트 홈
- `app/dashboard-test/decision/page.tsx`: decision 분리 화면
- `app/dashboard-test/feedback/page.tsx`: feedback 분리 화면
- `app/feedback-report/page.tsx`: 피드백 리포트 뷰
- `app/market-news/page.tsx`: marketvoice / 뉴스 계층 뷰
- `app/reports/page.tsx`
- `app/reports/[slug]/page.tsx`
- `app/simulator/page.tsx`: what-if simulator

### app 전용 컴포넌트

- `app/components/IntradayAutoRefresh.tsx`: `/api/intraday` polling 후 refresh
- `app/components/IntradayAlertBanner.tsx`: 장중 경보와 overlay 배너
- `app/components/EvidenceChain.tsx`: 전일 대비 변화 요인 Top 3
- `app/components/ScoreBreakdownPanel.tsx`: score decomposition 시각화
- `app/components/GhostPortfolio.tsx`: 미실행 추천 추적
- `app/components/BacktestSummary.tsx`: timeseries 기반 백테스트 요약

### 공용 컴포넌트

- `components/MainNav.tsx`
- `components/AccountTabs.tsx`
- `components/HoldingTabs.tsx`
- `components/RecommendationTabs.tsx`
- `components/RecommendationItemTabs.tsx`
- `components/AllocationHeatmap.tsx`
- `components/ClusterMap.tsx`
- `components/FeedbackPanel.tsx`
- `components/ExperimentalUiProvider.tsx`
- `components/ExperimentalVisibility.tsx`

### 보조 로더 / API

- `app/lib/data-loader.ts`: intraday / ghost / previous stage3 / backtest 로딩
- `app/api/intraday/route.ts`: 장중 상태 polling endpoint
- `app/api/trigger/route.ts`: 실험용 trigger endpoint
- `app/api/llm-exchange/route.ts`: AI-to-AI 교환 패킷 조회 endpoint

### LLM exchange API

AI끼리 넘길 토큰 효율 JSON은 사람용 HTML/Markdown과 분리합니다.

- `/api/llm-exchange?date=YYYY-MM-DD&packet=manifest`
- `/api/llm-exchange?date=YYYY-MM-DD&packet=research`
- `/api/llm-exchange?date=YYYY-MM-DD&packet=portfolio`
- `/api/llm-exchange?date=YYYY-MM-DD&packet=claim-review`
- `/api/llm-exchange?date=YYYY-MM-DD&packet=source-audit`

## 데이터 원칙

- 대시보드는 가능한 한 서버에서 파일을 직접 읽습니다.
- 메인 데이터는 `data/analysis-state`, `data/intraday`, `data/feedback`, `data/backtest`에서 가져옵니다.
- 장중 상태만 얇은 API route를 통해 polling합니다.

## 주요 입력

- `data/portfolio/latest.json`
- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`
- `data/analysis-state/YYYY-MM-DD/holding-clusters.json`
- `data/intraday/latest.json`
- `data/feedback/analysis/*.json`
- `data/feedback/ghost-portfolio.jsonl`
- `data/backtest/engine-latest.json`

## 현재 메인 페이지에 붙어 있는 보강 레이어

- Intraday auto refresh
- Intraday alert banner
- Evidence chain
- Score decomposition panel
- Ghost portfolio panel
- Backtest summary card

## 개발 시 체크포인트

- `npm run build`가 통과하는가
- 최신 `data/intraday/latest.json`이 없어도 메인 화면이 깨지지 않는가
- 피드백 파일이 없어도 `FeedbackPanel`이 안전하게 빈 상태를 보여주는가
- `simulator`와 `dashboard-test/*` 라우트가 메인 페이지 변경과 분리되어 유지되는가
- app 전용 컴포넌트와 공용 컴포넌트 경계가 흐려지지 않는가
