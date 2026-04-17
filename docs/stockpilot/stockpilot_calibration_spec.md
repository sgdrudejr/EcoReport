# StockPilot 점수 캘리브레이션 & 진화 레이어 사양서

**문서 버전:** 1.0 · **유형:** Cross-cutting Extension  
**페어 문서:** agent_brief v1.0, data_spec v1.0, gap_analysis v1.0, master_playbook v1.0  
**목적:** (A) 낮은 점수가 "시장 탓인지 모델 탓인지" 구분하는 진단 도구 제공 (B) 시간이 지남에 따라 점수 체계가 자가 보정되는 메커니즘 정의

---

## 0. 문제 정의

### 0.1 관찰된 현상
v1.0 스코어러를 처음 가동하면 **전 종목의 점수가 일제히 낮게** 나오는 경우가 빈번하다.

### 0.2 가능한 원인 4종

| # | 원인 | 모델이 문제? | 시장이 문제? |
|---|---|---|---|
| A | Filter_Score 게이트가 걸림 (VIX·금리·장기추세) | ❌ | ✅ |
| B | Stage 3 "접근성" 점수 구조의 특성 (이격 벌어짐) | ⚠ 설계 반영 | ✅ |
| C | 절대 점수 임계값이 현 레짐과 불일치 | ✅ | — |
| D | 유니버스 편향 (섹터·사이즈 쏠림) | ✅ | — |

### 0.3 v1.0의 구조적 결함
**A/B/C/D를 구분할 도구가 없다.** 사용자는 "낮은 점수"만 보고 섣불리 임계값을 낮추거나 가중치를 바꾸게 됨 → 과최적화·알파 소실.

### 0.4 본 레이어의 미션
1. **진단 (Diagnostic)**: 낮은 점수의 원인을 즉시 표시
2. **상대화 (Relativization)**: 절대 점수 + 레짐/유니버스 대비 백분위 병기
3. **적응 (Adaptation)**: 과거 데이터와 실현 수익률로 점수 분포·팩터 가중을 점진적 보정
4. **의사결정 (Decision Aid)**: 사용자가 "70점 문턱"이 아닌 "현 시장에서 상위 10%"로 판단하게 함

---

## 1. 이중 점수 출력 (Dual Scoring Output)

### 1.1 원칙
**Raw score는 절대 건드리지 않는다.** 기존 v1.0 수식을 유지한 채, 그 위에 **해석 레이어**를 얹는다.

### 1.2 출력 스키마 확장

```json
{
  "ticker": "069500.KS",
  "final_score": 42.3,
  "calibration": {
    "percentile_universe": 87.2,
    "percentile_regime_90d": 72.5,
    "percentile_regime_1y": 68.0,
    "z_score_universe": 1.42,
    "regime": "RANGE",
    "interpretation": "above_average_for_range_regime",
    "dynamic_threshold": 38.5,
    "passes_dynamic_threshold": true
  },
  "diagnostics": {
    "filter_gate_status": "passed",
    "dominant_stage": "stage2",
    "dominant_factor": "Score_ADX_Mom",
    "suppressor_factors": ["Score_Stoch", "Score_POC"],
    "universe_context": {
      "mean_score_today": 28.4,
      "median_score_today": 25.1,
      "passing_filter_ratio": 0.34
    }
  }
}
```

### 1.3 해석 태그 규칙

| 조건 | 태그 |
|---|---|
| `percentile_universe ≥ 95` | `"top_tier"` |
| `percentile_universe ≥ 80` | `"above_average_for_{regime}_regime"` |
| `percentile_universe ≥ 50` | `"typical_for_{regime}_regime"` |
| `percentile_universe < 50` | `"below_average_for_{regime}_regime"` |
| `filter_gate_status != "passed"` | `"blocked_by_{reason}"` |

---

## 2. 진단 도구: "왜 이 점수인가?"

### 2.1 진단 우선순위 트리

```
Step 1. Filter_Score == 0?
   → YES: "시장 문제" (원인 A). 현재 유니버스 통과율 표시.
   → NO: Step 2로.

Step 2. percentile_universe ≥ 80?
   → YES: 점수는 낮아 보여도 유니버스 내에서는 상위.
   → NO: Step 3로.

Step 3. 동일 레짐 과거 1년 평균 대비 현재 전체 유니버스 평균이 10점 이상 낮은가?
   → YES: "시장 전반 약세 국면" (원인 B 가능성 높음).
   → NO: Step 4로.

Step 4. dominant_suppressor_factor를 제시.
```

### 2.2 유니버스 레벨 일일 진단 리포트

