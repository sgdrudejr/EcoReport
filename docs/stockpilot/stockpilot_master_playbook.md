# StockPilot 마스터 실행 가이드

- 문서 버전: `1.1`
- 목적: `v1.0 -> v2.0`까지 자율 실행 가능한 단일 플레이북
- 페어 문서:
  - `stockpilot_agent_brief.md`
  - `stockpilot_data_spec.md`
  - `stockpilot_v1_gap_analysis.md`
  - `stockpilot_calibration_spec.md` ← v1.1 신규

## 0. 이 문서를 쓰는 법

### 0.1 구조

- 전체 일정은 `4개 Phase`
- 각 Task는 같은 템플릿을 따른다
  - 목표
  - 전제조건
  - 산출물
  - 실행 단계
  - 에이전트 프롬프트
  - 완료 기준
  - 검증
  - 예상 시간
- 각 Phase 말에는 Gate Review가 있다

### 0.2 사용 모드

| 모드 | 상황 | 방법 |
|---|---|---|
| `Solo mode` | 직접 구현 | Task 순서대로 실행 |
| `Agent-delegation mode` | 서브 에이전트 위임 | 프롬프트 블록 그대로 주입 |
| `Hybrid mode` | 에이전트 구현 후 본인 리뷰 | 프롬프트 + DoD 체크 |

### 0.3 절대 규칙

1. 순서를 지킨다.
2. `1 Task = 1 PR` 원칙을 지향한다.
3. ADR에 근거를 남긴다.
4. Gate 통과 전 다음 Phase로 넘어가지 않는다.

## 1. 산출물 맵

```text
docs/
  stockpilot_agent_brief.md
  stockpilot_data_spec.md
  stockpilot_v1_gap_analysis.md
  stockpilot_master_playbook.md
  adj_close_policy.md
  anchor_events_policy.md
  backtest_protocol.md
  risk_management_spec.md
  observability_spec.md
  paper_trading_protocol.md
  kr_macro_extension.md
  llm_factor_discovery_spec.md
  regime_detection_spec.md
config/
  params.yaml
  params.schema.json
  universe/*.csv
db/migrations/
tests/golden/
backtest/
src/
decisions/ADR-XXXX-*.md
```

## 2. 마스터 타임라인

| Phase | 목표 | 기간 | 완료 Gate |
|---|---|---|---|
| `Phase 1` | Hardening | 2주 | §3.8 |
| `Phase 2` | Proof | 5주 | §4.5 |
| `Phase 3` | Operationalize | 6주 | §5.5 |
| `Phase 4` | Evolution | 16주 | §6.5 |

총 예상 기간:

- 약 `29주` (캘리브레이션 레이어 포함, v1.1 기준)
- ※ MVP Lite는 Phase 1 + Task 2.4(A) 만으로도 운영 가능 (~3주)

## 3. Phase 1 - Hardening

### 3.0 킥오프 체크리스트

- [ ] 문서 3종 통독
- [ ] Git 리포 및 기본 디렉토리 구조 생성
- [ ] `ADR-0001-repository-conventions.md` 작성
- [ ] 최소 API 키 발급

### Task 1.1 - 파라미터 레지스트리 구축

- 목표:
  - 수식 속 매직 넘버를 `config/params.yaml`로 외부화
- 산출물:
  - `config/params.yaml`
  - `config/params.schema.json`
  - `docs/params_reference.md`
  - `stockpilot_agent_brief.md v1.1`
- 완료 기준:
  - [ ] 22개 이상의 파라미터 외부화
  - [ ] JSON Schema 검증 통과
  - [ ] 회귀 테스트 `0 diff`

에이전트 프롬프트:

```text
역할: StockPilot v1.1 파라미터 레지스트리 담당 엔지니어
입력 문서: stockpilot_agent_brief.md v1.0, stockpilot_v1_gap_analysis.md §1.1
목표: 스코어링 수식의 모든 매직 넘버를 config/params.yaml로 이동

요구사항:
1. 파라미터 그룹: stage1, stage2, stage3, stage4, macro, derived
2. 각 파라미터: {default, min, max, owner, rationale, last_changed}
3. JSON Schema 검증 가능
4. 브리프 수식의 숫자 리터럴 -> ${PARAM_NAME} 치환
5. 리팩터 전후 동일 입력의 최종점수 차이 0
```

### Task 1.2 - adj_close 정책 문서화

- 목표:
  - 장기 팩터와 당일 돌파 팩터의 가격 필드 사용 규칙 확정
