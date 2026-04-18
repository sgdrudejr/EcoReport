# EcoReport Score System v3

## 목적

현재 Stage 3 점수체계는 세 가지를 동시에 만족하는 것을 목표로 합니다.

1. 팩터 입력이 서로 다른 스케일을 가져도 비교 가능해야 한다.
2. 종목 점수만 높고 상관관계가 큰 포지션 쏠림은 별도 패널티로 제어해야 한다.
3. 계좌의 세금 구조가 다르면 최종 점수도 달라져야 한다.

즉 현재 구조는 아래처럼 읽으면 됩니다.

```text
FinalScore = TaxAware( BaseScore - RiskPenalty )
```

## 1. Factor Score

포지션별 팩터 점수는 교차단면 Z-score 정규화로 계산합니다.

```text
z(i, k) = winsor( (X(i, k) - mean(k)) / std(k), +/- tau )
FactorScore(i) = clip( 50 + scale * sum_k( w(k) * z(i, k) ), 0, 100 )
```

현재 구현에서 사용하는 팩터 축은 아래 네 가지입니다.

- `momentum`: 이평선, MACD, RSI, ADX 기반 추세/모멘텀
- `research`: impact-map / Stage 1 / Stage 2가 주는 리서치 강도
- `income`: 카테고리별 기대 인컴 수익률
- `macroFit`: 현재 레짐 기준 목표 배분과의 적합도

추가 반영:

- `research` 팩터는 `data/feedback/analysis/*`의 `researchSourceAccuracy`가 있으면 source multiplier를 적용합니다.
- 즉 같은 리포트 강도라도 과거 적중률이 높은 소스는 더 강하게, 낮은 소스는 더 약하게 반영합니다.

참고:

- Winsor threshold, scale, factor weight는 `config/strategy.json`의 `scoring.factorModel`에서 조정합니다.
- 아직 `PER`, `ROE` 같은 펀더멘털 원천 데이터가 없으므로, 현재는 실행 가능한 대체 팩터 세트를 사용합니다.

## 2. Base Score

계좌 단위 기본 점수는 coverage-aware 가중합입니다.

```text
BaseScore =
  Allocation * wA +
  Factor * wF +
  Tech * wT +
  Report * wR +
  Regime * wG +
  Stage2 * wS +
  Leading * wL
```

가중치는 프로파일별 최대 비중을 두고, 실제 데이터 커버리지에 따라 자동 축소합니다.

```text
wF = alphaF * factorCoverage
wT = alphaT * techCoverage
wR = alphaR * impactCoverage
wG = alphaG * regimeConfidence
wS = alphaS * stage2Available
wL = alphaL * fredAvailable
wA = 1 - (wF + wT + wR + wG + wS + wL)
```

## 3. Risk Penalty

리스크는 기본 점수 안에 섞지 않고 별도 감점으로 계산합니다.

### Data Quality

- 부분 캡처 계좌
- `기타` 자산 비중 과다
- 기술 스냅샷 누락

### Concentration

- HHI 기반 집중도
- 단일 포지션 최대 비중

### Covariance

- 보유 종목 일별 수익률로 표본 공분산 계산
- 상수 상관구조 타깃으로 shrinkage
- `sqrt(w^T Σ w)` 기반 연율 변동성을 패널티로 환산

즉 현재 구현은 Ledoit-Wolf의 exact closed-form은 아니지만, 같은 목적의 constant-correlation shrinkage를 사용합니다.

### Cluster Warning

점수 체계와 별도로, 최근 수익률 상관관계 기반 클러스터가 Stage 4 경고로 연결됩니다.

- 생성 파일: `data/analysis-state/YYYY-MM-DD/holding-clusters.json`
- 사용 위치: `build-stage4-execution-plan.js`, 대시보드 `ClusterMap`

즉 점수는 높아도 동일 클러스터 과집중이면 실행 단계에서 제동이 걸릴 수 있습니다.

### Regime Stress

- `HIGH_VOL` / `BEAR` 레짐에서 위험자산 비중 초과 시 감점

### Tail Risk

- 포트폴리오 가중 일별 수익률 기반 Max Drawdown
- CVaR 95%

## 4. Tax-Aware Adjustment

리스크 차감 후 점수는 계좌별 세후 승수로 한 번 더 조정합니다.

```text
AfterTaxScore = PreTaxScore * ( 1 + alpha * Yield_p * TaxSpread / max(Risk_p, floor) )
```

여기서:

- `Yield_p`: 계좌 보유 포지션의 가중 평균 기대 인컴 수익률
- `TaxSpread`: `normalTaxRate - accountTaxRate`
- `Risk_p`: shrinkage covariance 기반 포트폴리오 변동성

