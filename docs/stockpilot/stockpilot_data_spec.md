# StockPilot 데이터 아키텍처 & 출처 명세서

- 문서 버전: `1.0`
- 페어 문서: `stockpilot_agent_brief.md`
- 범위: 입력 데이터 계약을 충족하기 위한 데이터 소스, 스키마, 파이프라인 설계

## 0. 설계 원칙

1. 원천 데이터는 최소 단위로 저장한다.
2. 핵심 필드는 primary + fallback을 둔다.
3. KR/US 데이터 소스는 분리해 추상화 계층에서 통합한다.
4. 무료 우선, 유료는 선택적이다.
5. 과거 재계산 시 `as-of correctness`를 지킨다.

## 1. API 프로바이더 레지스트리

| ID | 프로바이더 | 역할 | 시장 | 인증 | 비용 |
|---|---|---|---|---|---|
| `P1` | Open DART | 재무제표·공시 | KR | API Key | 무료 |
| `P2` | KIS Developers | 실시간/일/분 OHLCV, 주문 | KR | OAuth2 | 무료 |
| `P3` | pykrx | 일 OHLCV, 지수, 공매도 | KR | 없음 | 무료 |
| `P4` | ECOS | 기준금리·환율·매크로 | KR | API Key | 무료 |
| `P5` | FRED | VIX, T10Y2Y 등 미국 매크로 | US | API Key | 무료 |
| `P6` | SEC EDGAR | 미국 재무제표 | US | User-Agent | 무료 |
| `P7` | yfinance / Yahoo | 일·분 OHLCV, 지수 | KR/US | 없음 | 무료 |
| `P8` | Alpha Vantage | 백업 OHLCV | KR/US | API Key | 유/무료 |
| `P9` | Polygon | 프리미엄 OHLCV | US | API Key | 유료 |
| `P10` | Finnhub | 실적 캘린더, 뉴스 | KR/US | API Key | 유/무료 |
| `P11` | CBOE | VIX 원본 | US | 없음 | 무료 |

권장 최소 스택:

- KR: `P1 + P2 + P3 + P4 + P5`
- US: `P5 + P6 + P7`
- 통합: `P1 + P2 + P3 + P4 + P5 + P6 + P7 + P10`

## 2. 필드 -> 출처 매핑

### 2.1 메타

| 필드 | KR primary | US primary | 비고 |
|---|---|---|---|
| `ticker` | P2/P3 종목 마스터 | P7 Ticker | `.KS`, `.KQ` 규약 |
| `name`, `asset_class`, `exchange` | KRX 상장사 리스트 | EDGAR company tickers | |
| `benchmark` | `^KS11`, `^KQ11` | `^GSPC`, `^IXIC` | 명시 매핑 |

### 2.2 가격·거래량

| 필드 | KR primary | KR fallback | US primary | US fallback | 방식 |
|---|---|---|---|---|---|
| `close` | P2 | P3 | P7 | P8/P9 | 원천 |
| `close_252d` | P2 | P3 | P7 | P8/P9 | 원천 |
| `ma_20/60/120` | - | - | - | - | 로컬 계산 |
| `ha_open`, `ha_close` | - | - | - | - | 로컬 계산 |
| `volume_current` | P2/P3 | P3 | P7 | P8/P9 | 원천 |
| `volume_ma_20` | - | - | - | - | 로컬 계산 |

### 2.3 특수 채널·일목·오실레이터

| 필드 | 데이터 요구 | 산출 |
|---|---|---|
| `keltner_upper/lower` | 일 OHLCV | EMA20 ± 2×ATR20 |
| `senkou_span_a/b` | 일 OHLC | 일목균형표 표준식 |
| `adx_14` | 일 OHLC | Wilder smoothing |
| `stoch_k_14/d_14` | 일 OHLC | 표준 스토캐스틱 |
| `rsi_14` | 일 close | 로컬 계산 |
| `vwap_anchored` | 분봉 + 앵커일 | 이벤트 기반 VWAP |
| `poc_price_120d` | 분봉 또는 일봉 | 거래량 프로파일 |
| `price_drop_ratio`, `rsi_rise_value` | 일 close 90일+ | 로컬 저점 탐지 |

### 2.4 매크로

| 필드 | Primary | Fallback |
|---|---|---|
| `vix_close` | FRED `VIXCLS` | Yahoo `^VIX` |
| `yield_spread_10y_2y` | FRED `T10Y2Y` | `DGS10 - DGS2` |

### 2.5 상대강도

