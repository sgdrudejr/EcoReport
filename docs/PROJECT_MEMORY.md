# PROJECT_MEMORY

이 문서는 로컬 PDF 리포트 오케스트레이터의 장기 메모리다. 다음 세션의 Codex는 대화 히스토리를 전제로 하지 말고 이 파일과 `docs/SESSION_HANDOFF.md`를 먼저 읽는다.

## 1. 현재 시스템 스냅샷

- 기준 시점: 2026-04-15 (Asia/Seoul)
- 목적: Mac Mini에서 PDF 리포트 배치를 오케스트레이션하고, Windows PC의 로컬 LLM 서버로 구조화 요약과 최종 시장 뷰를 생성한다.
- source of truth:
  - 운영 상태: 이 문서
  - 세션 인계: `docs/SESSION_HANDOFF.md`
  - 실행 절차: `docs/RUNBOOK.md`
  - 설계 결정: `docs/DECISIONS.md`

## 2. 전체 아키텍처

- Mac Mini = 오케스트레이터
  - 배치 실행, PDF 탐색, 텍스트 추출, 전처리, 청크 분할, LLM 호출, 결과 저장, 로그 기록 담당
- Windows PC (RTX 5070 Ti) = llama-server 추론 서버
  - OpenAI-compatible API 형태로 응답
- 네트워크
  - Windows LLM base URL: `http://192.168.0.218:8080/v1`
  - Windows MAC: `A0:AD:9F:CD:47:D2`
  - Mac Mini와 Windows는 같은 LAN에 있음
- 모델 선택 규칙
  - `model` 값은 설정 파일의 기본값 또는 `LLM_MODEL` 환경변수 기준으로 사용
  - base URL은 항상 `http://192.168.0.218:8080/v1`를 사용한다

## 3. 구현된 파이프라인

파이프라인은 아래 순서를 강제한다.

`PDF -> text -> clean -> chunk -> chunk별 JSON summary -> report_summary -> final_market_view`

핵심 규칙:

- raw PDF 전체를 한 번에 LLM에 넣지 않는다
- 청크는 chunk overlap 기반의 범용 분할을 사용한다
- 병합 단계에서는 chunk 원문이 아니라 chunk summary JSON만 사용한다
- 최종 병합은 report summary JSON만 사용한다
- `standard`와 `deep` 두 모드를 지원한다

모드 차이:

- `standard`
  - 기본 청크 크기: 약 7000~9000자
  - 기본 운영 모드
- `deep`
  - 더 작은 청크: 약 4200~6000자
  - 더 큰 토큰 한도
  - 추가 인사이트 필드 생성
  - 결과 파일:
    - `reports/merged/final_market_view.deep.md`
    - `reports/merged/final_market_view.deep.json`

## 4. 구현된 코드 위치

- 엔트리포인트
  - `scripts/run-local-report-orchestrator.sh`
  - `scripts/run_local_report_orchestrator.py`
- 핵심 로직
  - `scripts/report_orchestrator/pipeline.py`
  - `scripts/report_orchestrator/llm.py`
  - `scripts/report_orchestrator/text_processing.py`
  - `scripts/report_orchestrator/config.py`
  - `scripts/report_orchestrator/power.py`
- 설정
  - `config/local-report-orchestrator.json`
- 기존 설명 문서
  - `docs/LOCAL_PDF_LLM_ORCHESTRATOR.md`

## 5. 현재 검증된 상태

- `standard` 모드는 실제 샘플 처리 성공
- `deep` 모드 추가 완료
- `report_015` 대형 문서 테스트 성공
  - 전처리 후 약 101,917자
  - 14 chunks
  - 실제 chunk 요약과 병합 요약 실행 성공
  - 결과 파일:
    - `reports/ad_hoc_chunk_test/2026-04-14/report_015.merged_summary.json`
- Windows LLM 연동은 실제 응답까지 검증됨
- WOL은 Windows sleep 상태에서 정상 동작함
- 완전 종료(S5) 상태에서는 WOL이 불안정하거나 실패할 수 있음
- shutdown 자동화는 아직 신뢰 가능한 원격 종료 경로가 부족함

현재 권장 전원 전략:

- wake = WOL
- stop = manual or separate future work
- full shutdown automation = not yet reliable

## 6. 운영 규칙

- `localhost` / `127.0.0.1` 사용 금지
- 항상 `http://192.168.0.218:8080/v1` 사용
- Windows llama-server는 OpenAI-compatible API로 사용하지만, OpenAI 전용/비표준 파라미터를 모두 지원하지는 않는다
- local llama-server 호출 시 unsupported 파라미터를 절대 보내지 말 것
  - 특히 `prompt_cache_retention` 금지
- 현재 허용/유지 기준
  - `response_format`
  - `chat_template_kwargs: {"enable_thinking": false}`
- merge 출력이 과도하게 길어지지 않도록 `max_tokens`와 각 필드 리스트 제한을 유지한다

## 7. 알려진 이슈

- chat/session compact 단계에서 `prompt_cache_retention` 파라미터로 `invalid_request_error`가 발생할 수 있음
- 이 문제는 현재 repo pipeline 자체보다는 대화/remote compact 계층 문제에 더 가깝다
- 절전 복귀 후 Windows 시작프로그램은 다시 실행되지 않을 수 있음
- 따라서 sleep/wake 이후 llama-server 자동 가동 보장은 별도 전략이 필요함
- 현재 운영 전제는 다음 둘 중 하나다
  - Windows가 이미 켜져 있고 서버가 올라와 있음
  - 명시적으로 wake 후 서버 응답을 다시 확인함
- `run-daily-automation-cycle.js`는 더 이상 리포트 수집 네트워크만 보고 baseline을 사전 차단하지 않는다
  - `scripts/check-automation-readiness.js`가 이전 거래일 `data/reports/YYYY-MM-DD` fallback 자산을 찾으면 `reportCollectionReady=true`로 간주한다
  - 즉, 네트워크 일시 장애가 있어도 직전 거래일 리포트 번들이 있으면 baseline은 실제 `run-daily-system.sh` fallback 로직까지 진행시켜야 한다
- 현재 아침 자동화의 가장 취약한 구간은 Gemini Deep Research Web이다
  - 2026-04-15 재실행에서도 readiness, baseline, Stage 1~4, wiki, dashboard build는 복구됐지만 web deep research 단계는 장시간 대기 병목이 남아 있었다

## 8. 다음 우선순위

1. sleep 복귀 시 llama-server availability 보장 전략 확정
2. Gemini Deep Research Web 장시간 대기 시 skip/reuse/fallback 정책 추가
3. deep mode 출력 정규화 개선
4. `company_watch` / `company_mentions`를 DB 친화적 structured object로 개선
5. `confidence`, `source_chunks` 같은 provenance 필드 추가
6. optional remote shutdown path (`SSH` or agent) later

## 9. 다음 세션이 바로 알아야 할 것

- 이 시스템은 Mac Mini에서 실행되고, 실제 추론은 Windows LLM 서버가 담당한다
- 서버 주소는 항상 `http://192.168.0.218:8080/v1`다
- 긴 PDF는 반드시 청크 처리 후 구조화 요약을 병합한다
- raw PDF direct input은 금지다
- 현재 실운영에 가까운 전원 전략은 WOL 기반 wake만 자동화하고 종료는 자동화하지 않는 것이다
- 다음 세션 시작 시 `docs/SESSION_HANDOFF.md`와 `docs/RUNBOOK.md`를 함께 확인하면 된다
