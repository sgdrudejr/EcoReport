# EcoReport Daily Health (2026-04-08)

- overallStatus: **error**
- generatedAt: 2026-04-08T13:20:09.550Z
- runId: 2026-04-08-130953
- runDate: 2026-04-08
- effectiveMarketDate: 2026-04-08
- reports: 100건 / textified 100건 / OCR 1건
- stage1 extracts: 100건

## Checks
- [OK] 포트폴리오 스냅샷: 계좌 4개 (data/portfolio/latest.json)
- [OK] 리포트 인덱스: 리포트 100건 (data/reports/2026-04-08/index.json)
- [OK] 전문 텍스트화: 성공 100/100 · OCR 1건 (data/reports/2026-04-08/text-manifest.json)
- [OK] 시장 데이터: market 스냅샷 생성됨 (data/market/2026-04-08.json)
- [OK] 기술 점수: 종목 15개 (data/technical/2026-04-08.json)
- [OK] RAG 코퍼스: 리포트 804 / 포트폴리오 20 / 병렬 824 (knowledge/rag/2026-04-08/parallel-manifest.json)
- [OK] Stage 1 연구 노트: 추출 100건 (data/analysis-state/2026-04-08/stage1-report-extracts-v2.json)
- [OK] Stage 2 전략 탐색: Gemini 실제 결과 (gemini-2.5-flash) (data/analysis-state/2026-04-08/stage2-strategy-options.json)
- [OK] Impact Map: 리포트 100건 (data/analysis-state/2026-04-08/impact-map.json)
- [OK] Stage 3 퀀트 점수: 포트폴리오 65점 (data/analysis-state/2026-04-08/stage3-quant-scores.json)
- [OK] Stage 4 실행 계획: 계좌 계획 4개 (data/analysis-state/2026-04-08/stage4-execution-plan.json)
- [OK] 일일 브리핑: briefing.md 생성됨 (reports/daily/2026-04-08-briefing.md)
- [OK] LLM Wiki Daily: daily wiki 생성됨 (knowledge/wiki/daily/2026-04-08.md)
- [OK] 경제 리포트 브리핑: rich Gemini 브리핑 생성됨 (knowledge/daily/2026-04-08-gemini-briefing-rich.md)
- [OK] Deep Research 프롬프트: Stage 1.5 프롬프트 생성됨 (knowledge/daily/manual-kit/2026-04-08/07-stage1-5-gemini-deep-research-prompt.md)
- [OK] Deep Research 결과: Gemini Deep Research 결과 저장됨 (knowledge/daily/manual-kit/2026-04-08/09-stage1-5-gemini-deep-research-response.md)
- [OK] Deep Research 최종 브리핑: Stage 1.6 최종 브리핑 저장됨 (knowledge/daily/manual-kit/2026-04-08/10-stage1-6-final-research-briefing.md)
- [ERROR] Freshness / Run ID: run-id 혼재: 2026-04-08-130953, 2026-04-08-122720 (data/analysis-state/2026-04-08/stage4-execution-plan.json)
- [OK] 종목 코드 정규화: 포트폴리오/실행계획 종목 코드 해석 완료 (data/portfolio/latest.json)
- [OK] Fallback Recovery: 추가 복구 fallback 없음 (data/analysis-state/2026-04-08/fallback-summary.json)
