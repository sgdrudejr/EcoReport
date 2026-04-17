# EcoReport Docs Map

이 문서는 “지금 어떤 문서를 먼저 보면 되는가”를 빠르게 정리한 진입 지도입니다.

## 1차 문서

항상 먼저 보는 문서입니다.

| 문서 | 용도 |
|---|---|
| `README.md` | 프로젝트 개요, 최신 실행 명령, 공용 진입점 |
| `docs/EXECUTION_GUIDE.md` | 작업별 실행 가이드와 명령 모음 |
| `docs/REPO_STRUCTURE.md` | 실제 로컬 파일 구조와 디렉터리 역할 |
| `docs/OPERATOR_RUNBOOK.md` | 실제 운영 절차 |
| `docs/STAGE_1_4_ARCHITECTURE.md` | Stage / feedback / intraday / storage 구조 |
| `docs/SCORE_SYSTEM_V2.md` | Stage 3 점수 체계와 피드백 반영 원리 |

## 2차 문서

상황에 따라 읽는 문서입니다.

| 문서 | 언제 읽나 |
|---|---|
| `dashboard/README.md` | 대시보드 라우트, app/components 구조를 볼 때 |
| `docs/EXPERIMENT_PLAYBOOK.md` | 실험, 회귀, 검증 체크리스트가 필요할 때 |
| `docs/UPDATE_LOG.md` | 최근 구조 변경을 확인할 때 |
| `docs/LLM_WIKI_SYSTEM.md` | wiki 메모리 레이어를 손볼 때 |
| `FAILURES_AND_FALLBACKS.md` | 장애/폴백 케이스를 추적할 때 |

## 3차 문서

지속 운영에는 필요하지만 모든 세션에서 읽을 필요는 없는 문서입니다.

| 문서 | 성격 |
|---|---|
| `docs/MULTI_TOOL_HANDOFF.md` | 여러 에이전트/도구 handoff 규칙 |
| `docs/PRIVATE_ACCESS_RUNBOOK.md` | private access 운영 참고 |
| `docs/VERCEL_DEPLOY_RUNBOOK.md` | 보조 배포 채널 참고 |
| `docs/STAGE2_LLM_PROVIDER.md` | Stage 2 공급자 세부 |
| `docs/rules/*` | 운영 철학과 품질 룰 |

## 작업별 라우팅

### 운영만 빨리 돌리고 싶다

1. `README.md`
2. `docs/EXECUTION_GUIDE.md`
3. `docs/OPERATOR_RUNBOOK.md`

### 저장소 구조를 정확히 보고 싶다

1. `docs/REPO_STRUCTURE.md`
2. `README.md`

### 딥리서치나 manual-kit 흐름을 이어서 하고 싶다

1. `docs/EXECUTION_GUIDE.md`
2. `docs/MULTI_TOOL_HANDOFF.md`
3. `knowledge/daily/manual-kit/YYYY-MM-DD/*`

### 수동 LLM 스프린트 명령만 빨리 찾고 싶다

1. `docs/EXECUTION_GUIDE.md`
2. `README.md`

### 점수나 실행 로직을 바꾸고 싶다

1. `docs/STAGE_1_4_ARCHITECTURE.md`
2. `docs/SCORE_SYSTEM_V2.md`
3. 관련 `scripts/`

### Intraday / 알림 / Telegram을 손보고 싶다

1. `docs/STAGE_1_4_ARCHITECTURE.md`
2. `scripts/run-intraday-alert-pipeline.js`
3. `scripts/evaluate-alert-triggers.js`
4. `scripts/send-telegram-summary.js`

### 대시보드 노출 구조를 바꾸고 싶다

1. `dashboard/README.md`
2. `dashboard/app/page.tsx`
3. `dashboard/app/components/*`
4. `dashboard/components/*`

### 피드백 루프 / challenger / ghost를 건드리고 싶다

1. `docs/STAGE_1_4_ARCHITECTURE.md`
2. `docs/SCORE_SYSTEM_V2.md`
3. `scripts/build-feedback-*.js`
4. `scripts/auto-tune-challenger.js`
5. `scripts/backtest-challenger.js`
6. `scripts/build-ghost-portfolio.js`

### 위키 / 메모리 / 브리핑 충실도를 손보고 싶다

1. `docs/LLM_WIKI_SYSTEM.md`
2. `scripts/build-llm-wiki.js`
3. `scripts/build-stage1-6-rich-briefing.js`
4. `scripts/build-stage2-strategy-prompt.js`
5. `scripts/validate-briefing-fidelity.js`

## 소스 오브 트루스

### 코드

- `scripts/`: 운영 파이프라인과 데이터 산출
- `dashboard/`: 로컬 UI와 서버 렌더링 대시보드
- `config/`: 전략/배분/계약/DAG/알림 설정

### 날짜별 산출물

- `data/analysis-state/YYYY-MM-DD/`
- `data/intraday/`
- `data/feedback/`
- `reports/daily/`
- `knowledge/daily/`

### 누적 기억

- `knowledge/wiki/`
- `data/timeseries.db`

## 세션 시작 체크리스트

1. `git status`
2. `docs/EXECUTION_GUIDE.md`에서 오늘 작업 경로 확인
3. 오늘 기준 `data/analysis-state/YYYY-MM-DD`
4. 최신 `data/intraday/latest.json` 필요 여부
5. 최신 `reports/daily`와 `knowledge/daily`
6. 문서 변경이 필요한지 여부

## 세션 종료 체크리스트

1. 바뀐 코드와 문서가 일치하는지 확인
2. 운영 흐름이 바뀌었으면 `README` 또는 `RUNBOOK`, `EXECUTION_GUIDE` 갱신
3. 구조 변화가 있으면 `REPO_STRUCTURE` 또는 `ARCHITECTURE` 갱신

## 정리 원칙

- 진입 문서는 적게 유지합니다.
- 구조 설명은 코드 기준으로 유지합니다.
- 코드와 어긋난 설명은 남기지 않습니다.
