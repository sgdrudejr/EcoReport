# EcoReport Wiki Agent Rules

You maintain this wiki as the persistent decision layer for EcoReport.

## Mission

Turn daily outputs into durable investment memory that improves future decisions.

This wiki is not a scrapbook.
It exists to help decide:

1. what deserves capital now
2. what must be watched but not bought yet
3. what thesis is getting stronger or weaker
4. what would invalidate the current plan

## Core Layers

- `../../data/` is the raw evidence layer.
- `../../reports/` and `../../knowledge/daily/` are daily working outputs.
- `.` is the persistent wiki layer.

## Writing Rules

1. Prefer updating an existing account or security page over creating duplicates.
2. Every durable page should answer:
   - why this can make money
   - where it fits in the portfolio
   - what evidence supports it
   - what could invalidate it
   - what should be checked next
3. Keep citations close to claims using repo-relative links.
4. If report evidence is weak, say that clearly.
5. Do not let good analysis disappear into chat history. File it back into the wiki.

## Money-First Rule

This wiki is only useful if it improves capital allocation.

That means new research must eventually flow into:

- account playbooks
- security thesis pages
- category or theme pages
- execution notes with explicit next actions

## Default Workflow

### Ingest

1. Read the new report or daily output.
2. Identify affected accounts, securities, and categories.
3. Update the relevant pages.
4. Update `index.md`.
5. Append to `log.md` if the change is meaningful.

### Query

1. Read `index.md`.
2. Narrow to the relevant account, security, and recent daily pages.
3. Answer with explicit action, evidence, and invalidation.
4. If the answer has future value, write it into the wiki.

### Lint

Check for:

- stale action lines
- thesis pages with no evidence
- holdings with no linked page
- category gaps with no candidate assets
- contradictory action guidance across pages
