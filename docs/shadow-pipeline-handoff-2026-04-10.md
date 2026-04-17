# EcoReport Shadow Pipeline Handoff

## 목적
- 이 문서는 `리포트 -> chunk-index -> stage1 shadow -> topic buckets -> final shadow insights` 실험 흐름을 다른 AI가 빠르게 검증할 수 있도록 정리한 handoff 문서입니다.
- 기준 날짜는 `2026-04-10` 입니다.
- 아직 메인 배포나 실운영 교체는 하지 않았습니다.

## 현재 브랜치 / Git 상태
- 작업 브랜치: `codex/build-report-chunk-index`
- 현재 HEAD: `c90ce39`
- `main` HEAD: `1f61af7`
- `main...HEAD` 기준 커밋된 변경 파일:
  - [scripts/build-report-chunk-index.js](/Users/seo/Documents/Playground/economy-report/scripts/build-report-chunk-index.js:1)
  - [scripts/build-stage1-shadow-extracts.js](/Users/seo/Documents/Playground/economy-report/scripts/build-stage1-shadow-extracts.js:1)
- 로컬에서만 추가된 shadow 후속 실험 파일:
  - [scripts/build-stage2-shadow-topic-buckets.js](/Users/seo/Documents/Playground/economy-report/scripts/build-stage2-shadow-topic-buckets.js:1)
  - [scripts/build-stage3-shadow-final-insights.js](/Users/seo/Documents/Playground/economy-report/scripts/build-stage3-shadow-final-insights.js:1)
- 저장소 전체는 user 작업 포함으로 매우 dirty 합니다.
- 다른 AI는 반드시 “이 작업 범위 파일만” 보고 판단하는 것이 안전합니다.

## 이번 실험의 핵심 아이디어
- 100건 리포트를 문서 단위로 끝까지 들고 가지 않고, 먼저 `근거 후보 chunk`로 분해합니다.
- 그 다음 `리포트별 근거 카드(Stage 1 shadow)`를 만들고,
- 다시 `주제 버킷(Stage 2 shadow)`으로 재묶고,
- 마지막에 `시장 레짐 + 주제별 인사이트 + 포트폴리오 연결(Stage 3 shadow)`까지 preview 성격으로 생성합니다.

## 작업 범위

### 1. Stage 0: Chunk Index
- 파일: [scripts/build-report-chunk-index.js](/Users/seo/Documents/Playground/economy-report/scripts/build-report-chunk-index.js:1)
- 역할:
  - 리포트 원문을 block/chunk로 분할
  - `appendix`, `투자의견/목표주가 괴리율`, `투자등급 기준표`, `Compliance`류 hard exclude
  - `priority_score`, `has_condition`, `has_counterpoint`, `has_target_price`, `has_holding_match`, `is_disclaimer` 계산
- 출력:
  - [data/analysis-state/2026-04-10/chunk-index/chunks.jsonl](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/chunk-index/chunks.jsonl:1)
  - [data/analysis-state/2026-04-10/chunk-index/stats.json](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/chunk-index/stats.json:1)

### 2. Stage 1 Shadow
- 파일: [scripts/build-stage1-shadow-extracts.js](/Users/seo/Documents/Playground/economy-report/scripts/build-stage1-shadow-extracts.js:1)
- 역할:
  - `chunks.jsonl`만 읽어 리포트별 핵심 근거 카드 생성
  - 선택 규칙:
    - `priority_score >= 5` 또는 `has_holding_match == true`
    - `is_disclaimer == true` 제외
    - 리포트당 최소 1개, 최대 6개
  - 출력 필드:
    - `claim`
    - `key_numbers`
    - `keep_condition`
    - `break_condition`
    - `bull_chunk`
    - `risk_chunk`
- 출력:
  - [data/analysis-state/2026-04-10/stage1-shadow/stage1-shadow-extracts.json](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/stage1-shadow/stage1-shadow-extracts.json:1)