현재 세율과 카테고리별 기대 인컴 수익률은 `config/strategy.json`의 `scoring.taxAware` 가정값을 사용합니다.

주의:

- 이 값들은 운영 가정치이며, 법정 세율의 자동 조회가 아닙니다.
- 연금 계좌처럼 실제 과세가 인출 조건에 좌우되는 경우는 계좌별 가정을 직접 수정해야 합니다.

## 출력 구조

Stage 3 산출물은 아래를 포함합니다.

- `regime`
- `coverage.factorCoverage`
- `factorStats`
- `holdings.*.factor`
- `positions.*`
- `accounts.*.baseScores.factorScore`
- `accounts.*.riskPenalty.breakdown.covariance`
- `accounts.*.taxAdjustment`
- `portfolio.preTaxScore`
- `portfolio.totalScore`

피드백 연계 출력:

- `researchSourceAccuracyLoaded`
- source multiplier가 반영된 `report`/`research` 계열 점수

파일 위치:

- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`

## 병렬 StockPilot 수식 레이어

2026-04-17 기준으로 Stage 3 산출물에는 기존 교차단면 점수 외에 `stockpilotQuant`가 병렬로 추가됩니다.

- 목적: 사용자가 정의한 결정론적 수식을 그대로 계산해, `보유 종목`과 `신규 후보`를 섞지 않고 따로 채점
- 입력: `data/technical/YYYY-MM-DD.json`, `data/macro/fred-YYYY-MM-DD.json`, `data/portfolio/latest.json`, `stage2-strategy-options.json`
- 출력 위치: `stage3-quant-scores.json.stockpilotQuant`

구조:

- `stockpilotQuant.holdings[]`
  - 계좌 보유 포지션별 결과
  - 정책 상태는 `ADD / HOLD / TRIM / EXIT`
- `stockpilotQuant.candidates[]`
  - Stage 2 신규 후보 중 미보유 종목 결과
  - 정책 상태는 `BUY / WATCH / REJECT`
- `stockpilotQuant.summary`
  - 필터 통과 수, 상위 점수 종목 요약

중요한 운영 원칙:

- 수식 점수는 holdings / candidates 모두 같은 공통 공식을 사용
- 다만 액션 해석은 레이어별로 분리해 혼선을 막음
- 아직 기술 스냅샷에 없는 입력(`anchored VWAP`, 이벤트 앵커 기반 POC 정밀값 등)은 `null + data_quality_flags`로 남기고, Stage 합산에서는 0점 처리

### 2026-04-18 역추정 기반 v1.3 튜닝

`StockEasy` 전략실(`모멘텀/피크/밸류`)의 최근 거래 표본을 같은 수식으로 역산한 결과를 반영해, 아래 항목을 조정했습니다.

- `Score_Keltner_Vol` 가중치 상향: 돌파폭 + 거래량 급증 설명력 강화
- `Score_Div` 구간 재정의: 과매도 극단보다 `RSI 45~68` 추세 지속 구간을 우대
- `Score_Stoch` 완화: `K>D` 조건에서 80~90 구간도 약한 가점 허용

관련 산출물:

- `data/analysis-state/2026-04-18/stockeasy-momentum-reverse-engineering.json`
- `data/analysis-state/2026-04-18/stockeasy-peak-reverse-engineering.json`
- `data/analysis-state/2026-04-18/stockeasy-value-reverse-engineering.json`

## 대시보드 표시 원칙

대시보드는 아래를 한 번에 보여줘야 합니다.

- 팩터 점수가 몇 점인지
- 기술/리포트/레짐이 각각 몇 점인지
- 공분산 패널티가 얼마나 붙었는지
- 세후 승수가 최종 점수를 얼마나 바꿨는지

## 현재 남은 과제

1. 팩터 원천 고도화

- 펀더멘털 팩터 feed 연결
- 종목별 실측 배당수익률 feed 연결

2. Tax model 세분화

- 연금 계좌 인출세율 모델
- ISA 비과세 한도/분리과세 구간 반영

3. 포지션 단위 소비자 전환

- 현재는 `holdings`를 코드 단위 fallback으로도 남겨둡니다.
- 이후 대시보드와 추천 보드는 `positions`를 1차 소스로 쓰는 것이 더 정확합니다.

4. Feedback auto-tune 운영 정교화

- 현재는 `auto-tune-weights.js`가 안전장치와 dry-run을 제공
- 이후에는 더 긴 기간/레짐별 표본 검증이 필요합니다.
