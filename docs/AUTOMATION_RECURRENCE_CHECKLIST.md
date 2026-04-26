# EcoReport Automation Recurrence Checklist

이 체크리스트는 `npm run daily -- --date <trading-date>` 자동화가 같은 이유로 다시 실패하지 않도록, 실행 전에 확인하고 바로 복구할 수 있는 항목만 남긴 운영용 체크리스트다.

## 1. 실행 환경

- 자동화 실행 환경은 `local`을 기본으로 유지한다.
- 기준 저장소는 `/Users/seo/Documents/Playground/economy-report` 이어야 한다.
- `git remote get-url origin` 결과에 `github.com/sgdrudejr/EcoReport`가 포함되어야 한다.
- `git status --short --branch`가 읽혀야 하고, 현재 브랜치 또는 detached 상태가 사람이 해석 가능해야 한다.
- `git fetch --all --prune`가 성공해야 한다.
- `resolve-cycle-date.js`는 현재 로컬 `trading-calendar` 기반으로 계산되므로 외부 캘린더 API 의존성으로 분류하지 않는다.

## 2. 자동 복구 자산

- worktree 또는 임시 체크아웃에서 실행되더라도 아래 자산이 없으면 기준 저장소에서 연결한다.
- `.env`
- `.venv`
- `node_modules`
- `open-trading-api`
- `config/telegram_notify.env`
- `config/local-paths.local.json`

실행 명령:

```bash
node scripts/bootstrap-automation-runtime.js
```

## 3. Python / API 의존성

- `.venv/bin/python`이 존재해야 한다.
- `requests`가 있어야 FRED 단계가 실패하지 않는다.
- `google.genai`가 있어야 Gemini Python 단계가 mock fallback으로 떨어지지 않는다.
- `GEMINI_API_KEY`, `FRED_API_KEY`가 `.env`에서 읽혀야 한다.
- 현재 저장소에서는 `--mock-stage2`가 비활성화되어 있으므로 우회책으로 사용하지 않는다.

## 4. Telegram / 게시

- `config/telegram_notify.env`에 `BOT_TOKEN`과 `CHAT_ID` 또는 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`가 있어야 한다.
- `config/telegram.json`은 env reference를 사용해도 된다.
- Obsidian vault 경로는 쓰기 가능해야 한다.

## 5. 실행 전 readiness

실행 명령:

```bash
node scripts/check-automation-readiness.js --date <trading-date>
```

여기서 확인해야 하는 항목:

- runtime assets
- FRED Python requests
- Stage 2 Gemini Python
- Telegram delivery config
- report collection network 또는 fallback assets
- Safari automation
- StockEasy smoke
- GitHub network
- vault publish target

## 6. 실행 후 확인

- `data/analysis-state/<date>/automation-cycle.json`
- `data/analysis-state/<date>/system-health.json`
- `reports/daily/<date>-briefing.md`
- `reports/daily/<date>-briefing.html`
- `knowledge/wiki/daily/<date>.md`

## 7. 금지 규칙

- Stage 2가 `fallback_mock`로 내려갔는데 완료처럼 보고하지 않는다.
- `automation-cycle` 또는 `system-health`가 없으면 성공으로 간주하지 않는다.
- Telegram 첨부 파일이 없으면 원인과 누락 경로를 함께 남긴다.
