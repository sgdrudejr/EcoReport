# FEATURE STATUS

기준일: 2026-04-11

이 문서는 EcoReport repo에서 F4, F1, F2, F3가 현재 어디까지 반영되었는지 운영자 관점에서 빠르게 확인하기 위한 상태 문서입니다. 계획 문서가 아니라 현재 구현 기준이며, 데이터 부족으로 아직 no-op 또는 보수 운용 상태인 부분도 그대로 적었습니다.

## 한눈에 보기

| Feature | 현재 상태 | 백엔드 반영 | Dashboard 반영 | 비고 |
|---|---|---|---|---|
| F4 Stage 2 실제 LLM 전환 | 반영됨 | Gemini → Mock 폴백 체인 | 전용 UI 없음 | `stage2-run-log.json`으로 provider 추적 |
| F1 Performance Feedback Loop | 반영됨 | snapshot/analysis/report/latest-feedback 생성 | `/feedback` 페이지 노출 | auto-adjust는 safety guard가 있어 현재 데이터 부족 시 no-op 가능 |
| F2 Stop-Loss + Position Sizing | 반영됨 | ATR, stop-loss override, inverse ATR sizing, correlation haircut | 메인 dashboard 실행 카드/실행 리스트에 핵심 상태 노출 | 일부 raw 값은 아직 UI 미연결 |
| F3 Volatility Conditional Entry | 반영됨 | entryCondition, urgency, emergencyDefense 계산 | 메인 dashboard 실행 카드/실행 리스트에 핵심 상태 노출 | watchlist 전반 정밀화는 추가 작업 필요 |

## F4 Stage 2 실제 LLM 전환

### 변경 파일

- `scripts/run-strategy-pipeline.sh`
- `docs/STAGE2_LLM_PROVIDER.md`

### Backend 활용 방식

- Stage 2 provider는 현재 `Gemini → Mock` 순서로 동작합니다.
- `scripts/run-strategy-pipeline.sh`가 provider 시도와 폴백을 제어합니다.
- 실행 결과는 `data/analysis-state/YYYY-MM-DD/stage2-run-log.json`에 남습니다.
- 다운스트림은 `stage2-strategy-options.json` 스키마만 보므로 provider가 바뀌어도 Stage 3/4는 동일하게 동작합니다.

### Dashboard 활용 방식

- 현재 전용 Stage 2 provider UI는 없습니다.
- 운영자는 dashboard보다 `stage2-run-log.json`과 `docs/STAGE2_LLM_PROVIDER.md`를 확인해야 합니다.

### 아직 inactive / no-op 상태

- API key 또는 외부 호출 실패 시 Mock으로 자동 폴백됩니다.
- 즉, Stage 2 자체가 멈추지 않게 했지만, fallback일 때는 전략 품질이 LLM provider 대비 낮을 수 있습니다.

### 운영자가 봐야 할 곳

- `data/analysis-state/YYYY-MM-DD/stage2-run-log.json`
- `data/analysis-state/YYYY-MM-DD/stage2-strategy-options.json`

## F1 Performance Feedback Loop

### 변경 파일

- `scripts/build-feedback-snapshot.js`
- `scripts/build-feedback-analysis.js`
- `scripts/build-feedback-report.js`
- `scripts/run-strategy-pipeline.sh`
- `scripts/build-stage3-quant-scores.js`
- `dashboard/lib/feedback.ts`
- `dashboard/app/feedback/page.tsx`
- `dashboard/components/MainNav.tsx`
- `config/strategy.json`

### Backend 활용 방식

- `scripts/build-feedback-snapshot.js`
  매일 Stage 3/4 결과를 `data/feedback/snapshots/YYYY-MM-DD.json`에 저장합니다.
- `scripts/build-feedback-analysis.js`
  스냅샷과 forward return을 연결해 `data/feedback/analysis/YYYY-MM-DD-feedback.json`과 `data/feedback/latest-feedback.json`을 생성합니다.
- `scripts/build-feedback-report.js`
  사람이 빠르게 읽을 수 있는 `reports/feedback-summary.md`를 생성합니다.
- `scripts/build-stage3-quant-scores.js`
  `latest-feedback.json`을 읽어 factor weight auto-adjust를 적용할 수 있습니다.

### Dashboard 활용 방식

- `/feedback`
  점수-수익률 상관, factor predictive power, worst mispredictions, auto-adjust 상태를 확인할 수 있습니다.
- 메인 dashboard에는 feedback 전용 시각화는 아직 붙지 않았습니다.

### auto-adjust safety guard

현재 auto-adjust는 구조적으로 열려 있지만 바로 공격적으로 반영되지 않도록 다음 안전장치를 둡니다.

- `minSamples`
  horizon별 최소 샘플 수 미달이면 그 factor는 조정 대상에서 제외됩니다.
- `minReadyFactors`
  최소 준비 factor 수를 만족하지 못하면 전체 적용은 no-op입니다.
- `emaAlpha`
  raw suggestion을 현재 적용 weight와 EMA 방식으로 완만하게 섞습니다.
- `maxStepChangePct`
  한 번의 분석에서 weight가 급격히 움직이지 않도록 step cap을 둡니다.
- `minCorrelationAbs`
  상관계수가 약한 노이즈 구간은 조정 신호로 쓰지 않습니다.
- `currentAppliedWeights` / `suggestedWeights` / `appliedWeights` 분리 기록
  현재 적용 중인 값, raw suggestion, 실제 반영값을 구분합니다.

### 아직 inactive / no-op 상태

