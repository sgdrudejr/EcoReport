# Shadow Pipeline Overview

EcoReport shadow pipeline은 `리포트 -> 근거 조각 -> 주제 버킷 -> 최종 인사이트` 흐름을 운영 파이프라인 옆에서 검증하기 위한 보조 레이어입니다.

## 목적

- 리포트 100건을 문서 단위로 끝까지 끌고 가지 않고 근거 단위로 분해합니다.
- appendix, 정책문구, 괴리율표 같은 노이즈를 Stage 0/1에서 먼저 제거합니다.
- 주제 버킷 기반으로 시장 논리 축을 재조합해 Stage 4와 dashboard preview에 연결합니다.
- 기존 운영 Stage 1~4를 대체하지 않고, shadow-ready 상태를 검증하는 실험 레이어로 유지합니다.

## 진입점

- 개별 실행
  - `node scripts/build-report-chunk-index.js --date YYYY-MM-DD`
  - `node scripts/build-stage1-shadow-extracts.js --date YYYY-MM-DD`
  - `node scripts/build-stage2-shadow-topic-buckets.js --date YYYY-MM-DD`
  - `node scripts/build-stage3-shadow-final-insights.js --date YYYY-MM-DD`
- 묶음 실행
  - `bash scripts/shadow/run-shadow-pipeline.sh --date YYYY-MM-DD`
  - `npm run shadow:pipeline -- --date YYYY-MM-DD`

## 단계별 역할

### Stage 0: Chunk Index

- 입력
  - `data/reports/{date}/index.json`
  - `data/reports/{date}/text-manifest.json`
  - `data/reports/{date}/text/*.txt`
  - `data/portfolio/latest.json`
- 출력
  - legacy: `data/analysis-state/{date}/chunk-index/*`
  - canonical mirror: `data/analysis-state/{date}/shadow/stage0/*`
- 역할
  - 텍스트를 chunk로 자르고
  - appendix/정책문구를 hard exclude하고
  - Stage 1 shadow가 읽을 후보 chunk만 남깁니다.

### Stage 1: Shadow Extracts

- 입력
  - `data/analysis-state/{date}/chunk-index/chunks.jsonl`
- 출력
  - legacy: `data/analysis-state/{date}/stage1-shadow/stage1-shadow-extracts.json`
  - canonical mirror: `data/analysis-state/{date}/shadow/stage1/stage1-shadow-extracts.json`
- 역할
  - 리포트별로 최대 6개의 chunk를 선택하고
  - `claim`, `key_numbers`, `keep_condition`, `break_condition`, `bull_chunk`, `risk_chunk`를 구조화합니다.

### Stage 2: Topic Buckets

- 입력
  - `data/analysis-state/{date}/stage1-shadow/stage1-shadow-extracts.json`
- 출력
  - legacy:
    - `data/analysis-state/{date}/stage2-shadow-topic-buckets.json`
    - `data/analysis-state/{date}/stage2-shadow-topic-buckets.md`
  - canonical mirror:
    - `data/analysis-state/{date}/shadow/stage2/stage2-shadow-topic-buckets.json`
    - `data/analysis-state/{date}/shadow/stage2/stage2-shadow-topic-buckets.md`
- 역할
  - 근거 카드를 주제 버킷으로 재분류하고
  - `공통 주장 / 충돌 주장 / 유지 조건 / 깨지는 조건`을 버킷별로 정리합니다.

### Stage 3: Final Insights

- 입력
  - `data/analysis-state/{date}/stage2-shadow-topic-buckets.json`
  - `data/analysis-state/{date}/stage3-quant-scores.json`
  - `data/portfolio/latest.json`
- 출력
  - legacy:
    - `data/analysis-state/{date}/stage3-shadow-final-insights.json`
    - `data/analysis-state/{date}/stage3-shadow-final-insights.md`
  - canonical mirror:
    - `data/analysis-state/{date}/shadow/stage3/stage3-shadow-final-insights.json`
    - `data/analysis-state/{date}/shadow/stage3/stage3-shadow-final-insights.md`
- 역할
  - 주제 버킷을 투자 판단형 문장으로 정리하고
  - `priority_actions`, `watchpoints`, `dashboard_preview`를 생성해 Stage 4와 dashboard에 연결합니다.

## 운영 파이프라인과의 연결

- `scripts/run-strategy-pipeline.sh`
  - Stage 2.5 뒤에서 `bash scripts/shadow/run-shadow-pipeline.sh ...` 를 호출합니다.
- `scripts/build-stage4-execution-plan.js`
  - Stage 3 shadow 결과를 읽어 계좌별 `actionLine`과 shadow preview를 보강합니다.
- `scripts/build-feedback-report.js`
  - shadow top topics와 watchpoints를 복기 섹션으로 포함합니다.
- `dashboard/app/page.tsx`
  - `Cycle Reports` 탭, 실행/시장/피드백 리포트 문장, 메인 대시보드 일부 서술에 shadow 결과를 사용합니다.
- `dashboard/app/shadow-preview/page.tsx`
  - Stage 2/3 shadow 산출물을 직접 미리보기로 확인합니다.

## 지금 단계의 판단

- 상태: `shadow-ready`
- 의미
  - Stage 1~3 shadow는 한 사이클을 끝까지 돌려볼 수 있습니다.
  - 실운영 기본 Stage 1 교체는 아직 아닙니다.
  - false positive 축소와 wording refinement는 계속 개선 대상입니다.

## 다음 단계

1. Stage 1 noisy snippet을 더 줄여 `keep/break` 분리를 안정화합니다.
2. Stage 2의 `기타 시장축` 비중을 더 줄이고 세부 버킷을 늘립니다.
3. Stage 3 결과를 dashboard wording과 feedback loop에 더 일관되게 연결합니다.

