# StockEasy 3전략 스타일 비교 (2026-04-18)

## 커버리지

- 기준 윈도우: `min-date=2025-12-01`
- Momentum: 매수 53/53, 매도 30/30, 유니버스 53
- Peak: 매수 50/50, 매도 30/30, 유니버스 50
- Value: 매수 11/11, 매도 3/3, 유니버스 11
- 매크로 커버리지: `2025-12-01 ~ 2026-04-17` (FRED 백필 완료)

## 매수 스타일 비교

### 1) Momentum (1호)

- 상대적으로 강한 팩터: `Score_HA`, `Score_Ichimoku`, `Score_RS`
- 게이트 특징: `price_above_vwap_anchored`가 비매수군 대비 높음(`+0.301`)
- 시사점: 전형적인 추세 확인형(양봉/구름대/상대강도) + VWAP 상단 유지

### 2) Peak (2호)

- 상대적으로 강한 팩터: `Score_Keltner_Vol`, `Score_HA`, `Score_RS`, `Score_Ichimoku`
- 게이트 차이: `keltner_break_and_volume`가 비매수군 대비 크게 높음(`+0.616`)
- 시사점: 3전략 중 돌파형 성향이 가장 선명

### 3) Value (3호)

- 상대적으로 강한 팩터: `Score_Div`, `Score_VWAP`, `Score_ADX_Mom`, `Score_Resistance_Break`, `Score_GC`
- 게이트 특징: `price_above_poc`, `price_above_vwap_anchored`는 양수, `keltner_break_and_volume`는 음수
- 시사점: 이름은 Value지만 실제 체결 패턴은 "추세 + 접근성(저항/평균단가) + 타점 보정" 혼합형에 가까움

## 공통 인사이트

- 공통 강점: `Score_HA`는 Momentum/Peak에서 반복적으로 유효
- 전략 분화:
  - Peak: `Score_Keltner_Vol` 중심 돌파형
  - Value: `Score_Div`/`Score_VWAP`/`Score_Resistance_Break` 중심 타점/접근성형
- 주의점: `Score_Disp`가 Momentum/Peak에서 음의 효과를 보여, 강한 추세장에서는 "20일선 근접" 선호가 오히려 약할 수 있음

## 수식 업데이트 반영 (v1.3)

- `Score_Keltner_Vol` 가중치 상향 (`3,2 -> 3.5,2.5`)
- `Score_Div`를 추세 레짐형 RSI 점수로 재정의 (`45~68` 우대)
- `Score_Stoch` 완화 (`80~90`에서도 약한 가점 허용)

## 다음 액션

- [완료] FRED 코어 매크로 백필 (`2025-12-01 ~ 2026-04-17`)
- [완료] 3전략 동일 윈도우 재추정
- 제안: 다음 튜닝(v1.4)은 `Score_Disp` 구조를 추세/돌파 레짐에 맞게 완화 또는 가중치 하향 검토