- 산출물:
  - `docs/adj_close_policy.md`
  - `db/migrations/V1.5__adj_close_required.sql`
  - `stockpilot_data_spec.md v1.1`
- 완료 기준:
  - [ ] 12팩터 사용 필드 매트릭스 작성
  - [ ] `adj_close null` 비율 0%

### Task 1.3 - 골든 테스트 60건

- 목표:
  - 12개 팩터의 입력/출력 회귀 테스트 구축
- 산출물:
  - `tests/golden/*.yaml`
  - `tests/test_golden.py`
  - `tests/fixtures/sample_ohlcv.parquet`
- 완료 기준:
  - [ ] `12 × 5 = 60건`
  - [ ] `pytest tests/test_golden.py -> 60 passed`

### Task 1.4 - 앵커 이벤트 카탈로그

- 목표:
  - `vwap_anchored`의 앵커일을 결정론적으로 정의
- 산출물:
  - `docs/anchor_events_policy.md`
  - `db/migrations/V2__anchor_events.sql`
  - `src/derived/anchor_resolver.py`
- 완료 기준:
  - [ ] 우선순위 결정 트리 완성
  - [ ] 단위 테스트 10건 통과

### Task 1.5 - RS 창 & 다이버전스 규칙 명시화

- 목표:
  - 묵시적 파라미터 2개를 명시화
- 산출물:
  - `stockpilot_agent_brief.md v1.1`
  - `config/params.yaml` 파라미터 추가
- 기본 결정:
  - `RS_LOOKBACK_DAYS = 63`
  - `DIVERGENCE_EXTREMA_ORDER = 5`
  - `DIVERGENCE_MIN_LAG_DAYS = 20`
  - `DIVERGENCE_MAX_LAG_DAYS = 120`
  - `DIVERGENCE_CONFIRMATION_LAG = 5`

### 3.8 Phase 1 Gate Review

- [ ] Task 1.1 ~ 1.5 DoD 통과
- [ ] Golden + regression 통과
- [ ] 브리프 v1.1 배포
- [ ] ADR 5건 이상 기록

## 4. Phase 2 - Proof

### Task 2.1 - 백테스트 프로토콜 구현

- 목표:
  - 10년 walk-forward로 알파 증명
- 산출물:
  - `docs/backtest_protocol.md`
  - `backtest/protocol_v1.py`
  - `backtest/reports/v1.0/summary.pdf`
  - `equity_curve.parquet`
  - `factor_attribution.parquet`
- 실험 설계:
  - Train `2015-2019`
  - Validation `2020-2021`
  - OOS `2022-2023`
  - Live paper `2024-현재`
- 완료 기준:
  - [ ] OOS Sharpe `> 0.7`
  - [ ] CI 하한 `> 0.3`
  - [ ] OOS MDD `< 25%`
  - [ ] 벤치마크 대비 IR `> 0.4`

### Task 2.2 - 리스크 관리 계층

- 산출물:
  - `docs/risk_management_spec.md`
  - `src/risk/position_sizing.py`
  - `src/risk/drawdown_rules.py`
  - `src/risk/kill_switch.py`
- 핵심 규칙:
  - 변동성 타겟팅 + 점수 가중
  - `-5/-10/-15/-20%` 드로우다운 룰
  - 단일 종목 `20%`, 섹터 `35%`

### Task 2.3 - 생존 편향 제거

- 산출물:
  - `db/migrations/V3__delisting_history.sql`
  - `config/universe/kospi200_membership.parquet`
  - `config/universe/sp500_membership.parquet`
  - `docs/universe_construction.md`

### Task 2.4 - 캘리브레이션 Phase A: Percentile 오버레이 ⭐ MVP 필수

> 선행: Task 2.1 (historical score 재활용)  
> 참고: `docs/stockpilot/stockpilot_calibration_spec.md` §8 Phase A

- 목표: 낮은 점수가 "시장 탓인지 모델 탓인지" 즉시 진단
- 예상 시간: **1주**
- 산출물:
  - `score_distribution_stats` DB 테이블 + 웜업 적재
  - 출력 스키마에 `calibration` + `diagnostics` 블록 추가
  - 일일 Calibration Report 자동 발송

에이전트 프롬프트:
```text
[역할] 캘리브레이션 Phase A 구현 에이전트
[입력] docs/stockpilot/stockpilot_calibration_spec.md §1~3
[목표] 10년 historical score 웜업 → percentile_universe 필드 출력
[DoD] 매일 리포트 수신 + 종목별 percentile_universe 출력 확인
```