```text
rs_vs_kospi = (close/close_window - 1) - (benchmark_close/benchmark_close_window - 1)
```

기본 창은 `63거래일`.

## 3. 데이터 파이프라인 계층

```text
External APIs -> Bronze (Raw) -> Silver (Derived) -> Gold (Scored)
```

- Bronze
  - `ohlcv_daily`
  - `ohlcv_intraday`
  - `fundamentals_quarterly`
  - `macro_daily`
  - `corp_events`
- Silver
  - `technical_indicators_daily`
- Gold
  - `scores_daily`

## 4. 스토리지 스키마

### 4.1 Bronze

```sql
CREATE TABLE stocks_master (
    ticker VARCHAR(20) PRIMARY KEY,
    name TEXT NOT NULL,
    asset_class VARCHAR(16) NOT NULL,
    exchange VARCHAR(16),
    benchmark VARCHAR(20) NOT NULL,
    sector TEXT,
    listed_date DATE,
    is_active BOOLEAN DEFAULT TRUE,
    source VARCHAR(16),
    updated_at TIMESTAMPTZ
);

CREATE TABLE ohlcv_daily (
    ticker VARCHAR(20) NOT NULL,
    date DATE NOT NULL,
    open NUMERIC(18,6),
    high NUMERIC(18,6),
    low NUMERIC(18,6),
    close NUMERIC(18,6),
    adj_close NUMERIC(18,6),
    volume BIGINT,
    source VARCHAR(16),
    ingested_at TIMESTAMPTZ,
    PRIMARY KEY (ticker, date)
);

CREATE TABLE ohlcv_intraday (
    ticker VARCHAR(20) NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    interval_sec INT NOT NULL,
    open NUMERIC(18,6),
    high NUMERIC(18,6),
    low NUMERIC(18,6),
    close NUMERIC(18,6),
    volume BIGINT,
    PRIMARY KEY (ticker, ts, interval_sec)
);

CREATE TABLE fundamentals_quarterly (
    ticker VARCHAR(20) NOT NULL,
    period_end DATE NOT NULL,
    fiscal_year INT,
    fiscal_quarter INT,
    revenue NUMERIC(24,2),
    op_income NUMERIC(24,2),
    net_income NUMERIC(24,2),
    fcf NUMERIC(24,2),
    eps NUMERIC(12,4),
    report_date DATE,
    rcept_no VARCHAR(32),
    source VARCHAR(16),
    PRIMARY KEY (ticker, period_end)
);

CREATE TABLE macro_daily (
    date DATE PRIMARY KEY,
    vix_close NUMERIC(10,4),
    yield_spread_10y_2y NUMERIC(8,4),
    dgs10 NUMERIC(8,4),
    dgs2 NUMERIC(8,4),
    usd_krw NUMERIC(10,4),
    kr_base_rate NUMERIC(6,4),
    fed_funds_rate NUMERIC(6,4)
);

CREATE TABLE corp_events (
    ticker VARCHAR(20) NOT NULL,
    event_date DATE NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    detail JSONB,
    source VARCHAR(16),
    PRIMARY KEY (ticker, event_date, event_type)
);
```

### 4.2 Silver

```sql
CREATE TABLE technical_indicators_daily (
    ticker VARCHAR(20) NOT NULL,
    date DATE NOT NULL,
    ma_20 NUMERIC(18,6),
    ma_60 NUMERIC(18,6),
    ma_120 NUMERIC(18,6),
    ha_open NUMERIC(18,6),
    ha_close NUMERIC(18,6),
    volume_ma_20 NUMERIC(18,2),
    keltner_upper NUMERIC(18,6),
    keltner_lower NUMERIC(18,6),
    senkou_span_a NUMERIC(18,6),
    senkou_span_b NUMERIC(18,6),
    adx_14 NUMERIC(10,4),
    rsi_14 NUMERIC(10,4),
    stoch_k_14 NUMERIC(10,4),
    stoch_d_14 NUMERIC(10,4),
    poc_price_120d NUMERIC(18,6),
    vwap_anchored NUMERIC(18,6),
    vwap_anchor_date DATE,
    price_drop_ratio NUMERIC(10,6),
    rsi_rise_value NUMERIC(10,4),
    rs_vs_benchmark NUMERIC(10,6),
    benchmark_used VARCHAR(20),
    PRIMARY KEY (ticker, date)
);
```

### 4.3 Gold

