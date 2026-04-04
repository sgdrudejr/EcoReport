# 2026-04-03 수동 GPT 질문 패키지

이 폴더는 2026-04-03 기준 EcoReport 수동 연구용 프롬프트 묶음입니다.

## 목표
- 이번 단계에서는 내가 직접 GPT 웹/앱에 질문합니다.
- Codex는 자동 제출/자동 저장을 하지 않습니다.
- GPT 답변을 내가 복사해서 다시 전달하면, 그다음 단계(저장/반영/점검)는 Codex가 이어받습니다.

## 질문 순서
1. `01-triage-prompt.md`
2. `03-report_001-deep-extract.md`
3. `04-synthesis-prompt.md`
4. `05-portfolio-coach-prompt.md`
5. `06-advisory-prompt.md`

`02-report-summary-queue.md` 는 참고용 큐 문서입니다.

## 권장 운영
- 오늘은 리포트가 1건뿐이라 triage는 사실상 확인 단계입니다.
- 실제 핵심은 `03-report_001-deep-extract.md` 입니다.
- 그 답변을 받은 뒤 `04-synthesis-prompt.md` 로 종합 시황을 만들고,
- 마지막에 `05`와 `06`으로 내 포트폴리오 운용 가이드를 받습니다.

## 나한테 다시 보내줄 답변
- 최소 필수:
  - `03-report_001-deep-extract.md` 에 대한 GPT 답변
  - `04-synthesis-prompt.md` 에 대한 GPT 답변
  - `06-advisory-prompt.md` 에 대한 GPT 답변
- 가능하면 추가:
  - `05-portfolio-coach-prompt.md` 답변

## 주의
- `03-report_001-deep-extract.md` 는 JSON만 받는 프롬프트입니다.
- 나머지 파일은 마크다운/서술형 답변을 받아도 됩니다.
- GPT가 너무 짧게 답하면, "더 구체적으로 내 포트폴리오 관점에서 설명해줘"를 한 번 더 붙여도 됩니다.
