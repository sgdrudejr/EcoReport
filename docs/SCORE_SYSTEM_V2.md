# EcoReport Score System v2

## 목적

v2 점수체계의 목적은 세 가지입니다.

1. 총점이 어떻게 만들어졌는지 설명 가능해야 한다.
2. 데이터가 부족할 때는 자동으로 단순한 배분 점수 중심으로 수렴해야 한다.
3. 리스크는 가중합 안에 섞지 않고 별도 패널티로 보여줘야 한다.

즉, v2는 아래 구조를 따른다.

```text
TotalScore = BaseScore - RiskPenalty
```

## BaseScore

BaseScore는 다섯 요소를 coverage-aware 방식으로 합성한다.

- AllocationScore: 목표 배분 대비 괴리
- TechScore: 보유 종목 기술 점수 가중 평균
- ReportScore: 리포트 영향 점수
- RegimeFit: 현재 레짐에 맞는 배분인지
- Stage2Score: 전략 탐색 결과 bias 점수

실제 반영 비중은 데이터 커버리지에 따라 자동 조정된다.

```text
wT = alphaT * techCoverage
wI = alphaI * impactCoverage
wR = alphaR * regimeConfidence
wS = alphaS * stage2Available
wA = 1 - (wT + wI + wR + wS)
```

기본 프로파일은 `balanced`:

- allocation 0.45
- tech 0.30
- report 0.15
- regime 0.05
- stage2 0.05

## RiskPenalty

현재 v2 subset에서 실제 적용하는 패널티는 아래 세 축이다.

### 1. Data Quality

- 부분 캡처 계좌
- `기타` 자산 비중 과다
- 기술 스냅샷 누락

### 2. Concentration

- HHI 기반 집중도
- 단일 종목 최대 비중

### 3. Regime Stress

- `HIGH_VOL` / `BEAR` 레짐에서 위험자산 비중이 권장 범위를 초과할 때

### Tail Risk

ES/CVaR, MDD는 스키마는 열어두되 현재는 `not_applied`.

이유:

- 일별 가격 히스토리 정합성이 아직 충분하지 않음
- 가짜 정밀도보다 명시적 미적용이 더 안전함

## 입력 우선순위

Stage 3는 아래 우선순위로 리포트 영향을 읽는다.

1. `impact-map.json`
2. `stage1-report-extracts-v2.json` 의 `portfolio_impacts_candidate` fallback

fallback 후보 영향은 과도한 포화를 막기 위해:

- 상위 근거 몇 개만 반영
- confirmed impact가 없으면 평균 강도 기반으로 축소
- 전략/매크로 리포트는 종목 리포트보다 낮은 타입 가중치 사용

## 출력 구조

Stage 3 산출물은 아래를 포함한다.

- `regime`
- `coverage`
- `configUsed`
- `holdings.*.scores`
- `accounts.*.baseScores`
- `accounts.*.effectiveWeights`
- `accounts.*.riskPenalty`
- `portfolio.totalScore`

파일 위치:

- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`

## 대시보드 표시 원칙

대시보드는 점수만 보여주지 않고 아래를 함께 보여준다.

- 왜 이 점수인가
- 점수를 올리려면 무엇을 해야 하는가
- 현재 데이터 커버리지
- 점수 반영 비중
- 리스크 패널티 총점

즉 사용자는 아래를 바로 읽을 수 있어야 한다.

- 배분이 몇 점인지
- 기술이 몇 점인지
- 리포트가 몇 점인지
- 무엇 때문에 몇 점 감점됐는지
- 무엇을 하면 총점이 회복되는지

## 아직 남은 과제

### 1. impact-map 확정 레이어

현재는 fallback candidate 영향이 여전히 넓다.

가장 큰 다음 단계는:

- `impact-map.json` 생성
- 리포트-종목-계좌 연결을 수동/LLM 확정 레이어로 분리

### 2. Tail Risk 활성화

가격 히스토리 품질이 확보되면 아래를 활성화한다.

- ES/CVaR
- MDD

### 3. 계좌별 별도 파일

필요시 아래를 추가할 수 있다.

- `data/analysis-state/YYYY-MM-DD/account-score-ISA.json`
- `.../account-score-PENSION.json`
- `.../account-score-TOSS.json`

## 검증 포인트

v2 적용 후 체크할 것:

1. `reportCoverageScore` 가 비정상적으로 100에 고정되지 않는가
2. `riskPenalty` 가 실제 계좌 문제를 설명하는가
3. 데이터가 없을 때 `allocation` 가중치가 자동으로 커지는가
4. 대시보드 설명 문구가 사용자가 이해할 수 있는 수준인가
