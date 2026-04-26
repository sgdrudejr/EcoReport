# EcoReport Experiment Playbook

## 목적

EcoReport 실험은 “한 번 돌려봤다”에서 끝나면 안 됩니다.

이 문서는 실험을 아래처럼 반복 가능하게 만들기 위한 운영 규칙입니다.

- 어떤 명령을 실행했는가
- 무엇을 성공으로 볼 것인가
- 실패하면 어디에 기록할 것인가
- 다음 실험이 무엇을 이어받아야 하는가

## 실험 기본 원칙

### 1. 항상 날짜를 고정한다

실험은 반드시 명시적 날짜로 실행합니다.

예:

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run automation:daily -- --date 2026-04-03 --skip-push
```

### 2. 성공 기준을 먼저 정한다

아래 둘 중 하나는 반드시 있어야 합니다.

- 특정 산출물 파일이 생성된다
- 특정 화면/수치가 정상적으로 노출된다

### 3. 실패 원인을 파일에 남긴다

실패를 채팅에만 남기지 않습니다.

우선 기록 대상:

- `data/analysis-state/YYYY-MM-DD/automation-cycle.json`
- `knowledge/daily/YYYY-MM-DD-automation-cycle.md`
- `data/analysis-state/YYYY-MM-DD/system-health.json`
- `logs/*.log`

### 4. 실험 후 운영 문서도 갱신한다

실험 결과가 운영 플로우를 바꾸면 아래도 같이 바꿉니다.

- `README.md`
- `docs/OPERATOR_RUNBOOK.md`
- `docs/UPDATE_LOG.md`

## 표준 실험 종류

### 1. 일일 파이프라인 스모크 테스트

목적:

- 오늘 기준 전체 파이프라인이 끝까지 도는지 확인

명령:

```bash
cd /Users/seo/Documents/Playground/economy-report
bash scripts/run-daily-system.sh --date YYYY-MM-DD
```

성공 기준:

- `data/analysis-state/YYYY-MM-DD/stage1-report-extracts-v2.json`
- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`
- `reports/daily/YYYY-MM-DD-briefing.md`
- `knowledge/daily/YYYY-MM-DD-system-health.md`

### 2. 아침 자동화 전체 사이클 테스트

목적:

- 10시 자동화 흐름이 실제로 완결되는지 확인

명령:

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run automation:daily -- --date YYYY-MM-DD --skip-push
```

성공 기준:

- `data/analysis-state/YYYY-MM-DD/automation-cycle.json`
- `knowledge/daily/YYYY-MM-DD-automation-cycle.md`
- `knowledge/daily/YYYY-MM-DD-gemini-briefing-rich.md`
- `reports/daily/YYYY-MM-DD-briefing.md`
- `knowledge/wiki/daily/YYYY-MM-DD.md`

### 3. Gemini Deep Research 오버레이 테스트

목적:

- Stage 1.5 → Stage 1.6 → Stage 2~4 재계산이 이어지는지 확인

명령:

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run stage1.5:prompt -- --date YYYY-MM-DD
npm run stage1.5:gemini:run -- --date YYYY-MM-DD --poll-sec 30 --timeout-sec 1800
npm run stage1.6:briefing -- --date YYYY-MM-DD --run-date YYYY-MM-DD --effective-market-date YYYY-MM-DD
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD --run-date YYYY-MM-DD --effective-market-date YYYY-MM-DD --qwen-stage2
```

성공 기준:

- `knowledge/daily/manual-kit/YYYY-MM-DD/07-stage1-5-gemini-deep-research-prompt.md`
- `knowledge/daily/manual-kit/YYYY-MM-DD/09-stage1-5-gemini-deep-research-response.md`
- `knowledge/daily/YYYY-MM-DD-gemini-briefing-rich.md`
- `data/analysis-state/YYYY-MM-DD/stage2-strategy-options.json`
- `reports/daily/YYYY-MM-DD-briefing.md`

### 4. 대시보드 노출 테스트

목적:

- 새 리포트 정보가 대시보드에 실제로 노출되는지 확인

권장 명령:

```bash
cd /Users/seo/Documents/Playground/economy-report/dashboard
npm run build
npm run lint
```

화면 확인 포인트:

- `Macro View`에 시나리오/촉매/체크포인트가 보이는가
- `Strategy`에 계좌별 목표와 포트폴리오 시사점이 보이는가
- `Action`에 오늘 실행안과 체크리스트가 보이는가
- 새 리포트 정보가 기존 탭 하단에만 숨어 있지 않은가

### 5. LLM Wiki 누적 테스트

목적:

- 일일 산출물이 장기 기억 계층으로 잘 쌓이는지 확인

명령:

```bash
cd /Users/seo/Documents/Playground/economy-report
node scripts/build-llm-wiki.js --date YYYY-MM-DD
node scripts/publish-llm-wiki-to-vault.js
```

성공 기준:

- `knowledge/wiki/index.md`
- `knowledge/wiki/daily/YYYY-MM-DD.md`
- `knowledge/wiki/accounts/*.md`
- `knowledge/wiki/securities/*.md`
- `/Users/seo/my-wiki/wiki/ecoreport`

## 실패 디버깅 루프

1. 먼저 실패 지점을 좁힙니다.
2. 전체를 다시 돌리기보다 해당 단계 명령만 재실행합니다.
3. 실패 원인을 `automation-cycle` 또는 로그에 남깁니다.
4. 수정 후 다시 스모크 테스트를 합니다.
5. 운영 방식이 바뀌었으면 문서를 갱신합니다.

## 실험 결과 기록 규칙

실험 후 최소한 아래는 남깁니다.

- 날짜
- 실행 명령
- 성공 여부
- 생성된 핵심 파일
- 실패 원인
- 다음 실험 우선순위

장기 요약 기록 위치:

- `docs/UPDATE_LOG.md`

당일 상세 기록 위치:

- `knowledge/daily/YYYY-MM-DD-automation-cycle.md`
- `knowledge/daily/YYYY-MM-DD-system-health.md`

## 추천 실험 순서

### 새 기능을 붙였을 때

1. 관련 단일 스크립트 실행
2. `dashboard` 빌드/린트
3. `run-strategy-pipeline.sh`
4. 필요 시 `automation:daily`

### 운영 이슈를 재현할 때

1. 실패 날짜 고정
2. `automation-cycle` / `system-health` 읽기
3. 좁은 단계 재실행
4. 수정
5. 같은 날짜로 재검증

### 여러 툴이 이어받을 때

1. `docs/DOCS_MAP.md`
2. `docs/MULTI_TOOL_HANDOFF.md`
3. 이 문서
4. 해당 날짜 산출물
