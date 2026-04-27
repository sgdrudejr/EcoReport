# AI Investment Research Product Patterns

EcoReport는 다른 AI 투자 리서치 제품을 그대로 복제하지 않고, 개인 포트폴리오 자동화에 맞게 아래 패턴만 가져옵니다.

## 참고한 제품/원칙

| 참고 | 관찰한 패턴 | EcoReport 적용 |
|---|---|---|
| Bloomberg AI | 신뢰 데이터 기반 답변, 원문 출처 투명성, 여러 문서를 구조화 표로 압축 | 모든 claim에 `evidenceIds`, `source_audit_map`, 품질 플래그를 붙임 |
| Fiscal.ai | AI 요약이 KPI, IR 자료, 대시보드, 알림, 원천 filing auditability와 함께 있음 | 사람용 리포트와 AI 교환 JSON을 분리하고, 포트폴리오 액션 컨텍스트를 별도 패킷화 |
| AlphaSense | 브로커 리포트, 뉴스, 공시, expert call 같은 고품질 문서 묶음 위에서 의미 검색/감성/요약 | 100개 리포트는 먼저 구조화하고 Deep Research는 외부 검증 질문에만 사용 |
| FINRA AI guidance | GenAI를 써도 기존 투자 관련 규칙과 의무는 계속 적용 | 과장 claim, 보장 수익 표현, 근거 약한 액션은 `Quality Gates`에서 보류 |
| FINRA investor warning | “AI가 보장 수익을 준다”류의 표현은 위험 신호 | `guarantee`, `확실`, `무조건`, `급등`, `폭등` 등은 risky claim으로 격리 |

## EcoReport 업데이트 방향

- Bloomberg/AlphaSense식 `transparent attribution`: 최종 문장에는 사람이 읽는 설명을 남기고, AI 교환 패킷에는 `claim -> evidenceIds -> source_audit_map`만 싣습니다.
- Fiscal.ai식 `data + AI summary + dashboard`: 사람이 보는 리포트, 계좌 실행 전략, AI 교환 JSON, 품질 경고를 분리하되 같은 날짜 키로 묶습니다.
- AlphaSense식 `repeatable workflow`: 100개 리포트를 매번 긴 문서로 다시 요약하지 않고, `02. Chunk Summary`와 `03. Report Indexing`에서 atom/claim을 보존한 뒤 작은 질문만 Deep Research로 보냅니다.
- FINRA식 `risk guardrail`: 확정 수익, 과장 표현, 근거 부족 액션은 `13. Quality Gates`에서 경고/보류 처리하고 `11. Execution Plan` BUY 노출에서 제외합니다.

## 구현 기준

1. `Human-readable artifacts`
   - `reports/daily/YYYY-MM-DD-final.html`
   - `knowledge/daily/YYYY-MM-DD-full-daily-report.md`
   - 문맥, 경고, 보류, 근거 약함, 실행 전략을 사람이 읽기 좋게 담습니다.

2. `AI-to-AI packets`
   - `data/analysis-state/YYYY-MM-DD/llm-exchange/research-context.v1.json`
   - `data/analysis-state/YYYY-MM-DD/llm-exchange/portfolio-action-context.v1.json`
   - `data/analysis-state/YYYY-MM-DD/llm-exchange/claim-review-context.v1.json`
   - `data/analysis-state/YYYY-MM-DD/llm-exchange/source-audit-map.v1.json`
   - 긴 본문은 제외하고 claim ID, 짧은 claim, evidence ID, 품질 상태, 액션 게이트만 넣습니다.

3. `Small prompt review`
   - 위험 claim만 `claim-review-context.v1.json`과 `17-risky-claim-review-prompt.md`에 모읍니다.
   - 전체 리포트를 다시 LLM에 던지지 않습니다.

4. `Validated action visibility`
   - BUY는 `validationStatus=validated`인 후보만 노출합니다.
   - 탈락 후보는 `rejectedAlternatives`에 남겨 다음 리서치 질문으로 되돌립니다.

## 참고 URL

- Bloomberg AI: https://professional.bloomberg.com/solutions/ai
- Fiscal.ai: https://fiscal.ai/
- AlphaSense generative AI for investment research: https://www.alpha-sense.com/solutions/generative-ai-investment-research
- FINRA AI topic: https://www.finra.org/rules-guidance/key-topics/artificial-intelligence
- FINRA AI and investment fraud: https://www.finra.org/investors/insights/artificial-intelligence-and-investment-fraud