- 샘플 수가 충분히 쌓이지 않으면 `autoAdjustment.noOp = true` 상태를 유지합니다.
- 즉, hook은 연결되어 있지만 데이터 부족 시 실제 weight는 기존 값 그대로 유지됩니다.

### 운영자가 봐야 할 곳

- `/feedback`
- `data/feedback/latest-feedback.json`
- `reports/feedback-summary.md`
- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`
  `configUsed.factorModel.autoAdjust`에서 실제 적용 여부를 확인합니다.

## F2 Stop-Loss + Position Sizing

### 변경 파일

- `scripts/calc-technicals.js`
- `scripts/build-stage3-quant-scores.js`
- `scripts/build-stage4-execution-plan.js`
- `config/strategy.json`
- `dashboard/lib/portfolio-guidance.ts`
- `dashboard/app/page.tsx`
- `dashboard/components/ExecutionListTable.tsx`
- `dashboard/components/ExecutionNarrativeCard.tsx`

### Backend 활용 방식

- `scripts/calc-technicals.js`
  `ATR`, `ATR%`, `recent_high`를 계산합니다.
- `scripts/build-stage3-quant-scores.js`
  진입가 대비 손실, 최근 고점 대비 낙폭을 바탕으로 stop-loss override를 계산합니다.
- `scripts/build-stage4-execution-plan.js`
  `inverse_atr` 사이징, 상관관계 haircut, 단일 포지션 상한을 반영한 실행 금액을 만듭니다.

### Dashboard 활용 방식

- 메인 dashboard의 `오늘의 실행 리스트`
  각 실행 row에 stop-loss 상태, 상관관계 haircut, ATR 사이징 여부가 badge/status row로 표시됩니다.
- 메인 dashboard의 계좌별 `추천 실행 방향`
  매수/매도/보유 카드 안에서 stop-loss, sizing, fallback 여부를 함께 볼 수 있습니다.

### 아직 UI 미연결인 값

- `baseSuggestedAmount`
- `maxSinglePositionAmount`
- `maxCorrelationToPortfolio`의 숫자 원값
- `atrPct`의 숫자 원값

위 값들은 JSON에는 있지만, 현재 메인 dashboard에는 해석된 결과만 노출됩니다.

### 운영자가 봐야 할 곳

- 메인 dashboard `오늘의 실행 리스트`
- 메인 dashboard 계좌별 `추천 실행 방향`
- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`

## F3 변동성 조건부 진입

### 변경 파일

- `scripts/build-stage4-execution-plan.js`
- `config/strategy.json`
- `dashboard/lib/portfolio-guidance.ts`
- `dashboard/app/page.tsx`
- `dashboard/components/ExecutionListTable.tsx`
- `dashboard/components/ExecutionNarrativeCard.tsx`

### Backend 활용 방식

- `scripts/build-stage4-execution-plan.js`
  `entryCondition`, `urgency`, `entryTriggers`, `emergencyDefense`를 계산합니다.
- 매수 후보는 `aggressive`, `qualified`, `dca_keep`, `watch`, `technical_fallback`, `emergency_defense` 등으로 분류됩니다.
- 시장 급락/VIX 급등 조건이면 `emergencyDefense`가 켜지고 매수는 보류됩니다.

### Dashboard 활용 방식

- 메인 dashboard `오늘의 실행 리스트`
  `entryCondition`, `urgency`, `technical_fallback`, `emergencyDefense`를 badge/status row로 봅니다.
- 메인 dashboard 계좌별 `추천 실행 방향`
  긴급 방어 모드가 켜진 계좌는 상단 경고 박스로 먼저 보입니다.

### 아직 UI 미연결인 값

- `emergencyDefense.vix`
- `emergencyDefense.worstIndexDropPct`
- `conditionMet`
- `watches` 전체 목록

즉, 운영 판단에 필요한 핵심 해석은 보이지만, raw numeric detail과 watch bucket 전체는 아직 JSON 중심입니다.

### 아직 inactive / no-op 상태

- VIX 데이터가 비는 날에는 emergency defense의 VIX 축이 약해질 수 있습니다.
- 신규 후보 중 일부는 아직 Stage 3 개별 점수가 부족해 `technical_fallback`으로 보수 분류됩니다.

### 운영자가 봐야 할 곳

- 메인 dashboard `오늘의 실행 리스트`
- 메인 dashboard 계좌별 `추천 실행 방향`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`

## 현재 남은 리스크

- Feedback 데이터 길이가 아직 짧으면 auto-adjust는 no-op이 정상입니다. 구조는 열려 있어도 실제 튜닝 근거는 아직 약할 수 있습니다.
- 신규 watchlist 후보 전체에 대해 Stage 3 스타일 정량 점수가 충분히 깔리지 않으면 `technical_fallback` 비중이 높게 남을 수 있습니다.
- VIX/시장 데이터 수집 실패 시 emergency defense가 일부 축만으로 판단될 수 있습니다.
- F4는 fallback 안전성은 있지만, provider가 LLM이 아닌 Mock으로 내려간 날은 Stage 2 품질 저하를 운영자가 별도 확인해야 합니다.
- Stage 4 계획 이후 실제 주문 체결, T+1 동기화, 주문 결과 검증 자동화는 아직 완결되지 않았습니다.

## 다음 우선순위

1. 신규 후보까지 Stage 3 수준 점수 확장
2. Stage 4 계획 이후 실제 주문/체결/포트 sync 자동 검증
3. feedback backfill로 auto-adjust가 no-op을 벗어날 만큼 표본 확보
4. 리서치 소스별 적중률 추적
5. emergency defense raw 지표와 watch bucket을 메인 UI에 추가 노출
