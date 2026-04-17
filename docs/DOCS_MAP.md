# EcoReport Docs Map

## 목적

EcoReport 문서가 늘어나도, 새 담당자나 다른 코딩 프로그램이 바로 올바른 문서로 들어오게 만드는 진입 지도입니다.

이 문서는 아래 질문에 답합니다.

- 지금 어떤 문서를 먼저 읽어야 하는가
- 지금 하려는 작업에 맞는 지침서는 무엇인가
- 어떤 파일이 실제 소스 오브 트루스인가

## 🚀 단일 진입점

**실행과 관련된 모든 것은 먼저 여기를 보세요:**

→ **[`docs/EXECUTION_GUIDE.md`](EXECUTION_GUIDE.md)** — 일일 파이프라인 · LLM 준비 · StockEasy · 딥리서치 · 검증 모두 수록

StockPilot 전용 설계/로드맵 문서는 여기서 시작합니다:

→ **[`docs/stockpilot/README.md`](stockpilot/README.md)** — 에이전트 브리프 · 데이터 스펙 · 갭 분석 · 마스터 플레이북 진입점

기준 워크스페이스는 `/Users/seo/Documents/Playground/economy-report`이며, `/Users/seo/Documents/Playground/stock-pilot-archive`는 참고용 archive입니다.

## 5분 시작 순서

새로 들어온 사람이나 에이전트는 보통 아래 순서로 읽으면 됩니다.

1. `docs/EXECUTION_GUIDE.md` ← **여기서 시작**
2. `README.md`
3. `docs/PIPELINE_MAP.md`
4. `docs/MULTI_TOOL_HANDOFF.md`
5. `docs/OPERATOR_RUNBOOK.md`
6. 작업 성격에 따라 아래 문서 추가

## 작업별 문서 라우팅

### 1. 프로젝트 전체 구조를 이해하고 싶다

읽을 문서:

- `README.md`
- `docs/PIPELINE_MAP.md`
- `docs/STAGE_1_4_ARCHITECTURE.md`

이 문서들이 답하는 것:

- 파이프라인 전체 흐름을 쉬운 말로 보면 어떤 구조인가
- 파이프라인 전체 단계
- 핵심 산출물
- 대시보드와 백엔드의 연결 구조

### 2. 오늘 파이프라인을 실제로 돌리고 싶다

읽을 문서:

- `docs/OPERATOR_RUNBOOK.md`
- `docs/EXPERIMENT_PLAYBOOK.md`

이 문서들이 답하는 것:

- 어떤 명령을 쳐야 하는가
- 성공/실패를 어디서 확인하는가
- 어떤 파일이 생겨야 완료로 볼 수 있는가

### 3. Gemini Deep Research를 끼워 넣고 싶다

읽을 문서:

- `docs/OPERATOR_RUNBOOK.md`
- `docs/EXPERIMENT_PLAYBOOK.md`
- `FAILURES_AND_FALLBACKS.md`

이 문서들이 답하는 것:

- Stage 1.5 / 1.6 실행 순서
- Safari/Gemini 전제 조건
- 실패 시 어디를 봐야 하는가

### 4. 여러 코딩 프로그램이 번갈아 작업한다

읽을 문서:

- `docs/MULTI_TOOL_HANDOFF.md`
- `docs/UPDATE_LOG.md`

이 문서들이 답하는 것:

- 세션 시작 전 무엇을 확인해야 하는가
- 어디까지 작업됐는지 어떻게 이어받는가
- 문서와 로그를 어떻게 남겨야 하는가

### 5. 실패 원인을 디버깅하고 싶다

읽을 문서:

- `FAILURES_AND_FALLBACKS.md`
- `docs/OPERATOR_RUNBOOK.md`
- 해당 날짜의 `automation-cycle` / `system-health`

먼저 볼 파일:

