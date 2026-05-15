# EcoReport Wiki Log

## [2026-05-15] blocked | Qwen Stage 2 connection failure left outputs incomplete

- Baseline collection itself succeeded with 80 reports, 80 text files, and fresh RAG corpora, but the Windows local summarizer never came up after Wake-on-LAN so `reports/report_summaries/2026-05-15` stayed absent.
- Real Qwen Stage 2 remained strict and failed with `Connection error`, leaving Stage 3/4, `qwen-account-strategy.json`, `stock-pulse.json`, `dashboard-view.json`, the execution-plan table, and `final.html` all missing.
- `daily:final-output` and `verify` were rerun manually and both failed exactly because `report_summaries` or downstream Stage 3/4 artifacts were absent.
- Telegram completion was attempted but not delivered: `node scripts/send-telegram-summary.js --date 2026-05-15 --event automation-cycle-complete ...` ended with `[telegram-summary] 실패: fetch failed` even though Telegram secrets were present.
- Cockpit LaunchAgent was still marked `running`, but HTTP on `http://127.0.0.1:3000/cockpit` and `http://localhost:3000/cockpit` both returned connection failure at verification time.

## [2026-05-14] blocked | Report summaries missing after baseline succeeded

- Baseline collection itself succeeded with 92 reports, 92 text files, and fresh RAG corpora, but the Windows local summarizer never came up after Wake-on-LAN so `reports/report_summaries/2026-05-14` stayed absent.
- Real Qwen Stage 2 remained strict and failed with `Connection error`, leaving Stage 3/4, `qwen-account-strategy.json`, `stock-pulse.json`, `dashboard-view.json`, the execution-plan table, and `final.html` all missing.
- `daily:final-output` and `verify` were rerun manually and both failed exactly because `report_summaries` or downstream Stage 3/4 artifacts were absent; Cockpit was also down at `http://127.0.0.1:3000/cockpit`.
- Telegram completion was attempted but not delivered: `node scripts/send-telegram-summary.js --date 2026-05-14 --event automation-cycle-complete ...` ended with `[telegram-summary] 실패: fetch failed` even though Telegram secrets were present.

## [2026-05-13] blocked | Stage 2 connection failure and missing report summaries

- Same-day automation never produced `automation-cycle.json`; baseline collection completed, but the runner did not reach a confirmed completion/Telegram stage.
- Real Qwen Stage 2 on DashScope failed with `Connection error` even when retried directly with `webSearch=true`, `forcedSearch=true`, and `searchStrategy=turbo`, so Stage 3 and Stage 4 were never created.
- `daily:final-output` failed immediately because `reports/report_summaries/2026-05-13` was absent, leaving final HTML and the execution-plan table missing.
- Partial recovery artifacts do exist: `qwen-account-strategy.json` records the exact provider/model/error, `stock-pulse.json` covers 14 active holdings with 4 high-urgency and 5 medium-urgency names, and `dashboard-view.json` was rebuilt but remains empty because holding cards and Stage 4 are missing.

## [2026-05-12] blocked | Stage 2 summary and Qwen both unavailable

- Same-day automation stayed `overallStatus: warn`, `sameDayStatus: incomplete`, and `system-health: error`, so Stage 3/4 plus final HTML/output table were not produced.
- Windows local report summarization never came up after repeated Wake-on-LAN, `reports/report_summaries/2026-05-12` stayed absent, and real Qwen account strategy on DashScope failed with `Connection error` even with `webSearch=true`.
- Partial recovery artifacts now exist and should be reused on the next recovery run: `qwen-account-strategy.json` records the exact provider/model/error, `stock-pulse.json` covers 17 active holdings with 4 high-urgency and 4 medium-urgency names, and `dashboard-view.json` was rebuilt but remains effectively empty because Stage 4 is missing.

## [2026-05-11] blocked | Stage 2 Qwen auth failure

- Same-day automation did not complete the investment decision path: `system-health` stayed `error`, `sameDayStatus` stayed `incomplete`, and Stage 3/4 plus final HTML/output table were not produced.
- The hard blocker was real Qwen Stage 2 on DashScope failing with `invalid_api_key`; the Windows local summary server also stayed down after Wake-on-LAN and `report_summaries/2026-05-11` stayed empty.
- Partial recovery artifacts still exist and are usable with caution: `stock-pulse.json` covers 14 holdings with 3 high-urgency names, `qwen-account-strategy.json` records the exact provider/model/error, and the local Cockpit route itself was reachable at `http://127.0.0.1:3000/cockpit`.

## [2026-04-30] blocked | Daily pipeline incomplete

- Preserved a blocked daily wiki page because the automation stopped short of valid Stage 2 through Stage 4 outputs.
- Same-day report collection fell back to `2026-04-29`, the Windows local summarizer stayed offline, and real Qwen strategy generation failed with mock fallback disabled.
- Final report HTML and the execution plan table were not regenerated, so this date remains an operations recovery checkpoint.

## [2026-04-28] blocked | Daily pipeline incomplete

- Preserved a local daily wiki page for a degraded automation run instead of a normal compile.
- Same-day report collection, Windows local LLM, and Qwen strategy generation all failed on connectivity/runtime issues.
- Final execution plan and final HTML were not produced, so this date should be treated as an operations recovery checkpoint.

## [2026-04-03] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.

## [2026-04-06] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.

## [2026-04-07] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.

## [2026-04-08] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.

## [2026-04-09] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.

## [2026-04-10] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.

## [2026-04-13] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.

## [2026-04-14] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.

## [2026-04-15] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.

## [2026-04-20] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.

## [2026-04-22] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.

## [2026-04-23] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.

## [2026-04-27] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.

## [2026-04-29] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.

## [2026-05-04] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.

## [2026-05-06] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.

## [2026-05-08] automation | Outputs regenerated, verification still blocked

- 2026-05-10 재실행에서 체크포인트를 재사용해 메인 자동화는 `overallStatus: ok`, `sameDayStatus: complete`로 마무리됐고, Stage 2는 실제 모델 `qwen3.5-27b` 경로를 유지했습니다.
- `daily:final-output` 재실행으로 Qwen 계좌 전략, stock pulse, dashboard view, rotation watch, 실행전략 표가 다시 생성됐고 Qwen 계좌 전략은 `qwen3.5-plus` + 웹검색(`forcedSearch=true`, `searchStrategy=turbo`)으로 성공했습니다.
- stock pulse는 현재 보유 13종목을 모두 커버했고, 고긴급 3건·중긴급 7건을 표시했습니다.
- 다만 `verify`는 아직 실패합니다. 현재 `system-health`의 핵심 이슈는 `stage3_quality` 오류(`unrelated 0.51 / blocked 23건`)와 `market:2026-05-07` fallback 복구 경고입니다.
- Telegram completion 스텝은 체크포인트상 `ok`였고, 포맷에는 계좌 피드백, stock-pulse 하이라이트, Mac/같은 Wi-Fi Cockpit URL이 포함됩니다. 그러나 같은 시점 QA에서 `http://127.0.0.1:3000/cockpit`은 연결 실패 상태였습니다.

## [2026-05-07] compile | Daily pipeline -> persistent wiki

- Built daily decision memo from Stage 1~4 outputs.
- Refreshed account playbooks from portfolio, strategy, and execution plan.
- Refreshed security thesis pages for holdings and active candidates.
- Refreshed operating rules, research backlog, and decision journal memory pages.
