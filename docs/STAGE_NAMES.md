# EcoReport Stage Names

이 문서는 `Stage 1.4`처럼 의미가 흐려지는 이름을 없애기 위한 기준입니다.
앞으로 로그, 문서, 매니페스트, 자동화 요약에서는 `NN. English Step Name`을 기본 표기로 씁니다.
기존 `stage1.4:*` 같은 npm alias는 호환용으로만 남깁니다.

| 번호 | English Step Name | 한국어 의미 | 핵심 역할 | 대표 산출물 |
|---|---|---|---|---|
| 01 | Report Collection | 리포트 수집 | 증권사 리포트, 텍스트, 계좌, 시장 데이터를 확보 | `data/reports/YYYY-MM-DD/`, `data/portfolio/latest.json` |
| 02 | Chunk Summary | 청크 요약 | 로컬 LLM/청크 요약으로 리포트별 핵심 문장을 압축 | `reports/report_summaries/YYYY-MM-DD/`, `stage1-chunk-summaries.json` |
| 03 | Report Indexing | 리포트 인덱싱 | 리포트 메타, 카테고리, 계좌 관련성을 구조화 | `stage1-report-extracts-v2.json`, `stage2-enriched-report-index.json` |
| 04 | Research Agenda | 리서치 질문 설계 | 평균에 묻히는 쟁점, 충돌, 신규 후보 질문을 설계 | `stage1-research-agenda.json` |
| 05 | Deep Research | 외부 검증 리서치 | Gemini/웹 리서치에 던질 작은 질문 묶음을 생성 | `manual-kit/07*.md` |
| 06 | Briefing Synthesis | 브리핑 병합 | 외부 검증 결과와 내부 리포트 신호를 병합 | `gemini-briefing-rich.md`, `briefing-delta.json` |
| 07 | Strategy Options | 전략 후보 생성 | Qwen 등 실제 LLM으로 계좌별 후보와 논리를 생성 | `stage2-strategy-options.json` |
| 08 | Candidate Matching | 후보 매칭 | ETF/종목 코드와 신규 후보를 연결하고 보강 | `stage2-5-etf-candidates.json` |
| 09 | Impact Mapping | 영향 매핑 | 리포트 신호가 계좌/보유종목/섹터에 미치는 영향을 연결 | `impact-map.json` |
| 10 | Quant Scoring | 퀀트 점수화 | 기술적 지표, 포트폴리오 점수, 레짐을 계산 | `stage3-quant-scores.json` |
| 11 | Execution Plan | 실행 전략 | 검증 통과 후보만 계좌별 BUY/HOLD/WATCH로 노출 | `stage4-execution-plan.json` |
| 12 | Final Outputs | 최종 산출물 | 읽을 수 있는 경제 리포트와 실행 전략 표/HTML 생성 | `reports/daily/YYYY-MM-DD-final.html` |
| 13 | Quality Gates | 품질 검증 | 정합성, 근거, 중복, 날짜, 카테고리, 위험 claim을 검사 | `data-quality-audit.json`, `17-risky-claim-review-prompt.md` |

## Human vs AI Artifacts

사람이 읽는 파일과 AI끼리 교환하는 파일은 분리합니다.

| 용도 | 파일 | 원칙 |
|---|---|---|
| 사람이 읽는 경제 리포트 | `knowledge/daily/YYYY-MM-DD-full-daily-report.md`, `reports/daily/YYYY-MM-DD-final.html` | 문맥, 경고, 보류, 근거 약함 표시를 포함 |
| 실행 전략 | `reports/daily/YYYY-MM-DD-stage4-execution-plan-table.md`, `stage4-execution-plan.json` | 검증 통과 BUY만 노출하고 거절 후보는 상세에 격리 |
| AI 교환 JSON | `data/analysis-state/YYYY-MM-DD/stage1-4-ai-exchange.json` | 긴 본문 제외, claim ID/짧은 주장/근거 ID/품질 플래그만 포함 |
| AI 교환 패킷 | `data/analysis-state/YYYY-MM-DD/llm-exchange/*.json` | 리서치, 포트폴리오 액션, 위험 claim 재검토, 출처 감사 맵을 분리 |
| 품질 감사 | `data/analysis-state/YYYY-MM-DD/data-quality-audit.json` | deterministic check 결과와 risky claim mini prompt 경로 포함 |

## Quality Gate Order

1. 코드로 정합성, 근거, 중복, 날짜, 카테고리를 검사합니다.
2. 위험 claim만 `17-risky-claim-review-prompt.md`에 모읍니다.
3. 최종 리포트 HTML에 경고, 보류, 근거 약함 상태를 표시합니다.
4. 실행 전략은 `validated_only` 정책을 통과한 후보만 BUY로 노출합니다.