- `data/analysis-state/YYYY-MM-DD/automation-cycle.json`
- `knowledge/daily/YYYY-MM-DD-automation-cycle.md`
- `data/analysis-state/YYYY-MM-DD/system-health.json`
- `knowledge/daily/YYYY-MM-DD-system-health.md`
- `logs/*.log`

### 6. LLM Wiki가 어떻게 누적되는지 알고 싶다

읽을 문서:

- `docs/LLM_WIKI_SYSTEM.md`
- `docs/OPERATOR_RUNBOOK.md`

### 7. 점수와 추천 로직을 수정하고 싶다

읽을 문서:

- `docs/SCORE_SYSTEM_V2.md`
- `docs/STAGE_1_4_ARCHITECTURE.md`

### 8. 데이터 구조와 파이프라인 자체를 고도화하고 싶다

읽을 문서:

- `docs/DATA_ARCHITECTURE_V2.md`
- `docs/STAGE_1_4_ARCHITECTURE.md`
- `docs/stockpilot/stockpilot_master_playbook.md`
- `docs/stockpilot/stockpilot_data_spec.md`
- `docs/stockpilot/stockpilot_v1_gap_analysis.md`
- `docs/schemas/normalized-observations.schema.json`
- `docs/schemas/evidence-graph.schema.json`
- `docs/schemas/decision-features.schema.json`

이 문서들이 답하는 것:

- raw source를 어떤 공통 모델로 올릴지
- evidence graph를 어떻게 정의할지
- Stage 2를 evidence와 policy로 어떻게 분리할지
- StockPilot v1.0 -> v2.0 로드맵을 어떤 순서로 밟아야 하는지
- 결정론적 수식 스펙과 데이터 계약의 차이가 어디인지

## 소스 오브 트루스

### 코드

- `scripts/`: 파이프라인과 자동화 실행
- `dashboard/`: 로컬 대시보드 UI
- `prompts/`: LLM 프롬프트 템플릿

### 날짜별 산출물

- `data/analysis-state/YYYY-MM-DD/`: Stage 1~4, 검증, 자동화 상태
- `data/reports/YYYY-MM-DD/`: 리포트 원본, 메타데이터, 텍스트화 결과
- `knowledge/daily/`: 일일 브리핑, 리서치 메모, 자동화 요약
- `reports/daily/`: 최종 브리핑과 실행 계획

### 누적 기억

- `knowledge/wiki/`: 장기 누적 투자 위키
- `docs/UPDATE_LOG.md`: 구조 변화와 운영 변화 이력

## 세션 시작 전에 확인할 것

1. 현재 브랜치와 `git status`
2. 오늘 작업 날짜 `YYYY-MM-DD`
3. 최신 `automation-cycle` / `system-health`
4. 이미 생성된 `knowledge/daily/`와 `reports/daily/` 산출물
5. 내가 건드릴 문서와 스크립트의 역할

## 세션 종료 전에 남길 것

1. 바뀐 코드/문서 커밋
2. 흐름이 바뀌었으면 `README.md` 또는 해당 운영 문서 갱신
3. 운영 변화가 있으면 `docs/UPDATE_LOG.md`에 기록
4. 실패가 있으면 해당 날짜 `automation-cycle` 또는 `FAILURES_AND_FALLBACKS.md`에 맥락 남기기

## 추천 읽기 조합

### 빠르게 기능만 고치고 싶을 때

- `README.md`
- `docs/MULTI_TOOL_HANDOFF.md`
- 관련 코드 파일

### 운영까지 책임져야 할 때

- `README.md`
- `docs/DOCS_MAP.md`
- `docs/OPERATOR_RUNBOOK.md`
- `docs/EXPERIMENT_PLAYBOOK.md`
- `FAILURES_AND_FALLBACKS.md`

### 다른 툴이 남긴 작업을 이어받을 때

- `docs/MULTI_TOOL_HANDOFF.md`
- `docs/UPDATE_LOG.md`
- 해당 날짜 `automation-cycle` / `system-health`
