# EcoReport Operator Runbook

## 목적

다른 날짜, 다른 사람, 다른 에이전트가 EcoReport를 이어받아도 같은 순서로 실행할 수 있도록 운영 절차를 고정합니다.

## 기본 원칙

- `igzun-daily-report`는 참고용 레퍼런스이며 EcoReport 런타임 의존성이 아닙니다.
- 수집 단계는 반드시 `전문 텍스트화`까지 포함합니다.
- Stage 2만 LLM 의존도가 크고, Stage 1/3/4는 EcoReport 내부 코드로 재현 가능해야 합니다.
- 기본 접속 경로는 공개 배포보다 **Mac Mini 로컬 + private access**를 우선합니다.

## 하루 운영 순서

### 빠른 일일 운영 명령

가장 권장하는 방식은 아래 한 줄입니다.

```bash
cd /Users/seo/stock-pilot
bash scripts/run-daily-system.sh --date YYYY-MM-DD
```

이 명령은 아래를 순서대로 수행합니다.

1. 리포트 수집 + 전문 텍스트화
2. 시장 데이터 수집 + 기술지표 계산
3. 리포트/포트폴리오/병렬 RAG 재생성
4. Gemini 경제 브리핑 생성(키가 있을 때)
5. Stage 1~4 실행
6. `data` 브랜치 동기화
7. 일일 산출물 검증

### 1. 포트폴리오 최신화

- 대시보드 `/portfolio/update`에서 계좌 상태를 반영
- 저장 파일:
  - `data/portfolio/latest.json`

### 2. 리포트 수집 + 전문 텍스트화

```bash
cd /Users/seo/stock-pilot
bash scripts/collect-report-assets.sh --date YYYY-MM-DD
```

확인 파일:

- `data/reports/YYYY-MM-DD/index.json`
- `data/reports/YYYY-MM-DD/crawl-manifest.json`
- `data/reports/YYYY-MM-DD/text-manifest.json`
- `data/reports/YYYY-MM-DD/text/*.txt`

### 3. 필요시 RAG 코퍼스 재생성

```bash
cd /Users/seo/stock-pilot
node scripts/build-report-rag-corpus.js --date YYYY-MM-DD
node scripts/build-portfolio-rag-corpus.js --date YYYY-MM-DD
node scripts/build-parallel-rag-corpus.js --date YYYY-MM-DD
```

### 4. Stage 1~4 파이프라인 실행

```bash
cd /Users/seo/stock-pilot
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD
```

Gemini Stage 2를 실제로 붙이고 싶으면:

```bash
cd /Users/seo/stock-pilot
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD --gemini-stage2
```

확인 파일:

- `data/analysis-state/YYYY-MM-DD/stage1-report-extracts-v2.json`
- `knowledge/daily/manual-kit/YYYY-MM-DD/08-stage2-strategy-prompt.md`
- `data/analysis-state/YYYY-MM-DD/stage2-strategy-options.mock.json`
- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`
- `reports/daily/YYYY-MM-DD-stage4-execution-plan.md`

### 5. 실제 LLM 전략 연결

현재는 Stage 2 prompt를 사람이 LLM에 넣는 방식이 기본입니다.

1. `08-stage2-strategy-prompt.md`를 ChatGPT/Gemini/Claude에 넣음
2. 동일 스키마의 실제 전략 JSON을 받음
3. `stage2-strategy-options.json`으로 저장
4. Stage 3/4만 다시 실행

```bash
cd /Users/seo/stock-pilot
node scripts/build-stage3-quant-scores.js --date YYYY-MM-DD
node scripts/build-stage4-execution-plan.js --date YYYY-MM-DD
```

### 6. 일일 산출물 검증

```bash
cd /Users/seo/stock-pilot
node scripts/verify-daily-system.js --date YYYY-MM-DD
```

생성 파일:

- `data/analysis-state/YYYY-MM-DD/system-health.json`
- `knowledge/daily/YYYY-MM-DD-system-health.md`

이 검증 리포트는 “오늘 파이프라인이 실제로 다 끝났는지”를 보는 운영용 체크포인트입니다.

## 파일 우선순위

새 담당자가 가장 먼저 볼 파일:

1. `README.md`
2. `docs/STAGE_1_4_ARCHITECTURE.md`
3. `docs/OPERATOR_RUNBOOK.md`
4. `data/portfolio/latest.json`
5. `data/reports/YYYY-MM-DD/crawl-manifest.md`
6. `reports/daily/YYYY-MM-DD-stage4-execution-plan.md`

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
cd /Users/seo/stock-pilot
bash scripts/run-daily-system.sh --date 2026-04-10
```

## private access 운영

Vercel이 실패하거나 불필요할 때는 아래 문서를 따릅니다.

- [PRIVATE_ACCESS_RUNBOOK.md](/Users/seo/stock-pilot/docs/PRIVATE_ACCESS_RUNBOOK.md)

핵심 원칙:

- Mac Mini에서 대시보드를 띄운다
- 파이프라인은 로컬에서 실행한다
- 원격 접속은 tailnet 내부에서만 허용한다
- `--skip-push`로 public sync 없이도 일일 운영 가능하다
