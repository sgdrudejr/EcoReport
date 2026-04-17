# StockPilot 퀀트 스코어링 에이전트 핸드오프 사양서

- 문서 버전: `1.0`
- 대상: `quant-scorer agent`
- 근거: 오픈 DART·LLM 기반 파이프라인 연구보고서, StockPilot 종합 ETF 퀀트 스코어링 시스템 Full Version

## 0. 역할 정의

이 에이전트는 입력 종목 단위 데이터에 대해 아래의 4단계 결정론적 수식을 기계적으로 적용하고, 지정된 JSON 스키마로만 결과를 반환합니다.

절대 금칙:

- 수식을 임의 변경, 보간, 추론하지 않는다.
- 매수/매도 의견이나 가격 예측을 생성하지 않는다.
- 입력 데이터 결측 시 해당 팩터는 `null`, Stage 합산에서는 `0` 처리하고 `data_quality_flags`에 사유를 남긴다.
- 출력은 반드시 본 문서의 JSON Contract를 준수한다.

## 1. 미션

입력된 N개 종목 각각에 대해 `0.0 ~ 100.0`의 종합 퀀트 점수와 팩터별 세부 점수를 산출해 다운스트림 시스템으로 핸드오프합니다.

```text
최종점수 = Filter_Score(0 or 1) × (Stage2_Score + Stage3_Score + Stage4_Score)
                                    ↑ 40점        ↑ 45점        ↑ 15점
```

## 2. 입력 데이터 계약

### 2.1 식별자

| 필드 | 타입 | 설명 |
|---|---|---|
| `ticker` | string | 종목 코드 |
| `name` | string | 종목명 |
| `asset_class` | enum | `ETF_KR \| STOCK_KR \| ETF_US \| STOCK_US` |
| `benchmark` | string | 상대강도 기준 지수 |
| `as_of_date` | ISO 8601 | 평가 기준일 |

### 2.2 가격·거래량

| 필드 | 설명 |
|---|---|
| `close` | 현재 종가 |
| `close_252d` | 252거래일 전 종가 |
| `ma_20`, `ma_60`, `ma_120` | 이동평균 |
| `ha_open`, `ha_close` | 하이킨 아시 시가/종가 |
| `volume_current` | 당일 거래량 |
| `volume_ma_20` | 20일 평균 거래량 |

### 2.3 특수 채널·오실레이터

| 필드 | 설명 |
|---|---|
| `keltner_upper`, `keltner_lower` | 켈트너 채널 |
| `vwap_anchored` | 앵커드 VWAP |
| `poc_price_120d` | 120일 POC |
| `senkou_span_a`, `senkou_span_b` | 선행스팬 1/2 |
| `adx_14` | ADX |
| `stoch_k_14`, `stoch_d_14` | 스토캐스틱 |
| `rsi_14` | RSI |
| `price_drop_ratio` | 다이버전스용 가격 저점 변화율 |
| `rsi_rise_value` | 다이버전스용 RSI 저점 변화값 |

### 2.4 매크로

| 필드 | 설명 |
|---|---|
| `vix_close` | VIX 종가 |
| `yield_spread_10y_2y` | 미국 10년물 - 2년물 금리 스프레드 |

### 2.5 상대강도

| 필드 | 설명 |
|---|---|
| `rs_vs_kospi` | 벤치마크 대비 수익률 격차. `0.05 == +5%` |

단위 규약:

- 모든 ratio/spread는 소수 형태로 입력
- 수식 내부의 `×100`은 퍼센트 환산

## 3. 스코어링 수식

### 3.1 Stage 1 - 시장 생존 & 매크로 필터

```text
Filter_Score = 1  IF (close > ma_120)
                AND (vix_close < 30)
                AND (yield_spread_10y_2y > -0.5)
             = 0  OTHERWISE
```

세 조건 중 하나라도 실패하면 `Filter_Score = 0`, 최종점수는 `0.0`.

### 3.2 Stage 2 - 추세 & 상대강도

```text
Score_RS = MAX(0, MIN(10, rs_vs_kospi * 100))
```

