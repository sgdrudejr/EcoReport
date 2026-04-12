# Emergency Alerts (2026-04-10)

- fired: 0 / 8

- [idle] VIX 급등 / 조건: vix > 35 / 실제값: 19.49 / 액션: emergency_eval
- [idle] VIX 급변 / 조건: vix_change_pct > 0.1 / 실제값: N/A / 액션: emergency_eval
- [idle] 보유종목 급락 / 조건: any_holding_daily_change < -0.05 / 실제값: -0.005671 / 상세: TOSS KODEX 선진국ESG액티브(251350) -0.57% / 액션: emergency_eval
- [idle] WTI 급등 / 조건: wti > 120 / 실제값: 96.57 / 액션: emergency_eval
- [idle] WTI 급락 / 조건: wti < 70 / 실제값: 96.57 / 액션: emergency_eval
- [idle] 환율 급등 / 조건: usdkrw > 1550 / 실제값: 1480.86 / 액션: emergency_eval
- [idle] 환율 급변 / 조건: usdkrw_change_pct > 0.01 / 실제값: N/A / 액션: emergency_eval
- [idle] 이란 종전 / 조건: keyword_detected('ceasefire','iran') / 실제값: corpus / 액션: full_rebalance