```sql
CREATE TABLE scores_daily (
    ticker VARCHAR(20) NOT NULL,
    as_of_date DATE NOT NULL,
    schema_version VARCHAR(8) DEFAULT '1.0',
    filter_score SMALLINT NOT NULL,
    stage2_score NUMERIC(5,2),
    stage3_score NUMERIC(5,2),
    stage4_score NUMERIC(5,2),
    final_score NUMERIC(5,1) NOT NULL,
    factors JSONB,
    gates JSONB,
    data_quality_flags JSONB,
    commentary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (ticker, as_of_date)
);
```

## 5. 갱신 주기

| 데이터셋 | 주기 | 실행 시점 | 의존성 |
|---|---|---|---|
| `ohlcv_daily (KR)` | 일 1회 | 16:30 KST | P2/P3 |
| `ohlcv_daily (US)` | 일 1회 | 다음날 07:00 KST | P7/P8 |
| `ohlcv_intraday` | 상시 | 장중 | P2/P8/P9 |
| `macro_daily` | 일 1회 | 08:00 KST | P5/P4 |
| `corp_events` | 주 1회 + 당일 | 18:00 KST | P1/P10 |
| `fundamentals_quarterly` | 이벤트 드리븐 | 공시 시점 | P1/P6 |
| `technical_indicators_daily` | 일 1회 | Bronze 후 | Bronze |
| `scores_daily` | 일 1회 | Silver 후 | Silver |

## 6. 인증·레이트리밋·비용

핵심 요약:

- `DART`: 무료, XBRL 파싱 필요
- `KIS`: 무료, `20 req/s` 엄격
- `pykrx`: 무료, 과도 호출 시 차단 위험
- `FRED`: 무료, 안정적
- `EDGAR`: `User-Agent` 필수
- `yfinance`: production primary로는 부적합, fallback 권장

## 7. 폴백 & 데이터 품질

### 7.1 장애 복원

| 장애 | 대체 | 수준 |
|---|---|---|
| KIS 일봉 실패 | pykrx | 동등 |
| FRED VIX 실패 | Yahoo `^VIX` | 허용 |
| FRED T10Y2Y 실패 | `DGS10 - DGS2` | 동등 |
| Yahoo 실패 | Alpha Vantage | 지연 |
| DART 실적 미취합 | EDGAR 또는 skip | 보수 처리 |

### 7.2 DQ 게이트

| 체크 | 임계 | 실패 시 |
|---|---|---|
| OHLCV 결측 | 최근 5영업일 중 1일 이상 | 해당 종목 skip |
| 가격 점프 | 일일 ±50% 초과 | 경고 + 수동 검토 |
| 거래량 0 | 3일 연속 | 정지/상폐 후보 플래그 |
| 매크로 결측 | `vix_close` 또는 `yield_spread_10y_2y` null | `Filter_Score = 0` |
| 시간대 오정렬 | KR/US 날짜 혼입 | 조인 규칙 재검토 |

### 7.3 시간대 원칙

- 저장 타임스탬프는 UTC
- `date`는 거래소 로컬 거래일 기준
- `macro_daily.date`는 기본 US 기준

## 8. 초기 셋업 체크리스트

- [ ] DART API Key 발급
- [ ] KIS 앱 등록 및 자격증명 획득
- [ ] FRED API Key 발급
- [ ] ECOS API Key 발급
- [ ] 선택형 외부 키 발급
- [ ] Postgres 또는 DuckDB 준비
- [ ] 오케스트레이터 설정
- [ ] `stocks_master` 시드 적재
- [ ] 2년 이상 backfill
- [ ] Silver dry-run 검증
- [ ] Gold 연결
- [ ] DQ 대시보드 연결

## 9. 환경 변수 템플릿

```dotenv
# Korea
DART_API_KEY=
KIS_APP_KEY=
KIS_APP_SECRET=
KIS_ACCOUNT_NO=
KIS_MODE=PROD

# Global Macro
FRED_API_KEY=
ECOS_API_KEY=

# Optional
ALPHAVANTAGE_API_KEY=
POLYGON_API_KEY=
FINNHUB_API_KEY=

# Storage
POSTGRES_DSN=postgresql://user:pass@host:5432/stockpilot
```

## 10. 문서 간 의존 관계

- 본 문서가 `technical_indicators_daily`, `macro_daily`, `stocks_master`를 정의
- `stockpilot_agent_brief.md`가 이 데이터를 입력으로 받아 수식을 적용
- 최종 결과는 `scores_daily`에 적재

## 변경 이력

| 버전 | 일자 | 변경 |
|---|---|---|
| `1.0` | `2026-04-17` | 초판 |
