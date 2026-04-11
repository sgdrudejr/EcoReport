# EcoReport Upgrade Issues

## Issue 1. Failure-safe cycle runner
- Status: in_progress
- Goal: 실패가 나도 같은 날 파이프라인을 재시도하고, 어떤 폴백이 적용됐는지 남긴다.
- Scope:
  - `scripts/run-quality-gated-cycle.sh`
  - `scripts/verify-daily-system.js`
  - `package.json`
- Success criteria:
  - verify 결과가 `error` 또는 품질 임계치 미달이면 자동 재시도 가능
  - fallback checklist와 마지막 실패 원인이 파일로 저장됨

## Issue 2. Stage 1 claim hygiene
- Status: in_progress
- Goal: 표, 목차, 고지문, 장식 문장이 `key_thesis`로 살아남지 못하게 막는다.
- Scope:
  - `scripts/build-stage1-report-extracts.js`
- Success criteria:
  - claim object에 `entity`, `direction`, `strength`, `horizon`, `condition`, `counterpoint`, `source_span` 포함
  - contamination rate 계산 가능

## Issue 3. Stage 3 relation gate
- Status: in_progress
- Goal: 관련 없는 리포트가 다른 자산으로 spillover 되지 않게 제한한다.
- Scope:
  - `config/asset-relations.json`
  - `scripts/build-stage3-quant-scores.js`
- Success criteria:
  - direct / thematic / second_order 관계 구분
  - unrelated evidence ratio 계산 가능

## Issue 4. Stage 4 contradiction validator
- Status: in_progress
- Goal: 전략과 액션이 충돌하면 실행안 대신 reject 또는 no_action을 남긴다.
- Scope:
  - `scripts/build-stage4-execution-plan.js`
- Success criteria:
  - `rejectedAlternatives`, `rejectionReason`, `validatorFlags`, `confidence`, `topEvidence` 출력
  - trim/buy 동시 표출 같은 자기모순 차단

## Issue 5. Dashboard explainability
- Status: pending
- Goal: 짧은 결론과 긴 해설, 근거 추적을 분리해 보여준다.
- Scope:
  - `dashboard/lib/recommendations.ts`
  - `dashboard/lib/portfolio-guidance.ts`
  - 관련 컴포넌트
- Success criteria:
  - Decision / Reasoning / Source 층 표시
  - no_action / rejected 대안 노출

## Issue 6. Quality harness
- Status: in_progress
- Goal: 생성 성공이 아니라 품질 실패를 잡아낸다.
- Scope:
  - `scripts/verify-daily-system.js`
  - `data/analysis-state/<date>/daily-quality.json`
- Success criteria:
  - contamination, spillover, conflict, low-confidence rejection 지표 기록
  - verify가 품질 문제를 `warn`/`error`로 승격
