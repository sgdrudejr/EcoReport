# Failure Fallback Checklist

## Retry order
1. `verify`에서 실패 체크와 품질 체크를 읽는다.
2. 실패 타입이 입력 데이터 부족인지, 생성 로직 실패인지, 품질 실패인지 구분한다.
3. 같은 `run_date`와 `effective_market_date`로 재시도한다.
4. 재시도 후에도 실패하면 더 좁은 단계만 다시 돌린다.
5. 마지막에도 품질 임계치 미달이면 `no_action`과 `rejected`를 유지한 채 종료한다.

## Fallback actions by failure type

### Stage 1 contamination
- 원인: 표, 목차, 고지문, 숫자 덤프가 claim으로 채택됨
- 조치:
  - Stage 1 재실행
  - hard filter class가 `heading`, `table_caption`, `metadata`, `disclaimer`인 문단 제외
  - claim confidence threshold 상향

### Stage 3 spillover
- 원인: theme 유사성만으로 다른 자산에 근거가 붙음
- 조치:
  - relation gate 적용 후 Stage 3 재실행
  - `forbidden_tags` 충돌 근거 제거
  - `second_order`는 낮은 weight로만 허용

### Stage 4 contradiction
- 원인: trim과 buy 동시 발생, rationale/action 불일치
- 조치:
  - Stage 4 재실행
  - validator reject 유지
  - 실행 후보 없으면 `no_action` 출력

### Missing artifact
- 원인: stage 파일 누락 또는 JSON 파싱 실패
- 조치:
  - 누락된 단계부터 재실행
  - Stage 2 API 실패 시 fallback mock 허용
  - downstream는 upstream 성공 후에만 재실행

## Final success condition
- verify `overallStatus`가 `ok` 또는 허용 가능한 `warn`
- quality report의 핵심 지표:
  - contamination rate <= 0.2
  - unrelated evidence ratio <= 0.35
  - action conflict count == 0
  - low-confidence action rejection count recorded