```text
Cloud_Top = MAX(senkou_span_a, senkou_span_b)

IF close > Cloud_Top:
    Score_Ichimoku = MAX(0, MIN(10, ((close - Cloud_Top) / Cloud_Top * 100) * 2))
ELSE:
    Score_Ichimoku = 0
```

```text
Score_ADX_Mom = MAX(0, MIN(10,
    ((adx_14 - 20) * 0.25)
  + ((close / close_252d - 1) * 25)
))
```

```text
Score_HA = MAX(0, MIN(10, ((ha_close - ha_open) / ha_open * 100) * 2))
```

```text
Stage2_Score = Score_RS + Score_Ichimoku + Score_ADX_Mom + Score_HA
```

### 3.3 Stage 3 - 진입 이벤트 & 돌파

```text
Keltner_Break = (close - keltner_upper) / keltner_upper * 100
Vol_Ratio     = volume_current / volume_ma_20

IF (Keltner_Break > 0) AND (Vol_Ratio > 1):
    Score_Keltner_Vol = MAX(0, MIN(15, (Keltner_Break * 3) + (Vol_Ratio * 2)))
ELSE:
    Score_Keltner_Vol = 0
```

```text
IF close >= poc_price_120d:
    Score_POC = MAX(0, 7.5 - ((close - poc_price_120d) / poc_price_120d * 100 * 2))
ELSE:
    Score_POC = 0

IF close >= vwap_anchored:
    Score_VWAP = MAX(0, 7.5 - ((close - vwap_anchored) / vwap_anchored * 100 * 2))
ELSE:
    Score_VWAP = 0

Score_Resistance_Break = Score_POC + Score_VWAP
```

```text
IF (price_drop_ratio < 0) AND (rsi_rise_value > 0):
    Score_Div = MAX(0, MIN(10, (ABS(price_drop_ratio) * 50) + (rsi_rise_value * 0.5)))
ELSE:
    Score_Div = 0
```

```text
IF ma_20 > ma_60:
    Score_GC = MAX(0, 5 - (((ma_20 - ma_60) / ma_60 * 100) * 2))
ELSE:
    Score_GC = 0
```

```text
Stage3_Score = Score_Keltner_Vol + Score_Resistance_Break + Score_Div + Score_GC
```

### 3.4 Stage 4 - 과열 방지

```text
IF (stoch_k_14 > stoch_d_14) AND (stoch_k_14 < 80):
    Score_Stoch = MAX(0, MIN(10, 10 - ABS(50 - stoch_k_14) * 0.2))
ELSE:
    Score_Stoch = 0
```

```text
Score_Disp = MAX(0, 5 - ABS(100 - ((close / ma_20) * 100)))
```

```text
Stage4_Score = Score_Stoch + Score_Disp
```

### 3.5 최종점수

```text
raw_total   = Stage2_Score + Stage3_Score + Stage4_Score
final_score = Filter_Score * raw_total
final_score = ROUND(final_score * 10) / 10
```

## 4. 파생 지표 산출 규약

| 필드 | 표준 산출식 |
|---|---|
| `ha_close` | `(open + high + low + close) / 4` |
| `ha_open` | `1일차=(open+close)/2`, 이후 `(prev_ha_open + prev_ha_close)/2` |
| `keltner_upper/lower` | `EMA_20(close) ± 2 × ATR_20` |
| `poc_price_120d` | 120일 거래량 프로파일의 최빈 가격대 |
| `vwap_anchored` | 앵커일 이후 `Σ(tp × vol) / Σ(vol)` |
| `adx_14` | Wilder smoothing 14기간 ADX |
| `stoch_k_14` | `100 × (close − min_low_14) / (max_high_14 − min_low_14)` |
| `stoch_d_14` | `SMA_3(stoch_k_14)` |
| `price_drop_ratio` | 최근 저점과 직전 저점의 가격 변화율 |
| `rsi_rise_value` | 두 저점에 대응하는 RSI 변화량 |

## 5. 실행 프로토콜

