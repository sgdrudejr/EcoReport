# Mac Mini Handoff

Last audited: 2026-05-15 KST

This document captures the local-only EcoReport setup from the old Mac mini so a new Mac can take over without losing automations, secrets, or runtime assumptions. Do not paste real secret values into this file.

## Repository

Clone the project:

```bash
mkdir -p ~/Documents/Playground
cd ~/Documents/Playground
git clone https://github.com/sgdrudejr/EcoReport.git economy-report
cd economy-report
git checkout codex/build-report-chunk-index
```

Important pushed branches from the old Mac mini:

- `codex/build-report-chunk-index`: latest dashboard/research/data artifacts.
- `codex/shadow-main-merge`: shadow pipeline plus feedback/portfolio refresh artifacts.
- `main`: latest published mainline.
- `codex/feedback-allocation-clusters`: archive worktree branch used by `stock-pilot-archive`.

Install dependencies:

```bash
cd ~/Documents/Playground/economy-report
npm install
cd dashboard
npm install
cd ..
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

If Playwright is used for Gemini/StockEasy captures:

```bash
npx playwright install chromium
```

## Secret Files To Recreate

These files existed only on the old Mac mini and are intentionally ignored by git.

### Project `.env`

Create:

```bash
cp .env.example .env
```

Fill at least the keys you use:

- `GEMINI_API_KEY`: Gemini API analysis and briefing.
- `QWEN_API_KEY` or `DASHSCOPE_API_KEY`: Qwen/DashScope strategy, account coach, cockpit coach.
- `FRED_API_KEY`: FRED macro data.
- `ANTHROPIC_API_KEY`: optional Claude report compression/synthesis path.
- `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL`: optional local LLM fallback.
- `ECOREPORT_ROOT`: optional if clone path is not `~/Documents/Playground/economy-report`.
- `OBSIDIAN_VAULT_DIR`: optional wiki publish target.

Old Mac mini note: `~/.zshrc` also exported a DashScope key directly. Prefer moving that value into `.env` on the new Mac instead of keeping global shell-level credentials.

### Dashboard `.env.local`

Create:

```bash
cp dashboard/.env.local.example dashboard/.env.local
```

Fill:

- `GEMINI_API_KEY`: dashboard OCR/data features.
- `GEMINI_PORTFOLIO_MODEL`: optional, default `gemini-2.5-flash`.
- `GITHUB_TOKEN`: required only if dashboard trigger/save APIs should dispatch GitHub or push updates.

### Telegram

Create:

```bash
cp config/telegram_notify.env.example config/telegram_notify.env
```

Fill:

- `BOT_TOKEN` and `CHAT_ID`, or equivalent `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

The old Mac mini had `config/telegram_notify.env` present. Recent logs show Telegram secrets were present but some sends failed with `fetch failed`, so verify network delivery on the new Mac.

### KIS / Korea Investment Config

These files were under `~/KIS/config` on the old Mac mini:

- `kis_devlp.yaml`
- `kis_devlp-isa.yaml`
- `kis_devlp-pension.yaml`

Use the templates in `config/kis-profiles/`, then place filled files in:

```bash
mkdir -p ~/KIS/config
cp config/kis-profiles/kis_devlp-isa.template.yaml ~/KIS/config/kis_devlp-isa.yaml
cp config/kis-profiles/kis_devlp-pension.template.yaml ~/KIS/config/kis_devlp-pension.yaml
```

Also recreate the main profile as `~/KIS/config/kis_devlp.yaml`. If the config directory lives elsewhere, set:

```bash
export KIS_CONFIG_ROOT=/path/to/KIS/config
```

Validate:

```bash
node scripts/sync-kis-portfolio.js --date "$(date +%F)"
```

## Local Automations

### Codex Cron Automations

The old Mac mini had two active Codex local cron automations in `~/.codex/automations`.

1. `EcoReport Daily Automation`
   - id: `1-1`
   - schedule: every day at 10:00 Asia/Seoul
   - cwd: `/Users/seo/Documents/Playground/economy-report`
   - model: `gpt-5.4`
   - reasoning: `high`
   - main commands:
     - `npm run automation:bootstrap`
     - `npm run audit:filing`
     - `npm run automation:daily -- --date <effective_market_date> --run-date <run_date>`
     - `npm run daily:final-output -- --date <effective_market_date> --run-date <run_date> --effective-market-date <effective_market_date>`
     - `npm run verify -- --date <effective_market_date> --run-date <run_date> --effective-market-date <effective_market_date>`
   - dashboard check: `http://127.0.0.1:3000/cockpit`

2. `EcoReport Daily QA`
   - id: `ecoreport-daily-qa`
   - schedule: every day at 13:00 Asia/Seoul
   - cwd: `/Users/seo/Documents/Playground/economy-report`
   - model: `gpt-5.4`
   - reasoning: `low`
   - main purpose: inspect artifacts, regenerate final output if stale, run verify, report dashboard/Telegram health.

Recreate these in Codex on the new Mac, changing the cwd if the clone path differs.

### LaunchAgent: Dashboard Server

The active old Mac mini dashboard agent was:

