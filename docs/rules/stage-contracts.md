# EcoReport Stage Contracts

이 문서는 Stage 1~4 사이의 출력 계약을 "에이전트가 읽을 수 있는 규칙"으로 고정합니다.

## Validation Command

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run verify -- --date YYYY-MM-DD
```

## Stage 1: Report Extracts

입력:

- `data/reports/YYYY-MM-DD/index.json`
- `data/reports/YYYY-MM-DD/text/*.txt`
- `data/portfolio/latest.json`

출력:

- `data/analysis-state/YYYY-MM-DD/stage1-report-extracts-v2.json`

최소 계약:

- `extracts[]`가 비어 있지 않아야 한다.
- 각 extract는 `id`, `title`, `report_type`, `date`, `text_path`, `key_thesis`를 가져야 한다.
- `portfolio_impacts_candidate[]`가 있으면 각 항목은 `target_code`, `direction`, `reason` 중 최소 핵심 필드를 가져야 한다.

의미 계약:

- Stage 1은 "추천"이 아니라 "연구 노트"여야 한다.
- 직접 종목/계좌 연결이 애매하면 candidate를 좁게 잡고 confidence를 낮춘다.

## Stage 1.5: Impact Map

출력:

- `data/analysis-state/YYYY-MM-DD/impact-map.json`

최소 계약:

- `impacts[ticker][]`의 `report_id`는 반드시 Stage 1 extract id와 연결되어야 한다.
- impact ticker는 포트폴리오 또는 추적 대상 universe 안에서 해석 가능해야 한다.
- 각 impact는 `direction`, `magnitude`, `confidence`, `account_relevance`, `rationale`를 가져야 한다.

의미 계약:

- Stage 1 candidate가 많은데 `impact-map`이 비면 경고한다.
- macro 리포트는 기본적으로 자산군/계좌 번역을 거친 뒤 종목으로 내려와야 한다.

## Stage 2: Strategy Exploration

출력:

- `data/analysis-state/YYYY-MM-DD/stage2-strategy-options.json`

최소 계약:

- 실제 LLM 결과가 없으면 Stage 2는 실패해야 한다.
- `holdings_bias[]` 항목은 `ticker`, `action`, `conviction`, `rationale`를 가져야 한다.
- `action`은 `BUY`, `HOLD`, `TRIM`, `WATCH` 중 하나여야 한다.

의미 계약:

- Stage 2는 해석 레이어다.
- mock은 운영 경로에서 허용하지 않는다. 실제 LLM provider가 실패하면 실패로 기록해야 한다.
- 포트폴리오나 watchlist에 없는 ticker는 "새 후보"로 분리되어야 한다.

## Stage 3: Quant Scores

출력:

- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`

최소 계약:

- `holdings`는 포트폴리오 coded holding을 거의 모두 커버해야 한다.
- `reportImpacts[]`의 `reportId`는 Stage 1 extract id와 연결되어야 한다.
- `coverage.impactCoverage`는 실제 impact-map 상태와 대체로 일치해야 한다.

의미 계약:

- Stage 3는 최종 점수의 재현 가능한 계산 레이어다.
- Stage 2 bias가 있더라도 Stage 3는 점수 구조를 설명할 수 있어야 한다.

## Stage 4: Execution Plan

출력:

- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`
- `reports/daily/YYYY-MM-DD-stage4-execution-plan.md`

최소 계약:

- `accountPlans[]`는 현재 포트폴리오 account key와 연결되어야 한다.
- `macroCommentary.actionLine`은 비어 있으면 안 된다.
- `stage1Drivers[]`의 `id`는 Stage 1 extract id와 연결되어야 한다.

의미 계약:

- 강한 액션은 Stage 1/Impact/Stage 3의 근거 사슬이 보여야 한다.
- `impact-map`에 근거가 없는데도 강한 staged buy가 많으면 재검토 대상이다.

## Escalation Rules

다음 조건이면 자동 진행보다 에스컬레이션을 우선합니다.

1. 포트폴리오 snapshot이 incomplete
2. Stage 1은 풍부한데 `impact-map`이 비어 있음
3. Stage 2가 없거나 mock인데 Stage 4 액션이 공격적
4. Stage 4 `stage1Drivers`가 비어 있는데 액션 문구는 단정적
