# EcoReport Operator Runbook

## 목적

다른 날짜, 다른 사람, 다른 에이전트가 EcoReport를 이어받아도 같은 순서로 실행할 수 있도록 운영 절차를 고정합니다.

## 관련 문서

운영 전에 아래 문서를 같이 보면 훨씬 빠릅니다.

- 전체 문서 지도: `docs/DOCS_MAP.md`
- 여러 툴 handoff 규칙: `docs/MULTI_TOOL_HANDOFF.md`
- 실험/검증 절차: `docs/EXPERIMENT_PLAYBOOK.md`
- 실패와 폴백: `FAILURES_AND_FALLBACKS.md`
- 최근 변경 이력: `docs/UPDATE_LOG.md`

## 기본 원칙

- `igzun-daily-report`는 참고용 레퍼런스이며 EcoReport 런타임 의존성이 아닙니다.
- 수집 단계는 반드시 `전문 텍스트화`까지 포함합니다.
- Stage 2만 LLM 의존도가 크고, Stage 1/3/4는 EcoReport 내부 코드로 재현 가능해야 합니다.
- 기본 접속 경로는 공개 배포보다 **Mac Mini 로컬 + private access**를 우선합니다.

## 하루 운영 순서

### 빠른 일일 운영 명령

가장 권장하는 방식은 아래 한 줄입니다.

```bash
cd /Users/seo/Documents/Playground/EcoReport
bash scripts/run-daily-system.sh --date YYYY-MM-DD
```

Gemini Deep Research까지 포함한 무인 자동 실행은 아래 러너를 사용합니다.

```bash
cd /Users/seo/Documents/Playground/EcoReport
npm run automation:daily -- --date YYYY-MM-DD
```

이 명령은 아래를 순서대로 수행합니다.

1. 리포트 수집 + 전문 텍스트화
2. 시장 데이터 수집 + 기술지표 계산
3. 리포트/포트폴리오/병렬 RAG 재생성
4. Gemini 경제 브리핑 생성(키가 있을 때)
5. Stage 1~4 실행
6. `knowledge/wiki/` 지속형 투자 위키 갱신
7. `data` 브랜치 동기화
8. 일일 산출물 검증

자동 실행 러너는 여기에 더해 아래를 수행합니다.

9. Gemini Deep Research 웹 실행
10. Stage 1.6 최종 rich briefing 생성
11. Stage 2~4 재계산
12. 실패/경고 요약을 `automation-cycle` JSON/Markdown으로 저장

전제 조건:

- Mac 화면이 잠겨 있지 않아야 함
- Safari가 Gemini 로그인 상태여야 함
- 실패해도 `logs/*.log`, `system-health`, `automation-cycle`에 원인을 남김

### 1. 포트폴리오 최신화

- 대시보드 `/portfolio/update`에서 계좌 상태를 반영
- 저장 파일:
  - `data/portfolio/latest.json`

### 2. 리포트 수집 + 전문 텍스트화

```bash
cd /Users/seo/Documents/Playground/EcoReport
bash scripts/collect-report-assets.sh --date YYYY-MM-DD
```

확인 파일:

- `data/reports/YYYY-MM-DD/index.json`
- `data/reports/YYYY-MM-DD/crawl-manifest.json`
- `data/reports/YYYY-MM-DD/text-manifest.json`
- `data/reports/YYYY-MM-DD/text/*.txt`

### 3. 필요시 RAG 코퍼스 재생성

```bash
cd /Users/seo/Documents/Playground/EcoReport
node scripts/build-report-rag-corpus.js --date YYYY-MM-DD
node scripts/build-portfolio-rag-corpus.js --date YYYY-MM-DD
node scripts/build-parallel-rag-corpus.js --date YYYY-MM-DD
```

### 4. Stage 1~4 파이프라인 실행

```bash
cd /Users/seo/Documents/Playground/EcoReport
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD
```

Gemini Stage 2를 실제로 붙이고 싶으면:

```bash
cd /Users/seo/Documents/Playground/EcoReport
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD --gemini-stage2
```

확인 파일:

