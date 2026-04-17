# EcoReport Multi-Tool Handoff

> **실행 진입점 → [`docs/EXECUTION_GUIDE.md`](EXECUTION_GUIDE.md)**

## 목적

Codex, Cursor, Claude, 터미널 세션 등 여러 도구가 같은 저장소를 번갈아 만질 때 충돌과 맥락 손실을 줄이기 위한 공통 규칙입니다.

핵심 원칙은 하나입니다.

- 채팅 맥락은 휘발되지만
- 저장소 문서와 날짜별 산출물은 남습니다.

그래서 handoff는 항상 파일 기준으로 남겨야 합니다.

## 공통 운영 원칙

### 1. 날짜를 항상 명시한다

- 상대 날짜 대신 `YYYY-MM-DD`를 사용합니다.
- 실행일과 시장 기준일이 다를 수 있으므로 필요하면 둘 다 기록합니다.

예:

- `--date 2026-04-03`
- `--run-date 2026-04-06`
- `--effective-market-date 2026-04-03`

### 2. 생성 파일은 직접 고치기보다 다시 생성한다

가능하면 아래 파일은 수동 편집보다 스크립트 재실행을 우선합니다.

- `data/analysis-state/YYYY-MM-DD/*`
- `knowledge/daily/YYYY-MM-DD*`
- `reports/daily/YYYY-MM-DD*`
- `knowledge/wiki/*`

예외:

- `manual-kit/` 응답 저장
- 운영 중 메모성 보강 문서

### 3. 시작 전에 상태 파일을 먼저 읽는다

새 세션이 시작되면 먼저 아래를 확인합니다.

1. `git branch --show-current`
2. `git status --short`
3. `data/analysis-state/YYYY-MM-DD/automation-cycle.json`
4. `knowledge/daily/YYYY-MM-DD-automation-cycle.md`
5. `data/analysis-state/YYYY-MM-DD/system-health.json`

### 4. 흐름을 바꾸면 문서도 같이 바꾼다

아래가 바뀌면 문서 갱신이 필수입니다.

- 새 stage 추가
- 실행 명령 변경
- 산출물 경로 변경
- 실패 로그 위치 변경
- 자동화 조건 변경

최소 업데이트 대상:

- `README.md`
- `docs/OPERATOR_RUNBOOK.md`
- 필요 시 `docs/EXPERIMENT_PLAYBOOK.md`
- 필요 시 `docs/UPDATE_LOG.md`

### 5. 실패는 채팅이 아니라 파일에 남긴다

채팅으로만 “실패했다”라고 남기면 다음 도구가 이어받기 어렵습니다.

우선 기록할 곳:

- `data/analysis-state/YYYY-MM-DD/automation-cycle.json`
- `knowledge/daily/YYYY-MM-DD-automation-cycle.md`
- `logs/*.log`

장기적으로 기억할 만한 실패 패턴은:

- `FAILURES_AND_FALLBACKS.md`

## 역할별 시작 순서

### 운영/실행 담당

1. `docs/DOCS_MAP.md`
2. `docs/OPERATOR_RUNBOOK.md`
3. `docs/EXPERIMENT_PLAYBOOK.md`

### UI/대시보드 담당

1. `README.md`
2. `docs/MULTI_TOOL_HANDOFF.md`
3. 관련 화면과 데이터 로더 파일
4. 최근 `knowledge/daily/YYYY-MM-DD-gemini-briefing-rich.md`

### 디버깅 담당

1. `docs/MULTI_TOOL_HANDOFF.md`
2. `FAILURES_AND_FALLBACKS.md`
3. 해당 날짜 `automation-cycle` / `system-health`
4. 관련 `logs/*.log`

## 충돌 줄이는 규칙

### 1. 같은 파일을 동시에 오래 붙잡지 않는다

충돌이 자주 나는 파일:

- `README.md`
- `docs/OPERATOR_RUNBOOK.md`
- `dashboard/app/page.tsx`
- `dashboard/lib/research.ts`
- `scripts/run-daily-automation-cycle.js`

이 파일을 만질 때는 짧게 끝내고 바로 커밋하는 편이 좋습니다.

### 2. 큰 변경은 브랜치에서 끝낸 뒤 `main`으로 올린다

권장:

- 실험/개발은 작업 브랜치
- 검증 후 `main`으로 fast-forward 또는 머지

### 3. 세션 종료 전에 다음 사람이 바로 이해할 상태로 만든다

최소 조건:

- `git status` 깨끗함
- 커밋 메시지 존재
- 문서 링크 깨지지 않음
- 필요 시 `UPDATE_LOG` 반영

## Safari / Gemini 관련 주의

Gemini Deep Research는 일반 스크립트보다 운영 전제가 많습니다.

- Mac이 잠겨 있으면 실패할 수 있습니다.
- Safari 로그인이 풀리면 실패할 수 있습니다.
- DOM 변경이 있으면 자동화가 흔들릴 수 있습니다.

그래서 이 단계는 항상 아래 파일로 성공/실패를 확인합니다.

- `knowledge/daily/manual-kit/YYYY-MM-DD/07-stage1-5-gemini-deep-research-prompt.md`
- `knowledge/daily/manual-kit/YYYY-MM-DD/09-stage1-5-gemini-deep-research-response.md`
- `knowledge/daily/YYYY-MM-DD-gemini-briefing-rich.md`

## 세션 시작 체크리스트

- 현재 브랜치를 확인했다.
- 오늘 작업 날짜를 정했다.
- 최신 `automation-cycle`과 `system-health`를 읽었다.
- 이미 생성된 산출물을 확인했다.
- 내가 수정할 파일과 목적을 정했다.

## 세션 종료 체크리스트

- 변경사항을 커밋했다.
- 필요하면 원격 브랜치 또는 `main`에 푸시했다.
- 실행 흐름 변경 시 문서를 갱신했다.
- 실패가 있으면 파일 기반 로그를 남겼다.
- 다음 사람이 봐야 할 핵심 파일 경로를 남겼다.

## handoff 메모에 꼭 들어가야 할 것

- 작업 날짜
- 실행한 명령
- 성공한 단계
- 실패한 단계
- 생성된 핵심 산출물 경로
- 다음 사람이 먼저 볼 파일
