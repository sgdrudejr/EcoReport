# EcoReport Stage Contract Validation (2026-04-05)

- overallStatus: **error**
- generatedAt: 2026-04-09T06:01:46.514Z
- stage1Extracts: 0
- stage1Candidates: 0
- impactCount: 0
- stage2Mode: actual
- stage3Holdings: 10
- stage4Plans: 3

## Checks
- [OK] Portfolio Snapshot Present: 계좌 3개 / coded holdings 9개
- [WARN] Portfolio Snapshot Completeness: incomplete 계좌 0개 / code 누락 holding 8개 | ledger: portfolio_snapshot_incomplete -> docs/rules/repair-playbooks.md#portfolio-snapshot-incomplete | examples: TIGER 미국S&P500, TIGER 미국배당다우존스스타데일리커..., KODEX KOFR금리액티브(합성), TIGER 미국나스닥100, HANARO 원자력iSelect
- [ERROR] Stage 1 Extracts Present: stage1-report-extracts-v2.json 이 없거나 extracts가 비어 있습니다.
- [WARN] Stage 1 Required Fields: Stage 1 산출물이 없어 field-level validation을 건너뜁니다.
- [WARN] Stage 1 Candidate Shape: Stage 1 산출물이 없어 candidate validation을 건너뜁니다.
- [OK] Impact Map Present: impact 0건
- [OK] Impact Map Bridge Coverage: Stage 1 candidate 0건 중 impact 0건으로 연결되었습니다. | ledger: impact_map_empty_with_stage1_candidates -> docs/rules/repair-playbooks.md#impact-map-empty
- [OK] Impact Map Reference Integrity: impact-map의 report/ticker/shape 연결이 정상입니다.
- [OK] Impact Map Coverage Count Consistency: coverage.impact_count 와 실제 impact 개수가 일치합니다.
- [OK] Stage 2 Availability: 실제 Stage 2 결과 사용 (gemini-2.5-flash) | ledger: stage2_missing_or_mock -> docs/rules/repair-playbooks.md#stage-2-missing-or-mock
- [OK] Stage 2 Holdings Bias Shape: holdings_bias 9건이 기본 계약을 충족합니다.
- [OK] Stage 2 Unknown Tickers: Stage 2 ticker가 portfolio/watchlist universe 안에 있습니다.
- [OK] Stage 3 Quant Present: holding 10건
- [WARN] Stage 3 Portfolio Coverage: Stage 3 누락 ticker 0건 / extra ticker 1건 | examples: PLUS V자산:undefined
- [OK] Stage 3 Report Reference Integrity: Stage 3 reportImpacts가 Stage 1 extract id와 연결됩니다.
- [OK] Stage 3 Impact Coverage Consistency: impact-map(0)와 Stage 3 impactCoverage(0)가 대체로 일치합니다.
- [OK] Stage 4 Plan Present: account plan 3건
- [OK] Stage 4 Account Alignment: Stage 4 accountPlans가 현재 포트폴리오 계좌와 정렬됩니다.
- [OK] Stage 4 Action Line Presence: 모든 account plan에 actionLine이 있습니다.
- [OK] Stage 4 Driver Reference Integrity: Stage 4 stage1Drivers가 Stage 1 extract id와 연결됩니다.
- [OK] Stage 4 Driver Coverage: Stage 4에 연결된 stage1Drivers 0건 | ledger: stage4_missing_stage1_drivers -> docs/rules/repair-playbooks.md#stage-4-missing-stage-1-drivers
- [OK] Cross-Stage Date Alignment: 모든 주요 산출물의 date가 2026-04-05와 일치합니다.