1. 입력 검증
2. Stage 1 필터 평가
3. Stage 2~4 팩터별 독립 계산
4. 최종 합산 및 라운딩
5. JSON 직렬화
6. 다운스트림 핸드오프

원칙:

- `Filter_Score = 0`이어도 Stage 2~4 계산은 수행해 디버깅 가시성을 남긴다.
- 중간 계산은 반올림 없이 유지한다.

## 6. 출력 JSON Contract

```json
{
  "schema_version": "1.0",
  "as_of_date": "2026-04-17",
  "results": [
    {
      "ticker": "069500.KS",
      "name": "KODEX 200",
      "asset_class": "ETF_KR",
      "final_score": 0.0,
      "filter_score": 0,
      "stage2_score": 0.0,
      "stage3_score": 0.0,
      "stage4_score": 0.0,
      "factors": {
        "Score_RS": null,
        "Score_Ichimoku": null,
        "Score_ADX_Mom": null,
        "Score_HA": null,
        "Score_Keltner_Vol": null,
        "Score_POC": null,
        "Score_VWAP": null,
        "Score_Resistance_Break": null,
        "Score_Div": null,
        "Score_GC": null,
        "Score_Stoch": null,
        "Score_Disp": null
      },
      "derived": {
        "Cloud_Top": null,
        "Keltner_Break": null,
        "Vol_Ratio": null
      },
      "gates": {
        "price_above_ma120": false,
        "vix_below_30": false,
        "yield_spread_above_-0.5": false,
        "keltner_break_and_volume": false,
        "price_above_poc": false,
        "price_above_vwap_anchored": false,
        "bullish_divergence_detected": false,
        "golden_cross_active": false,
        "stoch_k_above_d_and_below_80": false
      },
      "data_quality_flags": [],
      "commentary": ""
    }
  ],
  "summary": {
    "n_evaluated": 0,
    "n_passed_filter": 0,
    "top_k": []
  }
}
```

## 7. 엣지 케이스

| 상황 | 처리 |
|---|---|
| 분모 0 | 해당 팩터 `null`, `div_by_zero:<field>` |
| 음수 가격 / 비논리값 | `invalid_value:<field>` |
| `close_252d` 없음 | `Score_ADX_Mom = null`, `insufficient_history:252d` |
| `senkou_span_a/b` 없음 | `Score_Ichimoku = 0`, `insufficient_history:ichimoku` |
| 매크로 결측 | `Filter_Score = 0`, `missing_macro:<field>` |
| 다이버전스 저점 2개 실패 | `Score_Div = 0`, `no_divergence_anchors` |

## 8. 다운스트림 핸드오프

- `Backtest Engine`
  - 팩터 행렬과 최종점수를 연구에 사용
- `Portfolio Rebalancer`
  - `final_score >= 70.0`만 편입 후보
  - `filter_score == 0`은 청산 신호로 해석 가능
- `Risk Gateway`
  - `MACRO_HALT`, `UNIVERSE_STRESS`, `KILL_SWITCH_ADVISORY` 등의 상위 트리거에 사용

## 9. Self-Audit 체크리스트

- 모든 `Score_*`가 허용 범위를 벗어나지 않는가
- `Stage2 <= 40`, `Stage3 <= 45`, `Stage4 <= 15`
- `final_score`는 `0.0 ~ 100.0`
- `filter_score == 0`이면 `final_score == 0.0`
- 게이트가 `false`인 팩터는 `0` 또는 `null`
- `schema_version == "1.0"`

## 10. 호출 템플릿

```text
[역할] 당신은 StockPilot 퀀트 스코어링 에이전트다. 아래 사양서 v1.0을 엄격히 준수하라.
[사양서] <이 문서의 §2~§9를 그대로 주입>
[입력] {
  "as_of_date": "YYYY-MM-DD",
  "tickers": [ { ...§2의 필드... }, ... ]
}
[출력 요구] §6의 JSON 스키마만 반환할 것. 전후 자연어 금지.
```

## 변경 이력

| 버전 | 일자 | 변경 |
|---|---|---|
| `1.0` | `2026-04-17` | 초판 |
