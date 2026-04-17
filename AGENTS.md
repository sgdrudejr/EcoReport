# AGENTS.md

> **실행 진입점 → [`docs/EXECUTION_GUIDE.md`](docs/EXECUTION_GUIDE.md)**

You are working in `/Users/seo/Documents/Playground/economy-report`.
The legacy checkout lives at `/Users/seo/Documents/Playground/stock-pilot-archive` and is archive-only unless the user explicitly asks to recover something from it.

This repository follows a persistent `LLM Wiki` operating model inspired by Karpathy's `raw -> wiki -> schema` pattern.

## Mission

Treat EcoReport as two linked systems:

1. the daily execution engine
2. the persistent investment memory

The execution engine lives in:

- `data/`
- `reports/`
- `knowledge/daily/`
- `scripts/`

The persistent memory lives in:

- `knowledge/wiki/`

Your job is not only to answer the immediate question, but to help the knowledge compound over time.

## Non-Negotiable Rule

If you produce an insight that would be useful again later, do not let it disappear into chat history.
Update or create the appropriate page in `knowledge/wiki/`.

## Source-Of-Truth Rules

1. `data/` is the raw and computed evidence layer.
2. `knowledge/daily/` is working memory for a given date.
3. `knowledge/wiki/` is the durable synthesized layer.
4. Do not redesign or flatten the repository structure.
5. Keep all new wiki behavior inside `knowledge/wiki/` and helper scripts, unless the user explicitly wants a broader refactor.
6. Treat `open-trading-api/` under the repo root as the local KIS helper workspace that supports execution scripts.

## Default Workflow

### When the task is about today's pipeline or outputs

1. Check the relevant date under `data/analysis-state/YYYY-MM-DD/`
2. Check `knowledge/daily/` if prompts or briefings matter
3. Read `knowledge/wiki/index.md`
4. Read the relevant account/security/daily wiki pages
5. Do the requested work
6. File durable conclusions back into `knowledge/wiki/`

### When the task is a research or portfolio question

1. Read `knowledge/wiki/index.md` first
2. Narrow to the smallest useful set of wiki pages
3. Verify against raw evidence in `data/` as needed
4. Answer with explicit evidence and invalidation logic
5. If the conclusion is durable, update `knowledge/wiki/`

### When new daily outputs are generated

Run:

```bash
node scripts/build-llm-wiki.js --date YYYY-MM-DD
```

If `run-daily-system.sh` was used, this should already happen automatically.

## What Good Wiki Pages Must Answer

For account/security pages, prefer content that answers:

1. Why can this make money?
2. In which account or category does it belong?
3. What evidence supports it?
4. What would invalidate the thesis?
5. What should be checked next?

## Lint Mindset

When you notice problems, fix or call out:

- stale action lines
- missing evidence
- duplicated thesis pages
- broken or absent cross-links
- conclusions that never got written back into the wiki

## Important Files

- `README.md`
- `CLAUDE.md`
- `docs/EXECUTION_GUIDE.md`
- `docs/OPERATOR_RUNBOOK.md`
- `docs/LLM_WIKI_SYSTEM.md`
- `knowledge/wiki/index.md`
- `knowledge/wiki/overview.md`
- `knowledge/wiki/log.md`

## Obsidian

This repository itself is the Obsidian vault.
Do not assume a separate publish step is needed.
If you update `knowledge/wiki/`, the changes should be visible directly in Obsidian when the user opens `/Users/seo/Documents/Playground/economy-report`.
