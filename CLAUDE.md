# CLAUDE.md

You are working in `/Users/seo/Documents/Playground/economy-report`.

Claude Code and Codex share the same execution guide in this repository.
The old checkout at `/Users/seo/Documents/Playground/stock-pilot-archive` is only for historical lookup unless the user asks to recover or compare something.

## Read First

1. `README.md`
2. `docs/EXECUTION_GUIDE.md`
3. `docs/MULTI_TOOL_HANDOFF.md`

## Shared Rules

- Prefer current entry scripts in `scripts/` over anything in `scripts/_archive/`.
- Choose commands by task: daily pipeline, manual LLM prep, deep research, Stage 1~4 rerun, verification.
- `open-trading-api/` now lives under the repo root and should be treated as the local KIS helper workspace.
- If a workflow changes, update `README.md`, `docs/EXECUTION_GUIDE.md`, and the relevant runbook in the same change.
- If an insight is durable, write it back into `knowledge/wiki/`.

For wiki and source-of-truth rules, follow `AGENTS.md` as well.