```
==========================
Daily Calibration Report
Date: 2026-04-17
==========================
유니버스 크기: 500
Filter 통과: 172 (34.4%)
평균 final_score: 28.4  /  중간값: 25.1
상위 15% 임계(동적): 38.5
절대 70점 이상 종목 수: 3 (0.6%)

현 레짐: RANGE (2026-02-14 이후 62일째)
동일 레짐 1년 평균 점수: 31.2 (현재 28.4는 정상 범위 -1σ 이내)

권고: 오늘 전반적 저점수는 RANGE 레짐의 전형적 양상.
신규 진입은 percentile_universe ≥ 85 또는 dominant_factor가 Stage3인 종목에 한정.
```

---

## 3. 백테스트 주도 초기 캘리브레이션

### 3.1 목적
"상위 15%"가 의미를 가지려면 **과거 점수 분포**가 필요. 운영 1일차부터 상대 비교가 가능하게 웜업.

### 3.2 웜업 절차
v1.1 스코어러 배포 직전 1회 실행:
1. 과거 10년 일별 스코어링
2. 레짐 라벨링
3. 분포 통계 저장 → `score_distribution_stats`

### 3.3 저장 테이블 스키마

```sql
CREATE TABLE score_distribution_stats (
    stat_date           DATE NOT NULL,
    regime              VARCHAR(16) NOT NULL,
    universe_key        VARCHAR(32) NOT NULL,
    mean_score          NUMERIC(5,2),
    median_score        NUMERIC(5,2),
    std_score           NUMERIC(5,2),
    p10                 NUMERIC(5,2),
    p25                 NUMERIC(5,2),
    p50                 NUMERIC(5,2),
    p75                 NUMERIC(5,2),
    p85                 NUMERIC(5,2),
    p90                 NUMERIC(5,2),
    p95                 NUMERIC(5,2),
    n_observations      INT,
    filter_pass_rate    NUMERIC(5,4),
    PRIMARY KEY (stat_date, regime, universe_key)
);
```

### 3.4 일일 갱신
- 매일 스코어링 직후 당일 유니버스 분포 한 행 추가
- 90일 롤링으로 `percentile_regime_90d` 계산
- 1년 롤링으로 `percentile_regime_1y` 계산

---

## 4. 동적 임계값

### 4.1 3가지 모드

| 모드 | 정의 | 언제 쓰나 |
|---|---|---|
| `absolute` | `final_score >= 70` | v1.0 기본, 해석 가능성↑ |
| `percentile_universe` | `percentile_universe >= 85` | 일관된 상위 15% 확보 |
| `hybrid` | `final_score >= 60 AND percentile_universe >= 80` | **권장 기본값** |

### 4.2 config 추가

```yaml
# config/params.yaml
decision:
  threshold_mode: hybrid
  absolute_threshold: 60.0
  percentile_threshold: 80.0
  min_passing_filter_ratio: 0.20   # Filter 통과율 < 20%면 신규 진입 중단
```

### 4.3 모드 변경 시 규칙
- Git commit + ADR 필수
- 변경 후 최소 30일 shadow 모드로 비교 지표 생성

---

## 5. 팩터 효능 모니터링

### 5.1 추적 지표: Information Coefficient (IC)

```
IC_factor_i(t) = Spearman(Score_i(t-20), forward_return_20d(t))
```

- Rolling window: **120일**
- Horizon: **20거래일 수익률**

### 5.2 저장 테이블

```sql
CREATE TABLE factor_efficacy_daily (
    date                DATE NOT NULL,
    factor_name         VARCHAR(32) NOT NULL,
    ic_20d              NUMERIC(8,4),
    ic_t_stat           NUMERIC(8,4),
    ic_120d_mean        NUMERIC(8,4),
    ic_120d_std         NUMERIC(8,4),
    hit_rate            NUMERIC(5,4),
    turnover            NUMERIC(8,4),
    decay_flag          BOOLEAN,
    PRIMARY KEY (date, factor_name)
);
```

### 5.3 알파 소실 감지 규칙

`decay_flag = TRUE` 조건:
- 최근 60일 평균 IC < 과거 1년 평균 IC − 2σ
- AND 최근 60일 hit_rate < 45%
- AND 최근 60일 IC t-stat < 1.0

### 5.4 대응 프로토콜

```
1. 자동 대응 (shadow mode):
   - 감쇠 계수 = 1 - days_since_decay_flag / 90

2. 수동 리뷰:
   - ADR 필수 + 백테스트 재실행

3. 사양서 업데이트:
   - v1.x → v2.0 개정 시 공식 반영
```

---

## 6. 레짐 조건부 캘리브레이션

### 6.1 레짐별 권장 해석

| 레짐 | 평균 점수 수준 | 상위 10% 임계 | 해석 포인트 |
|---|---|---|---|
| TREND_UP | 45~55 | 70+ | 절대 점수 신뢰 가능 |
| RANGE | 25~35 | 42+ | 동적 임계값 필수 |
| TREND_DOWN | 10~20 | 28+ | 대부분 Filter로 차단 |
| CRISIS | 0~5 | 15+ | 전원 진입 금지 (참고용만) |

