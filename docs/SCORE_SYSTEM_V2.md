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

파일 위치:

- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`

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