완료 기준:
- [ ] `score_distribution_stats` 초기 적재 완료
- [ ] `calibration.percentile_universe` 필드 출력 확인
- [ ] 일일 Calibration Report 수신

### 4.5 Phase 2 Gate Review

- [ ] OOS Sharpe `> 0.7`
- [ ] 리스크 룰 적용 후 MDD 개선
- [ ] 생존 편향 제거 후 성과 재확인
- [ ] **Task 2.4 완료 (Calibration Phase A)**

## 5. Phase 3 - Operationalize

### Task 3.1 - 관측성 & 드리프트 모니터링

- 산출물:
  - `docs/observability_spec.md`
  - `src/observability/metrics.py`
  - `observability/dashboards/*.json`
  - `observability/alerts.yaml`
- SLO:
  - scoring success rate `>= 98%`
  - p95 compute latency `< 300s`
  - dq flag rate `< 5%`
  - score distribution KL div `< 0.3`
  - filter pass rate drift `< 0.15`

### Task 3.2 - Paper Trading 프로토콜

- 산출물:
  - `docs/paper_trading_protocol.md`
  - `src/execution/paper_broker.py`
  - 주간 리포트 자동화
- 종료 기준:
  - [ ] 3개월 Sharpe `> 0.5`
  - [ ] OOS 대비 Sharpe 괴리 `< 0.4`
  - [ ] MDD `< 15%`

### Task 3.3 - KR 네이티브 매크로 확장

- 산출물:
  - `docs/kr_macro_extension.md`
  - `params.yaml v1.2`
  - `brief v1.2`
- 추가 필드:
  - `vkospi_close`
  - `yield_spread_kr_10y_3y`
  - `usd_krw_change_20d`
  - `foreign_net_buy_kospi_5d`
  - `kr_credit_spread`

### Task 3.4 - 캘리브레이션 Phase B: 레짐 조건부

> 선행: Task 3.2 (Paper Trading) + Task 4.1 임시 레짐 분류기  
> 참고: `docs/stockpilot/stockpilot_calibration_spec.md` §8 Phase B

- 목표: 동일 레짐 과거 분포 대비 백분위로 임계값 자동 조정
- 예상 시간: **2주**
- 산출물:
  - `src/regime/simple_rules.py`
  - `(date, regime)` 분포 분리 저장
  - `percentile_regime_90d`, `percentile_regime_1y` 필드
  - `hybrid` threshold 모드 배포

완료 기준:
- [ ] 레짐별 백분위 계산 검증
- [ ] hybrid 모드 30일 shadow 비교 완료

### 5.5 Phase 3 Gate Review

- [ ] Paper trading 안정화
- [ ] SLO 30일 안정
- [ ] KR 필터 효과 검증
- [ ] **Task 3.4 완료 (Calibration Phase B)**

## 6. Phase 4 - Evolution

### Task 4.1 - LLM 팩터 발견 루프

- 산출물:
  - `docs/llm_factor_discovery_spec.md`
  - `src/llm_discovery/map_reduce.py`
  - `src/llm_discovery/candidate_evaluator.py`
- 승인 기준:
  - IC `> 0.03`
  - 상관 `< 0.6`
  - Sharpe 추가 기여 `> 0.2`

### Task 4.2 - 레짐 감지 & 조건부 가중

- 산출물:
  - `docs/regime_detection_spec.md`
  - `src/regime/classifier.py`
  - `config/regime_weights.yaml`
- 레짐:
  - `TREND_UP`
  - `TREND_DOWN`
  - `RANGE`
  - `CRISIS`

### Task 4.3 - 앙상블 스코어링

- 산출물:
  - `src/ensemble/voting.py`
  - `config/ensemble_configs/*.yaml`
- 목표:
  - 단일 파라미터 과적합 완화

### Task 4.4 - 캘리브레이션 Phase C: 팩터 효능 모니터링

> 선행: Task 4.1 (LLM 팩터 발견 루프)  
> 참고: `docs/stockpilot/stockpilot_calibration_spec.md` §5

- 목표: IC 기반 알파 소실 자동 감지 + 감쇠 메커니즘
- 예상 시간: **4주**
- 산출물:
  - Forward return 파이프라인
  - `factor_efficacy_daily` 테이블
  - decay_flag 룰 + 알람
  - shadow-mode 자동 감쇠

완료 기준:
- [ ] 인공 decay 주입 → 감지·알람·감쇠 작동 확인
- [ ] 60일 IC 롤링 시계열 출력 확인

### Task 4.5 - 캘리브레이션 Phase D: 베이지안 팩터 가중 갱신 (선택)

