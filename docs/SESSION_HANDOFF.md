# SESSION_HANDOFF

다음 세션의 Codex는 먼저 `docs/PROJECT_MEMORY.md`를 읽고, 그 다음 이 문서를 읽는다. 대화 메모리에 의존하지 않는다.

## 현재 상태 한 줄 요약

Mac Mini가 PDF 오케스트레이션을 담당하고, Windows PC의 로컬 llama-server가 실제 추론을 담당하는 구조는 동작 확인이 끝났다. 표준 모드는 실배치 성공, deep 모드는 구현 완료 및 대형 문서 ad hoc 검증 성공 상태다.

## 2026-04-17 Workspace Consolidation

오늘 반영/확정된 내용:

- 기준 루트를 `/Users/seo/Documents/Playground/economy-report`로 통일
- `open-trading-api/`를 기준 루트 안으로 이동
- 보조 worktree를 `economy-report-main-merge`, `economy-report-main-publish`로 정리하고 git worktree 포인터를 복구
- 기존 `/Users/seo/stock-pilot` 체크아웃은 `/Users/seo/Documents/Playground/stock-pilot-archive`로 보관
- README / AGENTS / CLAUDE / EXECUTION_GUIDE / DOCS_MAP / MULTI_TOOL_HANDOFF의 절대경로와 handoff 기준을 새 루트로 정리

다음 세션 시작 권장 순서:

1. `README.md`
2. `docs/EXECUTION_GUIDE.md`
3. `docs/MULTI_TOOL_HANDOFF.md`
4. 필요하면 archive와 비교

## 2026-04-15 Handoff

오늘 반영/확정된 내용:

- deep 모드 추가 완료
  - `--detail deep`로 더 작은 청크, 더 큰 토큰 한도, 더 풍부한 인사이트 필드 생성
- `report_015` 대형 문서 테스트 성공
  - 전처리 후 약 101,917자
  - 14 chunks
  - chunk 요약과 병합 요약 모두 성공
  - 산출물: `reports/ad_hoc_chunk_test/2026-04-14/report_015.merged_summary.json`
- WOL 구현 및 검증 완료
  - Windows sleep 상태에서 정상 wake 확인
  - `wakeonlan` 명령과 magic packet 폴백 모두 경로가 있음
- full shutdown automation은 보류
  - 신뢰 가능한 원격 종료 경로가 아직 부족함
  - 운영 기본 전략은 `wake만 자동`, `stop은 수동 또는 추후 과제`
- local llama-server unsupported parameter 이슈 정리
  - `prompt_cache_retention`는 보내면 안 됨
  - 보인 에러는 repo pipeline보다 상위 대화/compact 계층 문제에 더 가까움
- Windows LLM 실제 응답 검증 완료
  - `http://192.168.0.218:8080/v1`에서 실제 요약 응답 확인

## 다음 세션이 바로 할 일

우선순위:

1. sleep 복귀 시 llama-server availability 보장 전략을 확정한다
2. deep mode 출력 정규화를 다듬는다
3. `company_watch` / `company_mentions`를 DB 친화적인 structured object로 개선한다
4. `confidence`, `source_chunks` 같은 provenance 필드를 추가한다
5. optional remote shutdown path는 나중 단계로 남긴다

## 다음 세션 시작 권장 순서

1. `docs/PROJECT_MEMORY.md` 확인
2. `docs/RUNBOOK.md`에서 연결 테스트 명령 재실행
3. `config/local-report-orchestrator.json`과 `scripts/report_orchestrator/llm.py`를 보고 base URL/파라미터 규칙이 유지되는지 확인
4. 필요하면 `--date 2026-04-14 --limit 1` 또는 `--detail deep`로 짧은 회귀 실행

## 주의사항

- `localhost` / `127.0.0.1` 금지
- 항상 `http://192.168.0.218:8080/v1` 사용
- raw PDF를 통째로 LLM에 넣지 않는다
- merge 단계에는 chunk 원문이 아니라 chunk summary JSON만 넣는다
- shutdown 자동화는 현재 신뢰 가능한 운영 경로가 아니다
