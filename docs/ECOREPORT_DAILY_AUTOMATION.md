# EcoReport Daily Automation

이 문서는 EcoReport를 매일 같은 순서로 실행하기 위한 운영 지도입니다.

핵심 원칙은 두 가지입니다.

- 비용이 큰 LLM/웹 리서치는 필요한 단계에서만 쓴다.
- 최종 출력물은 항상 `읽을 수 있는 경제 리포트`와 `실행 전략` 두 가지로 분리한다.

## 현재 권장 명령

### 1. 전체 자동화

수집부터 Deep Research, Stage 2~4, 검증까지 하루 작업을 끝까지 돌릴 때 사용합니다.

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run automation:daily -- --date YYYY-MM-DD
```

### 2. 품질 게이트 포함 실행

일일 시스템을 돌린 뒤 `system-health` 검증까지 통과해야 성공으로 봅니다.

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run daily:quality -- --date YYYY-MM-DD
```

### 3. 최종 산출물만 재생성

이미 수집과 LLM 응답이 있는 날짜에서 최종 리포트/실행 전략만 다시 정리할 때 사용합니다.

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run daily:final-output -- --date YYYY-MM-DD
```

이 명령은 아래 산출물을 다시 만듭니다.

- `knowledge/daily/YYYY-MM-DD-full-daily-report.md`
- `reports/daily/YYYY-MM-DD-stage4-execution-plan.md`
- `reports/daily/YYYY-MM-DD-stage4-execution-plan-table.md`
- `reports/daily/YYYY-MM-DD-final.html`
- `data/analysis-state/YYYY-MM-DD/system-health.json`

### 4. 특정 run-date를 유지해서 재생성

시장 기준일과 실행일을 분리해야 할 때 사용합니다.

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run daily:final-output -- --date YYYY-MM-DD --run-date YYYY-MM-DD --effective-market-date YYYY-MM-DD
```

## Stage Map

정식 단계명은 `docs/STAGE_NAMES.md`와 `config/stage-names.json`을 기준으로 합니다. 기존 `stage1.4:*` 명령은 호환 alias일 뿐, 운영 문서와 로그에서는 아래 이름을 씁니다.

| Step | 목적 | 대표 명령 | 대표 산출물 |
|---|---|---|---|
| 01. Report Collection | 계좌/리포트/시장 데이터 수집 | `npm run step01:report-collection -- --date YYYY-MM-DD` | `data/reports/`, `data/portfolio/latest.json`, `data/market/` |
| 02. Chunk Summary | 100개 리포트에서 희소 신호와 청크 요약 구조화 | `npm run step02:chunk-summary -- --date YYYY-MM-DD` | `reports/report_summaries/`, `stage1-chunk-summaries.json` |
| 03. Report Indexing | 리포트 메타와 계좌 관련성 인덱싱 | `npm run step03:report-indexing -- --date YYYY-MM-DD` | `stage1-report-extracts-v2.json`, `stage2-enriched-report-index.json` |
| 04. Research Agenda | 리서치 질문 설계 | `npm run step04:research-agenda -- --date YYYY-MM-DD` | `stage1-research-agenda.json` |
| 05. Deep Research | Gemini Deep Research 질문 생성 | `npm run step05:deep-research-prompt -- --date YYYY-MM-DD` | `manual-kit/07*.md` |
| 06. Briefing Synthesis | 외부 리서치 결과를 rich briefing으로 병합 | `npm run step06:briefing-synthesis -- --date YYYY-MM-DD` | `gemini-briefing-rich.md` |
| 07. Strategy Options | 실제 LLM 전략 후보 생성 | `npm run step07:strategy-options -- --date YYYY-MM-DD` | `stage2-strategy-options.json` |
| 08. Candidate Matching | ETF/신규 후보 연결 | `npm run step08:candidate-matching -- --date YYYY-MM-DD` | `stage2-5-etf-candidates.json` |
| 09. Impact Mapping | 리포트-계좌 영향 연결 | `npm run step09:impact-mapping -- --date YYYY-MM-DD` | `impact-map.json` |
| 10. Quant Scoring | 계좌/종목 점수와 리스크 계산 | `npm run step10:quant-scoring -- --date YYYY-MM-DD` | `stage3-quant-scores.json` |
| 11. Execution Plan | 검증 통과 후보만 실행 전략으로 노출 | `npm run step11:execution-plan -- --date YYYY-MM-DD` | `stage4-execution-plan.json/md` |
| 12. Final Outputs | 읽을 수 있는 경제 리포트와 실행 전략 생성 | `npm run step12:final-outputs -- --date YYYY-MM-DD` | `reports/daily/YYYY-MM-DD-final.html` |
| 13. Quality Gates | 정합성/근거/중복/날짜/카테고리/위험 claim 검사 | `npm run step13:quality-gates -- --date YYYY-MM-DD` | `data-quality-audit.json`, `17-risky-claim-review-prompt.md` |

