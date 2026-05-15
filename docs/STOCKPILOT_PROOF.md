# StockPilot Proof

StockPilot Proof는 StockEasy에서 공개적으로 관찰 가능한 시장/섹터/전략 신호의 제품 구조를 참고하되, 브랜드, UI, 비공개 API, 보호 콘텐츠를 복제하지 않는 독립 검증 계층이다.

2026-05-08부터 StockEasy는 필수 의존성이 아니라 optional source다. StockEasy가 사라지거나 유료화되어 수집이 끊겨도 EcoReport의 정규화 데이터와 KIS/기술/로테이션 근거로 자체 레이더를 계속 만든다.

목표는 한 문장이다.

> 오늘 시장 방향이 맞다면, 내 실제 계좌가 그 방향을 얼마나 증명하고 있으며 어디서 반박하고 있는가?

## Inputs

- `data/dashboard/YYYY-MM-DD-dashboard-view.json`
- `data/external/stockeasy/YYYY-MM-DD/snapshot.json` (optional)
- `data/features/YYYY-MM-DD/decision-features.json`
- `data/normalized/YYYY-MM-DD/kis_etf.normalized.json`
- `data/normalized/YYYY-MM-DD/technical.normalized.json`
- `data/normalized/YYYY-MM-DD/stockeasy.normalized.json` (optional)
- `data/portfolio/latest.json`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`
- `data/analysis-state/YYYY-MM-DD/rotation-watch.json`
- `data/stock-pulse/YYYY-MM-DD/stock-pulse.json`

## Outputs

- `data/stockpilot-proof/YYYY-MM-DD/account-direction-proof.json`
- `data/stockpilot-proof/latest-account-direction-proof.json`
- `reports/daily/YYYY-MM-DD-stockpilot-proof.md`
- `data/stockpilot-proof/YYYY-MM-DD/account-direction-proof-independent.json`
- `data/stockpilot-proof/latest-account-direction-proof-independent.json`
- `reports/daily/YYYY-MM-DD-stockpilot-proof-independent.md`
- Dashboard route: `/stockpilot-proof`

## Radar Modes

### `hybrid_with_stockeasy`

기본 모드다. StockEasy 캡처/정규화 데이터가 있으면 함께 사용한다. 그래도 최종 판정은 KIS 계좌, Stage4, decision features, 기술 점수와 결합해서 만든다.

```bash
npm run features:stockpilot-proof -- --date 2026-05-08
```

### `ecoreport_independent`

StockEasy가 전혀 없다고 가정하는 비상/독립 모드다. `--ignore-stockeasy`를 주면 StockEasy raw/normalized/dashboard pulse를 의도적으로 무시한다.

```bash
npm run features:stockpilot-proof:independent -- --date 2026-05-08
```

또는:

```bash
npm run features:stockpilot-proof -- --date 2026-05-08 --ignore-stockeasy
```

## Current Scoring

계좌별 proof score는 다음 축을 섞는다.

- Stage4 계좌 점수
- 교차 소스 근거 강도
- 자체 레이더와 실제 보유 노출의 겹침
- 보호, 감량, 매수제외 플래그

판정은 `방향성 증명`, `조건부 증명`, `보류 검증`, `방향성 반박`으로 나뉜다.

## Run

```bash
npm run features:stockpilot-proof -- --date 2026-05-08
```

날짜를 생략하면 최신 대시보드 날짜를 사용한다.

```bash
npm run features:stockpilot-proof
```

## Product Boundary

이 기능은 StockEasy의 비공개 API를 호출하거나 화면을 그대로 복제하지 않는다. 우리가 소유하거나 공개적으로 관찰한 데이터, KIS 계좌, EcoReport 파이프라인 산출물로 같은 투자 판단 범주의 문제를 독립적으로 푼다.

## Failover Rule

운영 판단은 기본적으로 `latest-account-direction-proof.json`을 본다. 이 파일이 없으면 대시보드는 `latest-account-direction-proof-independent.json`로 자동 후퇴한다.

StockEasy 수집 실패 시에도 일일 파이프라인에서 최소 아래 명령은 성공해야 한다.

```bash
npm run features:stockpilot-proof:independent -- --date YYYY-MM-DD
```