### 3. Stage 2 Shadow: Topic Buckets
- 파일: [scripts/build-stage2-shadow-topic-buckets.js](/Users/seo/Documents/Playground/economy-report/scripts/build-stage2-shadow-topic-buckets.js:1)
- 역할:
  - Stage 1 shadow 결과를 주제 버킷으로 재분류
  - 한 카드가 여러 버킷으로 과분류되지 않도록 기본적으로 `1 thematic bucket` 중심으로 분류
  - broad theme만으로 들어가지 않게 `title/claim/condition` 텍스트 히트를 더 강하게 반영
  - meta/table/noise 문구를 Stage 2에서 한 번 더 필터링
  - 버킷별 markdown을 `3~8줄` 수준으로 요약
- 주요 버킷:
  - `지정학·리스크 레짐`
  - `금리·통화정책`
  - `신용·유동성`
  - `환율·달러`
  - `유가·에너지`
  - `물가·관세·정책`
  - `전력 인프라·원자력`
  - `방산·항공우주`
  - `반도체·메모리`
  - `자동차·산업재`
  - `중국·유럽·일본·신흥국`
  - `직접 보유종목`
- 출력:
  - [data/analysis-state/2026-04-10/stage2-shadow-topic-buckets.json](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/stage2-shadow-topic-buckets.json:1)
  - [data/analysis-state/2026-04-10/stage2-shadow-topic-buckets.md](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/stage2-shadow-topic-buckets.md:1)

### 4. Stage 3 Shadow: Final Insights
- 파일: [scripts/build-stage3-shadow-final-insights.js](/Users/seo/Documents/Playground/economy-report/scripts/build-stage3-shadow-final-insights.js:1)
- 역할:
  - Stage 2 bucket 결과 + 기존 [data/analysis-state/2026-04-10/stage3-quant-scores.json](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/stage3-quant-scores.json:1) + 포트폴리오를 읽음
  - 최종 preview 성격의 shadow 결과 생성:
    - `market_regime`
    - `executive_summary`
    - `top_topics`
    - `portfolio_implications`
    - `priority_actions`
    - `watchpoints`
    - `dashboard_preview`
- 출력:
  - [data/analysis-state/2026-04-10/stage3-shadow-final-insights.json](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/stage3-shadow-final-insights.json:1)
  - [data/analysis-state/2026-04-10/stage3-shadow-final-insights.md](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/stage3-shadow-final-insights.md:1)

## 실행 명령

```bash
node scripts/build-report-chunk-index.js --date 2026-04-10
node scripts/build-stage1-shadow-extracts.js --date 2026-04-10
node scripts/build-stage2-shadow-topic-buckets.js --date 2026-04-10
node scripts/build-stage3-shadow-final-insights.js --date 2026-04-10
```

## 결과 요약

### Stage 0: Chunk Index
- 리포트 수: `100`
- chunk 수: `1338`
- Stage 1 eligible chunk 수: `460`
- avg top chunks/report: `3.3`
- disclaimer removed: `86`
- appendix/정책문구 오탐: 샘플 기준 `0건`

### Stage 1 Shadow
- 리포트 수: `100`
- 총 selected chunk 수: `329`
- avg selected chunks/report: `3.29`
- `keep_condition` 존재 리포트: `41`
- `break_condition` 존재 리포트: `81`
- 둘 다 존재: `41`
- 이전 비교에서 관찰한 개선:
  - 조건 보존: `20 -> 41`
  - 반론/예외 보존: `60 -> 81`
  - 조건+반론 동시 존재: `17 -> 41`
  - noisy thesis 샘플: `3 -> 0`

### Stage 2 Shadow
- 카드 수: `91`
- 활성 버킷 수: `15`
- 상위 버킷:
  - `기타 시장축`
  - `지정학·리스크 레짐`
  - `전력 인프라·원자력`
  - `금리·통화정책`
  - `중국·유럽·일본·신흥국`
  - `자동차·산업재`
  - `환율·달러`
  - `유가·에너지`
- 특징:
  - `금/원자재` 쏠림을 줄임
  - bucket markdown은 대부분 `5~6줄`
  - meta/disclaimer/모닝코멘트류는 Stage 2에서 추가 차단