## 최종 출력물 계약

EcoReport의 하루 산출물은 항상 두 종류로 나눕니다.

| 출력물 | 파일 | 역할 |
|---|---|---|
| 읽을 수 있는 경제 리포트 | `reports/daily/YYYY-MM-DD-final.html`, `knowledge/daily/YYYY-MM-DD-full-daily-report.md` | 오늘의 컨센서스, 소수 의견, 충돌 지점, 신규 후보, 리스크를 구조화해 보여줌 |
| 실행 전략 | `reports/daily/YYYY-MM-DD-stage4-execution-plan.md`, `reports/daily/YYYY-MM-DD-stage4-execution-plan-table.md` | 계좌별 매수/보류/감축/no_action과 금액, 근거, 검증 플래그를 보여줌 |

최종 HTML에는 `data-quality-audit.json`의 경고/보류/근거 약함 표시가 같이 들어갑니다. BUY 후보는 `validated_only` 정책을 통과한 것만 보이고, 탈락 후보는 rejected alternatives에만 남깁니다.

## 배분 정책

현재 전략 정책은 `config/strategy.json`의 `allocationPolicy`가 기준입니다.

| 버킷 | 목표 | 예시 |
|---|---:|---|
| safety | 20% | 금, 현금파킹, 단기채, 채권 |
| core | 30% | S&P500, 나스닥100, 미국인덱스, 국내인덱스, 배당/커버드콜 |
| satellite | 50% | 전력기기, 방산, 원자력, 조선, 신재생에너지, 반도체/PCB |

`11. Execution Plan`은 이 정책을 이용해 아래를 검증합니다.

- 같은 위성 섹터는 하루에 신규 진입 1개만 허용
- 단일 위성 섹터는 전체 포트폴리오의 12.5%를 넘지 않게 관리
- AI/전력/인프라처럼 겹치는 클러스터는 별도 상한으로 관리
- 위성 단일 종목/ETF가 과도하게 커지면 신규 매수를 막음

## Hook / Automation

### GitHub self-hosted trigger

`.github/workflows/trigger-mac.yml`는 self-hosted Mac에서 일일 시스템을 실행하기 위한 GitHub Actions 진입점입니다.

현재 원칙:

- `--skip-push`로 실행해 불완전 데이터가 자동 push되지 않게 한다.
- push는 `system-health`가 `ok`일 때만 별도 단계에서 허용한다.
- Vercel 배포는 완성 데이터가 안정될 때까지 사용하지 않는다.

### macOS launchd 예시

매일 장 마감 후 자동 실행을 원하면 launchd에서 아래 명령을 호출합니다.

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run automation:daily -- --date "$(date +%F)"
```

로컬 자동화가 실패했을 때는 비용이 큰 단계를 다시 돌리기 전에 아래 명령으로 최종 출력만 재생성합니다.

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run daily:final-output -- --date "$(date +%F)"
```

### Codex Skill

EcoReport 작업을 Codex에서 이어갈 때는 `ecoreport-manual-research` 스킬을 사용합니다.

현재 우선순위:

- 100개 리포트의 평균 요약보다 신규 주장, 반대 근거, 신규 후보를 보존
- Gemini Deep Research는 최종 결론자가 아니라 외부 검증/반론/최신 촉매 확인 레이어로 사용
- `11. Execution Plan` 실행 전략은 `allocationPolicy`의 20/30/50 정책을 통과한 후보만 보여줌

## Daily Checklist

1. `npm run automation:daily -- --date YYYY-MM-DD`
2. 실패 시 `logs/`와 `data/analysis-state/YYYY-MM-DD/automation-cycle.json` 확인
3. 비용 큰 LLM을 다시 돌릴 필요가 없으면 `npm run daily:final-output -- --date YYYY-MM-DD`
4. `npm run verify -- --date YYYY-MM-DD`
5. `reports/daily/YYYY-MM-DD-final.html`에서 경제 리포트 확인
6. `reports/daily/YYYY-MM-DD-stage4-execution-plan-table.md`에서 실행 전략 확인
7. `system-health`가 `ok`일 때만 Git push 또는 data branch sync
