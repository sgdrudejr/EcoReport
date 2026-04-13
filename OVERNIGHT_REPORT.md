# Overnight Report

## 1. 무엇을 바꿨는지

- shadow pipeline 실행 경로를 정리했습니다.
  - 새 runner: `scripts/shadow/run-shadow-pipeline.sh`
  - 새 공통 유틸: `scripts/lib/shadow-pipeline.js`
  - 새 npm script: `npm run shadow:pipeline -- --date YYYY-MM-DD`
- shadow 산출물을 legacy 경로와 canonical mirror 경로에 같이 쓰도록 정리했습니다.
  - legacy 경로는 유지합니다.
  - canonical mirror 경로는 `data/analysis-state/{date}/shadow/stage{0,1,2,3}/...` 입니다.
- Stage 1 false positive를 더 줄였습니다.
  - meta/snippet noise 필터를 보강했습니다.
  - `keep_condition`과 `break_condition`의 선택 조건을 더 분리했습니다.
- Stage 2 false positive를 더 줄였습니다.
  - `other` 버킷 진입 조건을 더 보수적으로 만들었습니다.
  - `FinBERT`, 심리 비율, 국가 리스트형 snippet을 더 강하게 제외했습니다.
  - `인터넷·미디어·엔터`, `건설·플랜트·재건` 버킷을 추가했습니다.
- 메인 대시보드 중복을 줄였습니다.
  - `Cycle Reports`에 shadow action/watchpoint를 더 직접 반영했습니다.
  - `투자 방향성` 네비게이션 항목은 제거하고 계좌 내부 `계좌 판단 메모 + 계좌 실행 메모`로 합쳤습니다.
  - `실행 가이드`는 `브리핑 입력` 성격으로 좁혀 shadow 시장 리포트와의 중복을 줄였습니다.
- daily automation summary 계약에 shadow 산출물을 포함했습니다.
  - `chunkIndexStats`, `stage1Shadow`, `stage2Shadow`, `stage3Shadow`
- 문서를 추가했습니다.
  - `docs/SHADOW_PIPELINE_OVERVIEW.md`
  - `docs/SHADOW_OUTPUT_SCHEMAS.md`

## 2. 왜 바꿨는지

- shadow 파이프라인이 운영 스크립트와 섞여 있어 진입점과 출력 위치가 읽기 어려웠습니다.
- 메인 대시보드에 `Cycle Reports`와 기존 `투자 방향성 / 실행 가이드`가 동시에 남아 있어 문구가 겹쳤습니다.
- Stage 1/2에서 정량표, appendix, 리스트형 snippet이 일부 `other` 버킷이나 claim으로 남았습니다.
- automation cycle 관점에서도 shadow 산출물이 빠지면 실제 한 사이클 완료 여부를 판단하기 어려웠습니다.

## 3. 테스트 날짜와 결과

### Shadow pipeline 3일 검증

실행 기준:

```bash
ECOREPORT_ROOT=/Users/seo/Documents/Playground/EcoReport bash scripts/shadow/run-shadow-pipeline.sh --date YYYY-MM-DD
```

검증 날짜:

- `2026-04-08`
- `2026-04-09`
- `2026-04-10`

### 날짜별 결과 요약

#### 2026-04-08

- chunk-index
  - `reports=100`
  - `chunks=1559`
  - `eligible=574`
  - `disclaimers_removed=108`
  - `avg_top_chunks_per_report=3.2`
- stage1-shadow
  - `selected_chunks=322`
  - `reports_with_condition=79`
  - `reports_with_counterpoint=75`
  - `reports_with_both=12`
- stage2-shadow
  - `cards=68`
  - `buckets=20`
  - top buckets: `지정학·리스크 레짐`, `중국·유럽·일본·신흥국`, `반도체·메모리`, `신용·유동성`
  - `other` bucket은 `1 card / 1 report`만 남았습니다.
- stage3-shadow
  - `top_topics=8`
  - `secondary=5`
  - `regime=SIDEWAYS`
  - `portfolio_score=63`

#### 2026-04-09

- chunk-index
  - `reports=69`
  - `chunks=1305`
  - `eligible=454`
  - `disclaimers_removed=66`
  - `avg_top_chunks_per_report=3.0`
- stage1-shadow
  - `selected_chunks=206`
  - `reports_with_condition=49`
  - `reports_with_counterpoint=59`
  - `reports_with_both=6`
- stage2-shadow
  - `cards=46`
  - `buckets=16`
  - top buckets: `지정학·리스크 레짐`, `한국증시·수급`, `반도체·메모리`, `AI 인프라·데이터센터`, `인터넷·미디어·엔터`
  - `other` bucket 없음