※ 위 수치는 웜업 후 실제 분포로 갱신되는 **초기 가이드**.

---

## 7. 베이지안 업데이트 (v2.1 이상, 선택)

```
prior:      w_i ~ Normal(μ_0, σ_0²)
evidence:   IC_i(t) observations
posterior:  w_i | evidence ~ Normal(μ_n, σ_n²)

업데이트:
  μ_n = (σ_0² × Σ IC / n + σ_IC² × μ_0) / (σ_0² + σ_IC²/n)
```

### 7.1 정기 재학습 스케줄

| 주기 | 대상 | 방식 |
|---|---|---|
| 일 | 분포 통계 롤링 | Rolling 갱신 |
| 주 | 팩터 IC | IC 계산 + decay_flag |
| 월 | 동적 임계값 재보정 | percentile 분포 재학습 |
| 분기 | 전체 가중 재학습 | 베이지안 갱신 |
| 년 | 스펙 v1.x → v1.(x+1) | ADR + Gate review |

---

## 8. 단계별 구현 로드맵

### Phase A: Percentile 오버레이 (1주, Quick Win — MVP 필수)

| Task | 산출물 | 시간 |
|---|---|---|
| A1. 웜업 배치 | 10년 historical score + `score_distribution_stats` 초기 적재 | 2일 |
| A2. 출력 스키마 확장 | `calibration` 블록 추가 | 1일 |
| A3. 진단 블록 구현 | `diagnostics` 자동 생성 로직 | 1일 |
| A4. 일일 리포트 템플릿 | §2.2 포맷 자동 발송 | 1일 |

**DoD**: 매일 리포트 수신 + 종목별 `percentile_universe` 출력 확인

### Phase B: 레짐 조건부 (2주)

| Task | 산출물 | 시간 |
|---|---|---|
| B1. Regime classifier | `src/regime/simple_rules.py` | 3일 |
| B2. `(date, regime)` 분포 분리 저장 | 스키마 변경 + 백필 | 2일 |
| B3. `percentile_regime_*` 가동 | 계산 로직 | 2일 |
| B4. 동적 임계값 `hybrid` 모드 배포 | config + 의사결정 룰 | 3일 |

### Phase C: 팩터 효능 모니터링 (4주)

| Task | 산출물 | 시간 |
|---|---|---|
| C1. Forward return 파이프라인 | 미래 수익률 백필 인프라 | 1주 |
| C2. IC 계산기 | `factor_efficacy_daily` 적재 | 1주 |
| C3. 알파 소실 감지기 | decay_flag 룰 + 알람 | 1주 |
| C4. 자동 감쇠 메커니즘 | shadow-mode 감쇠 | 1주 |

### Phase D: 베이지안 갱신 (4주+, 선택)
Phase 4 LLM/레짐 완료 후 검토.

---

## 9. 자주 하는 오해 (FAQ)

**Q1. 전 종목 점수가 5점 이하인데 모델이 고장났나?**  
A. Filter_Score 상태를 먼저 확인. `filter_gate_status == "blocked_vix"` 등이면 현 시장은 "진입 금지" 구간. 모델 정상.

**Q2. percentile 점수를 쓰면 약세장에서도 진입해야 하나?**  
A. 아니다. `min_passing_filter_ratio = 0.20` 설정으로 유니버스의 20% 이상이 Filter를 통과하지 못하면 신규 진입 전면 차단.

**Q3. 팩터 효능 감소 감지 시 바로 폐기하나?**  
A. 아니다. 자동으로는 감쇠(0으로 접근)만 한다. 완전 제거는 ADR + 월간 리뷰 + 백테스트 재검증 필요.

**Q4. 백테스트 없이도 이 레이어를 쓸 수 있나?**  
A. 불가. 웜업 없으면 percentile 기준점이 없음. 최소 6개월치 warm-up 필요.

---

## 10. 핵심 요약 (TL;DR)

1. **점수가 낮은 것은 대개 시장 탓** — 그러나 그걸 증명할 도구가 v1.0엔 없었음.
2. **본 레이어는 raw score를 바꾸지 않는다** — `calibration` + `diagnostics` 블록을 위에 덧붙임.
3. **Phase A (1주 투자)** 만으로도 진단 문제는 대부분 해결.
4. **Phase B~D** 는 시간이 지나며 점수가 스스로 보정되는 적응 엔진.
5. **70점 도그마를 버린다** — hybrid 모드 (raw ≥ 60 AND percentile ≥ 80) 기본 권장.

---

## 변경 이력

| 버전 | 일자 | 변경 |
|---|---|---|
| 1.0 | 2026-04-17 | 초판. "전 종목 저점수" 관찰에서 출발. 진단·상대화·적응 레이어 설계 |
