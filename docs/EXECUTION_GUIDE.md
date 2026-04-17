# EcoReport Execution Guide

이 문서는 Claude Code, Codex, 터미널 세션이 같은 저장소를 함께 다룰 때 가장 먼저 보는 공용 실행 가이드입니다.

핵심 원칙은 두 가지입니다.

- 역할 설명보다 `무엇을 하려는지`에 따라 진입 명령을 고릅니다.
- 흐름이 바뀌면 코드와 함께 `README.md`, 이 문서, 필요한 runbook를 같이 갱신합니다.

## 먼저 확인할 것

세션을 시작하면 아래부터 확인합니다.

```bash
cd /Users/seo/stock-pilot
git branch --show-current
git status --short
```

오늘 작업 날짜가 정해졌다면 아래도 같이 봅니다.

```bash
ls data/analysis-state/YYYY-MM-DD
ls knowledge/daily | rg YYYY-MM-DD
```

주의:

- 운영 스크립트는 `scripts/` 아래 현재 파일을 기준으로 씁니다.
- `scripts/_archive/`는 참고용입니다. 현행 워크플로우 문서에 기본 명령으로 적지 않습니다.

## 작업별 바로 가기

### 1. 일일 전체 파이프라인을 처음부터 돌린다

가장 표준적인 명령:

```bash
cd /Users/seo/stock-pilot
bash scripts/run-daily-system.sh --date YYYY-MM-DD
node scripts/verify-daily-system.js --date YYYY-MM-DD
```

필요하면 먼저 포트폴리오를 동기화합니다.

```bash
cd /Users/seo/stock-pilot
npm run portfolio:sync:kis -- --date YYYY-MM-DD
```

주요 산출물:

- `data/reports/YYYY-MM-DD/`
- `data/analysis-state/YYYY-MM-DD/`
- `reports/daily/YYYY-MM-DD-briefing.md`
- `knowledge/wiki/daily/YYYY-MM-DD.md`

### 2. 수동 LLM용 재료만 준비한다

ChatGPT, Claude Code, Codex, 로컬 LLM으로 사람이 직접 이어서 읽고 판단하려면 이 모드를 먼저 실행합니다.

신규 수집까지 같이 할 때:

```bash
cd /Users/seo/stock-pilot
bash scripts/run-cycle.sh --date YYYY-MM-DD --manual-llm
```

이미 수집이 끝났고 프롬프트만 다시 만들 때:

```bash
cd /Users/seo/stock-pilot
bash scripts/run-cycle.sh --date YYYY-MM-DD --manual-llm --skip-collect
```

이 명령이 준비하는 것:

- `knowledge/daily/YYYY-MM-DD-report-summary-queue.json`
- `knowledge/daily/YYYY-MM-DD-report-summary-queue.md`
- `knowledge/daily/report-prompts/YYYY-MM-DD/report_XXX.md`
- `knowledge/daily/YYYY-MM-DD-report-triage-prompt.md`
- `knowledge/daily/YYYY-MM-DD-synthesis-prompt.md`
- `reports/daily/YYYY-MM-DD-portfolio-coach-prompt.md`
- `reports/daily/YYYY-MM-DD-*-advisory-prompt.md`
- `reports/daily/YYYY-MM-DD-*-briefing.md` 또는 manual advisory queue

### 3. 수동 PDF 요약 스프린트를 이어서 진행한다

진행 순서는 보통 아래를 씁니다.

1. 큐/선별 판단
2. 개별 PDF 깊은 추출
3. 시황 synthesis
4. portfolio coach
5. advisory briefing

ChatGPT 웹에 바로 열 때:

```bash
cd /Users/seo/stock-pilot
bash scripts/open-chatgpt-web-prompt.sh queue
bash scripts/open-chatgpt-web-prompt.sh triage
bash scripts/open-chatgpt-web-prompt.sh file /Users/seo/stock-pilot/knowledge/daily/report-prompts/YYYY-MM-DD/report_001.md
bash scripts/open-chatgpt-web-prompt.sh synthesis
bash scripts/open-chatgpt-web-prompt.sh coach
bash scripts/open-chatgpt-web-prompt.sh advisory
```

자동 저장이 실패했을 때 수동 저장:

```bash
cd /Users/seo/stock-pilot
bash scripts/save-chatgpt-report-response.sh YYYY-MM-DD report_001
bash scripts/save-chatgpt-markdown-response.sh /Users/seo/stock-pilot/knowledge/daily/YYYY-MM-DD-synthesis.md
bash scripts/save-chatgpt-markdown-response.sh /Users/seo/stock-pilot/reports/daily/YYYY-MM-DD-portfolio-coach.md
```

이 단계에서 가장 중요한 누적 파일:

- `data/reports/YYYY-MM-DD/manual-compressed.json`
- `knowledge/daily/YYYY-MM-DD-report-triage-response.md`
- `knowledge/daily/YYYY-MM-DD-synthesis.md`
- `reports/daily/YYYY-MM-DD-portfolio-coach.md`
- `reports/daily/YYYY-MM-DD-briefing.md`

### 4. 딥리서치만 돌린다

Gemini Deep Research 흐름은 `manual-kit` 아래에 저장됩니다.

프롬프트만 다시 만들 때:

```bash
cd /Users/seo/stock-pilot
node scripts/build-stage1-5-gemini-deep-research-prompt.js --date YYYY-MM-DD
```

Safari/Gemini Web까지 붙여 실제 응답을 받을 때:

```bash
cd /Users/seo/stock-pilot
node scripts/run-gemini-deep-research-web.js --date YYYY-MM-DD
node scripts/build-stage1-6-rich-briefing.js --date YYYY-MM-DD
```

추가 refinement 라운드가 필요하면:

```bash
cd /Users/seo/stock-pilot
node scripts/build-stage1-7-followup-research-map.js --date YYYY-MM-DD
node scripts/build-stage1-7-gemini-follow-up-prompt.js --date YYYY-MM-DD
```

주요 산출물:

- `knowledge/daily/manual-kit/YYYY-MM-DD/07-stage1-5-gemini-deep-research-prompt.md`
- `knowledge/daily/manual-kit/YYYY-MM-DD/09-stage1-5-gemini-deep-research-response.md`
- `knowledge/daily/manual-kit/YYYY-MM-DD/10-stage1-6-final-research-briefing.md`
- 필요 시 `11~16 stage1-7/stage1-8` refinement 파일

### 5. Stage 1~4 전략 파이프라인만 다시 돌린다

Stage 2 공급자를 바꿔 재실행할 때 이 명령을 씁니다.

```bash
cd /Users/seo/stock-pilot
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD --claude-stage2
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD --gemini-stage2
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD --mock-stage2
```

이 흐름에서 먼저 볼 파일:

- `knowledge/daily/manual-kit/YYYY-MM-DD/08-stage2-strategy-prompt.md`
- `data/analysis-state/YYYY-MM-DD/stage2-run-log.json`
- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`

### 6. 검증과 handoff만 한다

```bash
cd /Users/seo/stock-pilot
node scripts/verify-daily-system.js --date YYYY-MM-DD
```

세션 종료 전 확인:

- 실행 명령이 문서와 일치하는가
- 새 산출물 경로가 README/runbook에 반영되었는가
- 실패가 채팅에만 남지 않고 파일에도 남았는가

## 산출물 위치 감각

각 디렉터리는 아래처럼 생각하면 덜 헷갈립니다.

- `data/reports/YYYY-MM-DD/`: 원본 리포트, 텍스트, 수동 압축 JSON
- `data/analysis-state/YYYY-MM-DD/`: Stage 1~4와 검증 JSON
- `knowledge/daily/`: 날짜별 working memory와 프롬프트
- `knowledge/daily/manual-kit/YYYY-MM-DD/`: deep research/manual refinement 전용
- `knowledge/daily/report-prompts/YYYY-MM-DD/`: 개별 PDF 추출 프롬프트
- `reports/daily/`: 사람이 읽는 briefing, coach, advisory 결과
- `knowledge/wiki/`: 장기 기억과 누적 결론

## Claude Code / Codex 공통 규칙

- 작업을 시작하기 전에 `README.md`, 이 문서, `docs/MULTI_TOOL_HANDOFF.md`를 먼저 읽습니다.
- 새 워크플로우를 invent하지 말고 기존 진입 스크립트를 재사용합니다.
- durable insight가 생기면 `knowledge/wiki/`에 남깁니다.
- 흐름이 바뀌면 `README.md`, `docs/DOCS_MAP.md`, 필요 시 `docs/OPERATOR_RUNBOOK.md`까지 같이 갱신합니다.
- handoff는 채팅이 아니라 파일 경로와 명령 기준으로 남깁니다.

## handoff 템플릿

아래 형식이면 다음 도구가 바로 이어받기 쉽습니다.

```text
date: YYYY-MM-DD
run_date: YYYY-MM-DD
branch: <git branch>
commands:
  - bash scripts/run-cycle.sh --date YYYY-MM-DD --manual-llm --skip-collect
  - node scripts/run-gemini-deep-research-web.js --date YYYY-MM-DD
completed:
  - report queue
  - manual-compressed.json
  - deep research response
blocked:
  - stage2 rerun not started
read-first:
  - knowledge/daily/YYYY-MM-DD-report-summary-queue.md
  - knowledge/daily/manual-kit/YYYY-MM-DD/09-stage1-5-gemini-deep-research-response.md
  - data/analysis-state/YYYY-MM-DD/stage2-run-log.json
```
