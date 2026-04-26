# EcoReport Repository Structure

이 문서는 현재 운영 기준의 파일 위치와 디렉토리 역할을 고정합니다.

## Canonical Paths

| 역할 | 경로 |
|---|---|
| 실행 루트 | `/Users/seo/Documents/Playground/economy-report` |
| main publish worktree | `/Users/seo/Documents/Playground/economy-report-main-publish` |
| shadow/merge 보조 worktree | `/Users/seo/Documents/Playground/economy-report-main-merge` |
| 레거시 참고 archive | `/Users/seo/Documents/Playground/stock-pilot-archive` |
| GitHub 원격 | `https://github.com/sgdrudejr/EcoReport.git` |

일상 실행은 `economy-report` 루트에서 합니다. `main` 브랜치는 충돌을 줄이기 위해 `economy-report-main-publish` worktree에서 관리할 수 있습니다.

## Filing Audit

경로가 꼬였는지 확인할 때는 아래 명령을 먼저 실행합니다.

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run audit:filing
```

이 감사는 아래 항목을 확인합니다.

- 필수 디렉토리와 파일 존재
- `package.json` 스크립트가 실제 파일을 가리키는지
- `/Users/seo/stock-pilot` 또는 `/Users/seo/Documents/Playground/EcoReport` 같은 옛 절대경로가 남았는지
- Codex 자동화의 cwd가 현재 루트를 가리키는지
- worktree에 실행 루트와 main 루트가 등록되어 있는지
- 캐시가 아닌 빈 디렉토리가 남았는지

## Top-Level Layout

```text
economy-report/
├── .github/workflows/          GitHub self-hosted trigger
├── config/                     전략, 보안 마스터, 로컬 경로 예시, API 설정
├── dashboard/                  Next.js 대시보드 workspace
├── data/                       구조화 데이터와 일부 추적 산출물
├── docs/                       운영/아키텍처/규칙 문서
├── knowledge/                  일일 지식 산출물과 장기 wiki
├── prompts/                    수동 LLM 프롬프트 템플릿
├── reports/                    최종 리포트와 실행 전략 출력물
├── scripts/                    수집, 변환, 분석, 자동화 스크립트
├── package.json                루트 npm scripts
└── requirements-report-orchestrator.txt
```

## config/

| 파일 | 역할 |
|---|---|
| `config/strategy.json` | 계좌 목표, 20/30/50 allocation policy, 점수/세금/리스크 설정 |
| `config/securities.json` | 종목/ETF 코드, 카테고리, 키워드, 테마 매핑의 단일 기준 |
| `config/watchlist.json` | 추적 대상 종목/ETF |
| `config/portfolio-sync.json` | KIS 계좌 동기화 설정 |
| `config/local-paths.example.json` | 로컬 절대경로 예시 |
| `config/local-paths.local.json` | 개인 로컬 override. Git에 올리지 않음 |
| `config/pipeline-manifest.yaml` | DAG 기반 실행 정의 |
| `config/stage-contracts.json` | Stage별 JSON contract |
| `config/market-calendar.json` | 휴장일/거래일 계산 기준 |

## scripts/

### Daily Entry Points

| 명령 | 역할 |
|---|---|
| `npm run automation:daily` | 전체 일일 자동화 |
| `npm run daily:final-output` | 기존 산출물로 경제 리포트/실행 전략만 재생성 |
| `npm run daily:quality` | quality-gated daily runner |
| `npm run verify` | 일일 산출물 검증 |
| `npm run audit:filing` | 파일/경로/자동화 설정 감사 |

### Stage Scripts

| Stage | 주요 파일 |
|---|---|
| Stage 1 | `build-report-chunk-index.js`, `build-stage1-report-extracts.js`, `build-stage2-enriched-report-index.js` |
| Stage 1.4 | `collectors/summarize-report-chunks.py`, `build-stage1-4-research-agenda.py`, `build-stage1-4-full-daily-report.py` |
| Stage 1.5~1.8 | `build-stage1-5-gemini-deep-research-prompt.js`, `run-gemini-deep-research-web.js`, `build-stage1-6-rich-briefing.js`, follow-up/refinement scripts |
| Stage 2 | `build-stage2-strategy-prompt.js`, `build-stage2-strategy-qwen.py`, `build-stage2-strategy-gemini.py`, `build-stage2-strategy-claude.js` |
| Stage 2.5 | `build-stage2-5-etf-candidates.js`, `build-impact-map.js` |
| Stage 3 | `build-stage3-quant-scores.js` |
| Stage 4 | `build-stage4-execution-plan.js`, `export-stage4-execution-plan-table.js` |
| Final View | `export-final-report-html.js` |

### Supporting Scripts

- `sync-kis-portfolio.js`: KIS 계좌 스냅샷 수집
- `fetch-market-data.js`, `fetch-market-data-lite.js`: 시장 데이터
- `build-feedback-snapshot.js`, `build-feedback-analysis.js`: 피드백 학습
- `auto-tune-challenger.js`, `backtest-challenger.js`: challenger weight shadow 검증
- `build-llm-wiki.js`, `publish-llm-wiki-to-vault.js`: 장기 wiki
- `push-to-github.sh`: `system-health` gate를 통과한 데이터만 data branch 동기화

## data/

`data/`에는 두 종류가 섞입니다.

| 경로 | Git 정책 | 역할 |
|---|---|---|
| `data/portfolio/latest.json` | tracked | 최신 계좌 스냅샷 |
| `data/portfolio/sources/kis/` | tracked | KIS 원천 스냅샷 일부 |
| `data/feedback/` | tracked | 피드백 분석, challenger 결과 |
| `data/external/kis-etf/` | tracked | KIS ETF 후보 보조 데이터 |
| `data/analysis-state/` | ignored | 날짜별 Stage 1~4 실행 산출물 |
| `data/reports/` | ignored | PDF, 텍스트, RAG, 수집 manifest |
| `data/market/`, `data/technical/` | ignored | 날짜별 시장/기술 데이터 |
| `data/stockeasy/` | ignored | StockEasy raw capture |

`data/analysis-state/YYYY-MM-DD/`는 아래 파일을 중심으로 봅니다.

```text
stage1-report-extracts-v2.json
stage1-4-full-daily-report.json
stage1-4-insight-atoms.json
stage2-strategy-options.json
stage2-5-etf-candidates.json
impact-map.json
stage3-quant-scores.json
stage4-execution-plan.json
automation-cycle.json
system-health.json
```

## knowledge/

| 경로 | 역할 |
|---|---|
| `knowledge/daily/YYYY-MM-DD-full-daily-report.md` | 읽을 수 있는 경제 리포트 Markdown |
| `knowledge/daily/manual-kit/YYYY-MM-DD/` | Gemini/LLM 프롬프트와 응답 |
| `knowledge/wiki/` | 장기 투자 메모리 |
| `knowledge/rag/` | 병렬 RAG corpus. Git에는 올리지 않음 |

## reports/

| 파일 | 역할 |
|---|---|
| `reports/daily/YYYY-MM-DD-final.html` | 경제 리포트 + 실행 전략 HTML |
| `reports/daily/YYYY-MM-DD-stage4-execution-plan.md` | 계좌별 실행 전략 Markdown |
| `reports/daily/YYYY-MM-DD-stage4-execution-plan-table.md` | 실행 전략 표 |
| `reports/daily/YYYY-MM-DD-stage4-execution-plan-telegram.txt` | Telegram 요약 |

`reports/`는 기본적으로 ignored입니다. 단, 사람이 바로 열어보는 최종 HTML은 필요할 때 `git add -f`로 고정합니다.

## dashboard/

Next.js workspace입니다.

```text
dashboard/
├── app/              App Router pages/routes
├── components/       공용 UI 컴포넌트
├── lib/              데이터 로더와 UI 유틸
├── public/           정적 자산
└── package.json
```

`dashboard/.next/`와 `dashboard/node_modules/`는 로컬 캐시이며 Git에 올리지 않습니다.

## Local-Only / Cleanup Policy

안전하게 지워도 되는 로컬 캐시:

- `scripts/__pycache__/`
- `dashboard/.next/`
- `.pytest_cache/`
- `.DS_Store`

주의해서 다뤄야 하는 경로:

- `data/reports/`: PDF와 텍스트 원본이므로 날짜별 재현성에 필요할 수 있음
- `data/analysis-state/`: 일일 실행 재현에 필요한 중간 산출물
- `knowledge/daily/manual-kit/`: LLM 프롬프트/응답 원본
- `open-trading-api/`: 로컬 KIS helper. ignored지만 런타임 의존

## Codex Automations

현재 기준 활성 자동화:

- `EcoReport Daily Automation`: 매일 10:00, 전체 실행
- `EcoReport Daily QA`: 매일 13:00, 최종 산출물과 health 점검

오래된 `/Users/seo/Documents/Playground/EcoReport` 경로를 가리키는 자동화는 사용하지 않습니다.