- stage3-shadow
  - `top_topics=8`
  - `secondary=5`
  - `regime=SIDEWAYS`
  - `portfolio_score=64`

#### 2026-04-10

- chunk-index
  - `reports=69`
  - `chunks=1305`
  - `eligible=454`
  - `disclaimers_removed=66`
  - `avg_top_chunks_per_report=3.0`
- stage1-shadow
  - `selected_chunks=206`
  - `reports_with_condition=49`
  - `reports_with_counterpoint=59`
  - `reports_with_both=6`
- stage2-shadow
  - `cards=46`
  - `buckets=16`
  - top buckets: `지정학·리스크 레짐`, `한국증시·수급`, `반도체·메모리`, `AI 인프라·데이터센터`, `인터넷·미디어·엔터`
  - `other` bucket 없음
- stage3-shadow
  - `top_topics=8`
  - `secondary=5`
  - `regime=BULL`
  - `portfolio_score=63`

### 추가 검증

- `node --check`
  - modified shadow scripts, stage4, feedback, automation runner 모두 통과
- dashboard lint
  - 통과
- dashboard build
  - `npm --prefix dashboard run build -- --webpack`
  - 통과
- stage4 실행계획 생성
  - `build-stage4-execution-plan.js --date 2026-04-10`
  - 통과

### 주의사항

- `build-feedback-analysis.js --date 2026-04-10` 는 snapshot 데이터를 읽어 최신 분석 파일을 다시 생성했으며, 결과는 `2026-04-12-feedback.json` 으로 저장됐습니다.
- 따라서 `build-feedback-report.js --date 2026-04-10` 는 기존 계약상 바로 통과하지 않았습니다.
- 이 부분은 feedback analysis 날짜 계약을 명시적으로 손보는 후속 작업이 필요합니다.

## 4. 좋아진 점

- shadow 실행 경로와 산출물 위치가 훨씬 읽기 쉬워졌습니다.
- 메인 대시보드에서 `Cycle Reports`와 기존 방향성 섹션의 중복이 줄었습니다.
- Stage 2의 `other` 버킷이 `2026-04-09`, `2026-04-10` 에서는 사라졌고, `2026-04-08`도 `1 card`만 남았습니다.
- 엔터/미디어, 건설·재건 같이 기존에 `other`로 밀리던 카드가 새 버킷으로 흡수됐습니다.
- automation cycle 완료 여부를 볼 때 shadow 산출물도 같이 추적할 수 있게 됐습니다.
- canonical mirror 경로 덕분에 shadow 산출물을 stage별로 따라가기가 쉬워졌습니다.

## 5. 아직 남은 문제

- `2026-04-08`에는 `other` 버킷이 `1 card` 남아 있습니다.
  - `Novo Nordisk / obesity`류 카드가 아직 고정 버킷으로 완전히 흡수되지 않습니다.
- feedback analysis/report 날짜 계약이 직관적이지 않습니다.
  - `--date` 기준 snapshot과 analysis output date가 어긋날 수 있습니다.
- 메인 dashboard wording은 많이 나아졌지만, Stage 3 headline이 날짜에 따라 여전히 비슷한 문장 패턴을 반복할 수 있습니다.
- `run-daily-automation-cycle.js`는 이번에 shadow artifact 추적까지 포함됐지만, shadow step 자체를 checkpoint granularity로 더 잘게 자르려면 후속 보강 여지가 있습니다.

## 6. 지금 상태를 어떻게 봐야 하는지

- `production-ready`: 아니오
- `shadow-ready`: 예
- `further refinement needed`: 예

판단:

- shadow pipeline은 이제 main에서 읽고 빌드하고 검증할 수 있는 수준입니다.
- 메인 대시보드 통합도 시작할 수 있는 상태입니다.
- 다만 운영 기본 Stage 1 교체나 feedback 날짜 계약까지 완전히 안정화된 상태는 아닙니다.

## 7. 다음 추천 작업 3개

1. `build-feedback-analysis.js` / `build-feedback-report.js` 의 날짜 계약을 정리해 `--date` 기준 결과가 항상 예측 가능하게 맞추기
2. Stage 2에 `헬스케어/글로벌 비만치료제` 또는 `글로벌 제약` 세부 버킷을 추가해 남은 `other` 1카드를 흡수하기
3. `run-daily-automation-cycle.js` 에 shadow 단계별 checkpoint와 실패 복구 로그를 더 세분화해 재실행 성공률을 높이기
