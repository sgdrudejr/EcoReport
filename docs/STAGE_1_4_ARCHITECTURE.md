# EcoReport Stage 1-4 Architecture

## Goal

EcoReport를 다음 4단계 구조로 고정합니다.

1. `Stage 1` 리포트 연구 노트화
2. `Stage 2` 전략 탐색 LLM
3. `Stage 3` 퀀트 점수화
4. `Stage 4` 실행 계획 생성

`igzun-daily-report`는 참고용으로만 보고, 실제 구현은 EcoReport 안에 독립적으로 유지합니다.

## Architecture

공용 입력은 파일 경로를 각 스크립트가 제각각 계산하지 않고 `scripts/lib/analysis-context.js`
를 통해 로드합니다. 이 context는 아래 공통 자산을 한 번에 정렬합니다.

- `portfolio/latest.json`
- `strategy.json`
- `technical/YYYY-MM-DD.json`
- `stage1/2/3/impact-map`
- `watchlist.json`
- `fred-YYYY-MM-DD.json`

이렇게 하면 현재는 프로세스 단위 캐시이지만, 이후 Node 기반 in-process orchestration으로
옮길 때도 같은 context shape를 그대로 재사용할 수 있습니다.

```mermaid
flowchart TD
    A["PDF/원문 텍스트\nindex.json + full_text_path"] --> B["Stage 1\nbuild-stage1-report-extracts.js"]
    P["Portfolio Snapshot\nlatest.json"] --> B
    W["Watchlist / Strategy"] --> B

    B --> B1["stage1-report-extracts-v2.json"]
    B --> B2["stage1-report-extracts-v2.md"]

    B1 --> C["Stage 2 Prompt\nbuild-stage2-strategy-prompt.js"]
    P --> C
    T["Technical snapshot\nYYYY-MM-DD.json"] --> C
    G["Gemini / daily briefing"] --> C
    C --> C1["stage2-strategy-prompt.md"]

    B1 --> DR["Stage 1.5 Deep Research Prompt\nbuild-stage1-5-gemini-deep-research-prompt.js"]
    DR --> DR1["manual-kit/07-stage1-5-gemini-deep-research-prompt.md"]

    B1 --> D["Stage 2 Mock / Fallback\nbuild-stage2-strategy-mock.js"]
    P --> D
    T --> D
    W --> D
    D --> D1["stage2-strategy-options.mock.json"]

    B1 --> E["Stage 3 Quant\nbuild-stage3-quant-scores.js"]
    D1 --> E
    T --> E
    P --> E
    W --> E
    E --> E1["stage3-quant-scores.json"]

    B1 --> F["Stage 4 Execution\nbuild-stage4-execution-plan.js"]
    D1 --> F
    E1 --> F
    P --> F
    W --> F
    F --> F1["stage4-execution-plan.json"]
    F --> F2["stage4-execution-plan.md"]
```

## Output Contract

### Stage 1

- `data/analysis-state/YYYY-MM-DD/stage1-report-extracts-v2.json`
- `knowledge/daily/YYYY-MM-DD-stage1-report-extracts-v2.md`

핵심 필드:

- `report_type`
- `sector`
- `themes`
- `related_holdings_in_my_portfolio`
- `related_accounts`
- `key_thesis`
- `key_points`
- `key_numbers`
- `bull_case`
- `bear_case`
- `portfolio_impacts_candidate`
- `evidence_notes`

### Stage 2

- `knowledge/daily/manual-kit/YYYY-MM-DD/08-stage2-strategy-prompt.md`
- `data/analysis-state/YYYY-MM-DD/stage2-strategy-options.mock.json`

실제 LLM을 붙이면 mock JSON 대신 동일 스키마의 실제 응답 JSON을 저장합니다.

Mock 정책:

- 기본 운영 경로에서는 Stage 2 mock을 무조건 만들지 않습니다.
- `--mock-stage2`일 때만 테스트용 deterministic fixture를 생성합니다.
- Gemini 실모델이 실패했고 fallback이 허용된 경우에만 canonical 경로에 fallback mock을 기록합니다.
- mock 산출물에는 `mockMode: test|fallback` 과 `purpose`를 넣어 운영/테스트를 구분합니다.

### Stage 3

- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`

핵심 필드:

- `regime`
- `holdings.*.actionScore`
- `holdings.*.direction`
- `holdings.*.timing`
- `holdings.*.reportScore`
- `holdings.*.probabilities`
- `accounts.*.totalScore`
- `portfolio.totalScore`

### Stage 4

- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`
- `reports/daily/YYYY-MM-DD-stage4-execution-plan.md`

핵심 필드:

- `deployBudget`
- `reserveCash`
- `topGap`
- `stagedBuys`
- `trims`
- `holds`
- `watches`
- `stage1Drivers`

## Why this split works

### Stage 1

리포트를 바로 “추천”하지 않고, 연구 노트 형태로 보존합니다.

### Stage 2

강한 해석과 전략 수정은 LLM이 맡되, 입력 컨텍스트와 출력 스키마는 EcoReport가 통제합니다.

### Stage 3

최종 점수와 확률은 규칙/퀀트 엔진이 계산합니다.  
이 단계는 재현성과 추적성을 담당합니다.

또한 Stage 1.5 Deep Research 프롬프트 생성과 독립적으로 병렬 실행될 수 있습니다.

### Stage 4

실제 실행 금액과 계좌별 행동 지침은 1~3단계 결과를 모두 사용합니다.

## Retrieval Layer

현재 리포트 검색 레이어는 이미 `text-manifest.json` 자체가 아니라
`better-sqlite3` 기반 SQLite FTS 인덱스를 사용합니다.

- 기본값: 로컬 SQLite FTS
- 장점: zero-ops, 빠른 cold start, 로컬 맥 미니 운영에 적합
- 향후 확장: Chroma 같은 로컬 벡터 스토어를 같은 retrieval adapter 뒤에 추가

즉시 Pinecone/Milvus를 강제하지 않는 이유는 운영 복잡도 대비 현재 로컬 워크플로우 이득이
제한적이기 때문입니다. 대신 retrieval 경계는 vector backend를 붙일 수 있게 유지합니다.