- label: `com.seo.ecoreport.dashboard`
- script: `/Users/seo/automation/scripts/run_ecoreport_dashboard.sh`
- working directory: `/Users/seo/Documents/Playground/economy-report`
- log: `/Users/seo/automation/logs/ecoreport-dashboard.log`
- URL: `http://127.0.0.1:3000/cockpit`

On the new Mac, prefer the repo-local script:

```bash
mkdir -p ~/Library/LaunchAgents ~/Library/Logs/ecoreport
cp ops/launchd/com.seo.ecoreport.dashboard.plist ~/Library/LaunchAgents/
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.seo.ecoreport.dashboard.plist
launchctl kickstart -k "gui/$(id -u)/com.seo.ecoreport.dashboard"
```

Stop/restart:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.seo.ecoreport.dashboard.plist
launchctl kickstart -k "gui/$(id -u)/com.seo.ecoreport.dashboard"
```

### LaunchAgent: Legacy Python Automation

The old Mac mini also had `/Users/seo/automation`, a separate local-only Python automation folder. It was not a git repo. It provided:

- `/Users/seo/automation/orchestrator.py`
- `/Users/seo/automation/scripts/run_ecoreport_daily.py`
- `/Users/seo/automation/.env`
- `/Users/seo/automation/launchd/com.user.automation.plist`

Its launchd label was `com.user.automation`, scheduled daily at 10:00, running:

```bash
/Users/seo/automation/.venv/bin/python /Users/seo/automation/orchestrator.py --task ecoreport_daily
```

This overlaps with the Codex 10:00 automation. On the new Mac, either:

- skip this legacy automation and use the Codex cron, or
- copy `/Users/seo/automation` from the old Mac manually, recreate `/Users/seo/automation/.env`, and load its plist.

If copied, recreate these `/Users/seo/automation/.env` keys as needed:

- `AUTOMATION_BASE_DIR`
- `ECOREPORT_ROOT`
- `ECOREPORT_NPM_BIN`
- `ECOREPORT_NODE_BIN`
- `ECOREPORT_TIMEOUT_SECONDS`
- `ECOREPORT_SKIP_PUSH`
- `QWEN_API_KEY`
- `QWEN_MODEL`
- `QWEN_API_URL`
- `WINDOWS_LLM_HOST`
- `WINDOWS_LLM_USER`
- `WINDOWS_LLM_KEY_PATH`
- `WINDOWS_LLM_COMMAND`
- `WINDOWS_LLM_TIMEOUT_SECONDS`
- optional notification keys: `SLACK_WEBHOOK_URL`, `SMTP_*`, `NOTIFY_EMAIL_*`

### GitHub Actions Runner

The old Mac mini had a self-hosted GitHub runner:

- label: `actions.runner.sgdrudejr-EcoReport.SEOui-Macmini`
- working directory: `/Users/seo/actions-runner`
- launchd plist: `~/Library/LaunchAgents/actions.runner.sgdrudejr-EcoReport.SEOui-Macmini.plist`

Do not copy runner credentials blindly. On the new Mac, remove/register a fresh self-hosted runner from GitHub repository settings if this runner is still needed.

### Old Igzun Jobs

Old non-EcoReport jobs were also present:

- crontab entry for `/Users/seo/.openclaw/workspace/igzun-daily-report/scripts/daily_update.sh` at 11:00.
- LaunchAgent `com.seo.igzun-daily-report.daily` for `/Users/seo/igzun-daily-report/scripts/daily_update.sh` at 10:00.

These point to legacy paths and should not be recreated for EcoReport unless that separate project is intentionally migrated.

## Verification On New Mac

Run these after setting secrets:

```bash
cd ~/Documents/Playground/economy-report
npm run automation:bootstrap
npm run audit:filing
node scripts/check-automation-readiness.js --date "$(date +%F)" --run-date "$(date +%F)"
npm run verify -- --date "$(date +%F)" --run-date "$(date +%F)" --effective-market-date "$(date +%F)"
```

Start dashboard manually if launchd is not loaded yet:

```bash
bash scripts/run-dashboard-dev-server.sh
```

Then open:

```text
http://127.0.0.1:3000/cockpit
```

Run a controlled dry-ish daily path with explicit date:

```bash
npm run automation:daily -- --date YYYY-MM-DD --run-date YYYY-MM-DD
npm run daily:final-output -- --date YYYY-MM-DD --run-date YYYY-MM-DD --effective-market-date YYYY-MM-DD
npm run verify -- --date YYYY-MM-DD --run-date YYYY-MM-DD --effective-market-date YYYY-MM-DD
```

## Things Not In Git

Move these manually or regenerate them:

- `.env`
- `dashboard/.env.local`
- `config/telegram_notify.env`
- `~/KIS/config/*.yaml`
- `~/.codex/automations/*/automation.toml`
- `~/Library/LaunchAgents/*.plist` for local services
- `/Users/seo/automation` if you still want the legacy Python automation folder
- `/Users/seo/actions-runner` only if replacing/re-registering the self-hosted runner
- browser sessions used by Gemini web automation

## Current Preferred Operating Model

Use the repo as the source of truth, keep secrets in ignored local files, run the dashboard via `com.seo.ecoreport.dashboard`, and use Codex cron automations for the daily 10:00 run and 13:00 QA. Treat `/Users/seo/automation` as legacy unless there is a specific reason to keep the older Python orchestrator.