- `data/analysis-state/YYYY-MM-DD/stage1-report-extracts-v2.json`
- `knowledge/daily/manual-kit/YYYY-MM-DD/08-stage2-strategy-prompt.md`
- `data/analysis-state/YYYY-MM-DD/stage2-strategy-options.mock.json`
- `data/analysis-state/YYYY-MM-DD/stage2-strategy-options.json`
- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`
- `reports/daily/YYYY-MM-DD-briefing.md`

### 4.5. Gemini Deep Research 수동 오버레이

Gemini 웹 리서치를 끼워 넣고 싶을 때는 아래 순서로 실행합니다.

```bash
cd /Users/seo/Documents/Playground/EcoReport
npm run stage1.5:prompt -- --date YYYY-MM-DD
npm run stage1.5:gemini:run -- --date YYYY-MM-DD --poll-sec 30 --timeout-sec 1800
npm run stage1.6:briefing -- --date YYYY-MM-DD --run-date YYYY-MM-DD --effective-market-date YYYY-MM-DD
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD --run-date YYYY-MM-DD --effective-market-date YYYY-MM-DD --gemini-stage2
```

확인 파일:

- `knowledge/daily/manual-kit/YYYY-MM-DD/07-stage1-5-gemini-deep-research-prompt.md`
- `knowledge/daily/manual-kit/YYYY-MM-DD/09-stage1-5-gemini-deep-research-response.md`
- `knowledge/daily/YYYY-MM-DD-gemini-briefing-rich.md`
- `data/analysis-state/YYYY-MM-DD/stage2-strategy-options.json`
- `reports/daily/YYYY-MM-DD-briefing.md`

의도:

- Stage 1 fact anchor를 유지한 채 Gemini Deep Research의 반박 시나리오, 대안 자산, 촉매 일정을 대시보드 매크로 브리핑으로 승격
- 그 결과를 다시 Stage 2~4에 흘려보내 `Macro View -> Strategy -> Action` 전체를 갱신

### 4.6. LLM Wiki 갱신

```bash
cd /Users/seo/Documents/Playground/EcoReport
node scripts/build-llm-wiki.js --date YYYY-MM-DD
```

확인 파일:

- `knowledge/wiki/index.md`
- `knowledge/wiki/log.md`
- `knowledge/wiki/daily/YYYY-MM-DD.md`
- `knowledge/wiki/accounts/*.md`
- `knowledge/wiki/securities/*.md`

이 단계의 목적은 일일 결과를 장기적으로 재사용 가능한 투자 메모리로 바꾸는 것입니다.
특히 계좌별 플레이북과 종목 thesis 페이지가 다음 날 판단 시간을 줄여줍니다.

### 5. 실제 LLM 전략 연결

현재는 Stage 2 prompt를 사람이 LLM에 넣는 방식이 기본입니다.

1. `08-stage2-strategy-prompt.md`를 ChatGPT/Gemini/Claude에 넣음
2. 동일 스키마의 실제 전략 JSON을 받음
3. `stage2-strategy-options.json`으로 저장
4. Stage 3/4만 다시 실행

```bash
cd /Users/seo/Documents/Playground/EcoReport
node scripts/build-stage3-quant-scores.js --date YYYY-MM-DD
node scripts/build-stage4-execution-plan.js --date YYYY-MM-DD
```

### 6. 일일 산출물 검증

```bash
cd /Users/seo/Documents/Playground/EcoReport
node scripts/verify-daily-system.js --date YYYY-MM-DD
```

생성 파일:

- `data/analysis-state/YYYY-MM-DD/system-health.json`
- `knowledge/daily/YYYY-MM-DD-system-health.md`

이 검증 리포트는 “오늘 파이프라인이 실제로 다 끝났는지”를 보는 운영용 체크포인트입니다.

## 파일 우선순위

새 담당자가 가장 먼저 볼 파일:

1. `README.md`
2. `docs/DOCS_MAP.md`
3. `docs/MULTI_TOOL_HANDOFF.md`
4. `docs/OPERATOR_RUNBOOK.md`
5. `data/analysis-state/YYYY-MM-DD/automation-cycle.json`
6. `data/analysis-state/YYYY-MM-DD/system-health.json`
7. `data/portfolio/latest.json`
8. `data/reports/YYYY-MM-DD/crawl-manifest.json`
9. `reports/daily/YYYY-MM-DD-briefing.md`

## 현재 약점

### 1. Stage 1 관련성은 아직 후보 수준

- `related_holdings_in_my_portfolio`
- `portfolio_impacts_candidate`

는 휴리스틱 기반입니다.
다음 단계는 `impact-map.json` 레이어를 추가해 확정 영향도로 분리하는 것입니다.

### 2. Stage 2는 아직 mock 기본

실제 전략적 판단은 사람이 LLM에 직접 질문해서 받은 JSON으로 덮어써야 합니다.

### 3. Stage 4는 실행 초안

현재도 바로 읽을 수는 있지만, 실제 매수 금액/후보 우선순위는 Stage 2 실제 JSON이 들어올수록 좋아집니다.

## 날짜를 바꿔서 실행할 때

```bash
cd /Users/seo/Documents/Playground/EcoReport
bash scripts/run-daily-system.sh --date 2026-04-10
```

## private access 운영

Vercel이 실패하거나 불필요할 때는 아래 문서를 따릅니다.

- [PRIVATE_ACCESS_RUNBOOK.md](/Users/seo/Documents/Playground/EcoReport/docs/PRIVATE_ACCESS_RUNBOOK.md)

핵심 원칙:

- Mac Mini에서 대시보드를 띄운다
- 파이프라인은 로컬에서 실행한다
- 원격 접속은 tailnet 내부에서만 허용한다
- `--skip-push`로 public sync 없이도 일일 운영 가능하다