### Stage 3 Shadow
- 시장 레짐: `BULL (68%)`
- 포트폴리오 총점: `63`
- 상위 최종 토픽:
  - `지정학·리스크 레짐`
  - `전력 인프라·원자력`
  - `금리·통화정책`
  - `중국·유럽·일본·신흥국`
  - `유가·에너지`
  - `환율·달러`
  - `자동차·산업재`
  - `물가·관세·정책`
- 최종 결과는 대시보드 문장 대체가 아니라 `preview/shadow` 용도입니다.

## 품질에 대한 현재 판단

### 잘 된 점
- `chunk-index` false positive가 초기에 비해 많이 줄었습니다.
- appendix/정책문구/투자의견 표/괴리율 표류가 Stage 0에서 거의 정리되었습니다.
- Stage 1 shadow는 기존 Stage 1보다 `조건`, `반론`, `깨지는 조건` 보존이 더 좋습니다.
- Stage 2 shadow는 “리포트 묶음”이 아니라 “논리 축” 중심으로 다시 보게 만드는 데는 성공했습니다.
- Stage 3 shadow까지 붙이면서 `시장 레짐 -> 주제 버킷 -> 포트폴리오 연결` 한 사이클을 끝까지 볼 수 있게 됐습니다.

### 아직 남은 문제
- `기타 시장축`이 아직 `26개`로 큽니다.
- 일부 Stage 1 카드가 여전히 noisy snippet을 포함합니다.
- Stage 2/3 요약 문장 일부는 아직 길고 기계적입니다.
- `직접 보유종목` 버킷은 정밀도 우선으로 막아둔 상태라 recall이 낮습니다.
- 일부 버킷은 `유지 조건`과 `깨지는 조건` 문장이 여전히 완전히 분리되지 않습니다.
- Stage 3 shadow는 행동 추천이라기보다 preview 요약에 가깝고, 바로 실운영 액션으로 쓰기엔 아직 이릅니다.

## 이번 작업에서 명시적으로 하지 않은 것
- 기존 [scripts/build-stage1-report-extracts.js](/Users/seo/Documents/Playground/economy-report/scripts/build-stage1-report-extracts.js:1) 수정 없음
- 기존 Stage 2/Stage 3/Stage 4 실운영 스크립트 교체 없음
- 대시보드 연결 없음
- 메인 브랜치 merge 없음
- 배포 없음

## 다른 AI가 검증하면 좋은 질문
- Stage 1 shadow가 기존 Stage 1보다 정말 더 “근거 카드”에 가까운가?
- Stage 2 bucket taxonomy가 현재 시장 환경을 넓게 커버하면서도 과분류를 막고 있는가?
- `기타 시장축`이 너무 큰 이유가 Stage 1 recall/precision 문제인지, Stage 2 taxonomy 부족인지?
- Stage 3 shadow의 `top_topics`, `priority_actions`, `dashboard_preview`가 사람 눈에 자연스럽고 유용한가?
- 지금 시점에서 `preview 연결`로 가는 게 맞는지, 아니면 Stage 1/2 정제를 한 번 더 해야 하는지?

## 개인적 추천
- 지금 상태는 `실운영 교체`보다 `shadow preview 연결` 또는 `다른 AI 검증` 단계가 맞습니다.
- 다음 우선순위는 아래 둘 중 하나입니다.
  - `A.` Stage 2/3 output을 실제 화면에서 읽어보는 preview route 추가
  - `B.` Stage 1/2 false positive를 한 번 더 줄여서 `기타 시장축` 축소

## 참고 파일
- Chunk index stats: [data/analysis-state/2026-04-10/chunk-index/stats.json](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/chunk-index/stats.json:1)
- Stage 1 shadow extracts: [data/analysis-state/2026-04-10/stage1-shadow/stage1-shadow-extracts.json](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/stage1-shadow/stage1-shadow-extracts.json:1)
- Stage 2 shadow markdown: [data/analysis-state/2026-04-10/stage2-shadow-topic-buckets.md](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/stage2-shadow-topic-buckets.md:1)
- Stage 3 shadow markdown: [data/analysis-state/2026-04-10/stage3-shadow-final-insights.md](/Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/stage3-shadow-final-insights.md:1)