> 선행: Task 4.4 (팩터 효능 모니터링 6개월 이상 운영 후)  
> 참고: `docs/stockpilot/stockpilot_calibration_spec.md` §7

- 목표: 팩터 가중치를 IC 관측으로 자동 업데이트
- 예상 시간: **4주**
- 주의: 조기 도입 시 과학습 위험 — Phase 4 완료 후 필요성 재검토

완료 기준:
- [ ] 분기별 베이지안 재학습 파이프라인 작동
- [ ] 갱신 전후 백테스트 성과 비교

### 6.5 Phase 4 Gate Review

- [ ] 분기별 후보 10개 이상 생성
- [ ] 레짐/앙상블 중 최소 1개 채택
- [ ] 브리프 v2.0 확정
- [ ] **Task 4.4 완료 (Calibration Phase C)**

## 7. 공통 템플릿

### 7.1 에이전트 핸드오프 프롬프트

```text
[역할] 당신은 StockPilot <Task X.Y> 담당 <직무> 에이전트다.

[컨텍스트]
- 페어 문서: docs/stockpilot_master_playbook.md §<위치>
- 선행 Task: <번호들>
- 현재 버전: <v1.x>

[입력]
- <파일 경로 1>
- <파일 경로 2>

[목표]
<한 줄>

[산출물]
1. <파일 경로> - <설명>
2. <파일 경로> - <설명>

[제약]
- <금지 항목>
- <필수 항목>

[완료 기준]
- [ ] <항목 1>
- [ ] <항목 2>

[검증 방법]
<명령어 또는 스크립트>
```

### 7.2 ADR 템플릿

```md
# ADR-XXXX: <결정 제목>

- 상태: 제안 | 채택 | 폐기
- 일자: YYYY-MM-DD
- 담당: <이름>
- 관련 Task: X.Y

## 맥락
...

## 옵션
1. ...
2. ...

## 결정
...

## 결과
- 긍정:
- 부정:
- 후속 조치:
```

### 7.3 Task 완료 리포트

```md
# Task X.Y Completion Report

- 완료일: YYYY-MM-DD
- 실소요: N일
- 담당: <이름>

## 산출물 체크
- [x] ...

## DoD 검증
- [x] ...

## 다음 Task 핸드오프
...
```

### 7.4 Gate Review 체크리스트

```md
# Phase <N> Gate Review

## DoD 확인
- [ ] ...

## 정량 목표 달성
| 지표 | 목표 | 실측 | 판정 |
|---|---|---|---|
```

## 8. 정지 규칙

| 조건 | 대응 |
|---|---|
| Task가 예상 시간의 2배 초과 | Pause 후 스코프 재평가 |
| Phase 2 OOS Sharpe `< 0.3` | Phase 1 회귀 |
| Paper trading 3개월 Sharpe `< 0` | 전면 재설계 |
| DQ 플래그 비율 `> 20%` 2주 연속 | 데이터 파이프라인 수정 우선 |
| Kill switch 월 5회 이상 | 리스크 룰 재설계 |

중단 시:

1. Git tag `stop/YYYY-MM-DD`
2. `docs/stop_incident_YYYY-MM-DD.md` 작성
3. 최소 3일 쿨다운 후 재기획

## 9. 최소 실행안 (MVP Lite)

필수 포함:

- Task `1.1`
- Task `1.2`
- Task `1.5`
- Task `2.1`
- Task `2.2`
- Task `2.3`
- Task `3.2`

축소 가능:

- `1.3`은 상위 5개 팩터만
- `1.4`는 `fallback_120d`로 축소 가능
- `3.1`은 로그만 남기고 알람 생략 가능

MVP 예상:

- 약 `12주`

## 10. 용어 & 약어

| 약어 | 의미 |
|---|---|
| `ADR` | Architecture Decision Record |
| `CI` | Continuous Integration |
| `DoD` | Definition of Done |
| `DQ` | Data Quality |
| `IC` | Information Coefficient |
| `IR` | Information Ratio |
| `MDD` | Maximum Drawdown |
| `OOS` | Out-of-Sample |
| `POC` | Point of Control |
| `VWAP` | Volume Weighted Average Price |

## 11. 첫 3일

- Day 1
  - 플레이북 통독
  - 리포 구조 생성
  - API 키 발급
- Day 2
  - 킥오프 체크리스트 완료
  - Task 1.1 착수
- Day 3
  - Task 1.1 완료 또는 에이전트 위임

## 변경 이력

| 버전 | 일자 | 변경 |
|---|---|---|
| `1.0` | `2026-04-17` | 초판 |
