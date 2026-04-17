# EcoReport Data Architecture V2

## Why this document exists

EcoReport now has enough raw data sources.

The next bottleneck is no longer collection volume. It is the lack of a single
data model that lets these sources speak the same language:

- broker reports
- StockEasy
- MarketVoice
- portfolio snapshots
- technical data
- macro data
- Gemini / Shadow outputs

Today, too much cross-source merging still happens inside prompt text or
script-local heuristics. That makes the system:

- harder to debug
- easier to bias through prompt wording
- harder to compare one source against another
- harder to prove why a recommendation happened

The goal of V2 is to insert a structured layer between raw collection and
Stage 1~4 decisions.

## Design goal

Move from:

`raw source files -> stage scripts -> prompt-heavy synthesis`

to:

`raw source files -> normalized observations -> evidence graph -> decision features -> Stage 1~4 / dashboard / wiki`

This keeps the current Stage 1~4 split, but gives them cleaner inputs.

## Current pain points

### 1. Source semantics are fragmented

The same real-world idea appears in many incompatible shapes:

- report themes
- StockEasy sectors
- MarketVoice topics
- technical categories
- strategy target allocations

Example:

- `AI 인프라`
- `전력 인프라`
- `전력기기`
- `HBM/메모리`

These often refer to related thesis clusters, but the system currently aligns
them through custom logic scattered across multiple scripts.

### 2. Recommendations mix evidence with policy too early

`strategy.json`, prompt guidance, and prior account narratives currently steer
the model before we have a neutral evidence view.

That makes it difficult to distinguish:

- what the market data actually says
- what our portfolio policy prefers

### 3. Cross-source agreement and disagreement are not first-class outputs

We need an explicit way to answer:

- Which ideas are supported by reports and StockEasy at the same time?
- Which themes are strong externally but weak in our internal scoring?
- Which recommendations are coming from policy, not evidence?

### 4. Failures are visible, but degraded evidence quality is not

We already record pipeline failures well.
What is still weak is a structured signal for:

- stale data
- fallback/mock output
- partial capture
- weak evidence density
- low cross-source support

## Target architecture

### Layer 0. Raw layer

Responsibility:

- store what each collector fetched
- preserve source-native structure
- avoid destructive rewriting

Examples:

- `data/reports/YYYY-MM-DD/index.json`
- `data/reports/YYYY-MM-DD/text-manifest.json`
- `data/external/stockeasy/YYYY-MM-DD/snapshot.json`
- `data/analysis-state/YYYY-MM-DD/marketvoice-linked.json`
- `data/portfolio/latest.json`
- `data/market/YYYY-MM-DD.json`
- `data/macro/fred-YYYY-MM-DD.json`

This layer answers:

- What did we collect?
- When did we collect it?
- How complete was it?

### Layer 1. Normalized observations

Responsibility:

- convert each source into a shared observation schema
- preserve provenance
- express freshness, direction, strength, confidence, and quality flags

Canonical output directory:

- `data/normalized/YYYY-MM-DD/`

Proposed files:

- `reports.normalized.json`
- `stockeasy.normalized.json`
- `marketvoice.normalized.json`
- `portfolio.normalized.json`
- `technical.normalized.json`
- `macro.normalized.json`
- `llm.normalized.json`

This layer answers:

- What claims or observations does each source make?
- Which entity does each observation refer to?
- How strong or fresh is the observation?

### Layer 2. Evidence graph

Responsibility:

- link entities to each other through typed relationships
- keep support/opposition/translation/hedge relationships explicit
- make lineage inspectable

Canonical output directory:

- `data/evidence/YYYY-MM-DD/`

Proposed files:

- `evidence-graph.json`
- `entity-catalog.json`

This layer answers:

- Why is this account linked to this theme?
- Which sources support this trade?
- Which sources disagree?

### Layer 3. Decision features

Responsibility:

- convert graph relationships into stable feature packs for downstream scripts
- make Stage 2/3/4 consume features, not raw source-specific blobs

Canonical output directory:

- `data/features/YYYY-MM-DD/`

Proposed files:

- `account-feature-matrix.json`
- `security-feature-matrix.json`
- `theme-feature-matrix.json`
- `cross-source-consensus.json`
- `source-divergence.json`
- `quality-matrix.json`

This layer answers:

- What is the net evidence for each account/security/theme?
- Where do sources agree?
- Where do sources conflict?
- Where is confidence low because evidence is weak or stale?

### Layer 4. Decision and presentation

Responsibility:

- Stage 1~4
- rich briefing
- dashboard
- wiki

This layer should use:

- normalized observations
- evidence graph
- feature matrices

instead of re-deriving cross-source logic ad hoc.

## Canonical entity model

All higher layers should converge on these entity types:

- `security`
- `account`
- `theme`
- `sector`
- `macro_event`
- `category`
- `report`
- `strategy_rule`

Each entity should have:

- stable `entityId`
- `entityType`
- display `name`
- optional aliases
- optional mapping to account/security/category/theme universe

Examples:

- `security:132030`
- `account:ISA`
- `theme:AI_INFRA`
- `sector:POWER_EQUIPMENT`
- `macro_event:MIDDLE_EAST_OIL_RISK`

## Core relationship types

The evidence graph should support at least:

- `supports`
- `opposes`
- `mentions`
- `belongs_to`
- `mapped_to`
- `translates_to`
- `hedges`
- `raises_risk_for`
- `preferred_for`
- `candidate_for`
- `derived_from`

Examples:

- `report -> supports -> theme`
- `StockEasy sector -> translates_to -> ETF`
- `macro_event -> hedges -> gold ETF`
- `security -> belongs_to -> account`
- `theme -> preferred_for -> account`

## Source adapter policy

### Reports

Raw input:

- `index.json`
- `text/*.txt`
- `stage1-report-extracts-v2.json`

Normalized observations should include:

- report stance on theme/sector/security
- explicit ticker mention strength
- evidence snippets
- freshness
- broker/source quality flags

### StockEasy

Raw input:

- market signals
- sector board
- trend maintenance
- theme board
- comprehensive RS
- report tables
- strategy room summary

Normalized observations should include:

- sector momentum observations
- theme leadership observations
- security-level relative strength observations
- strategy-room bias observations
- translation candidates from theme -> ETF/security

### MarketVoice

Raw input:

- topic list
- subtopics
- linked portfolio matches
- impact reports

Normalized observations should include:

- macro-event observations
- theme-risk observations
- portfolio-linked risk/support observations

### Portfolio

Raw input:

- `data/portfolio/latest.json`

Normalized observations should include:

- account cash pressure
- holding concentration
- active exposure by theme/category
- missing hedge / missing core / overexposure markers

### Technical

Raw input:

- `data/technical/YYYY-MM-DD.json`

Normalized observations should include:

- trend state
- momentum state
- timing risk
- overheat / oversold conditions

### Macro

Raw input:

- `fred-YYYY-MM-DD.json`
- market snapshot

Normalized observations should include:

- inflation pressure
- liquidity regime
- risk-on / risk-off backdrop
- hedge demand regime

### LLM outputs

Raw input:

- deep research responses
- shadow outputs
- rich briefing

Normalized observations should include:

- structured thesis claims
- action proposals
- invalidation conditions
- substitute/hedge mappings

Important:

LLM outputs should be normalized as evidence, not treated as final truth.
They should carry:

- `qualityFlags: ["llm_generated"]`
- source lineage
- optional manual approval markers later

## Stage 2 should split into two passes

This is one of the biggest improvements we should make.

### Pass A. Evidence-only synthesis

Input:

- normalized observations
- evidence graph
- consensus/divergence features

Task:

- summarize what the evidence says without portfolio policy
- surface agreement, disagreement, and uncertainty

Output:

- `data/features/YYYY-MM-DD/evidence-synthesis.json`

Questions it should answer:

- What is strong?
- What is weak?
- What is contradictory?
- What is under-evidenced?

### Pass B. Policy-aware decision

Input:

- evidence-only synthesis
- `strategy.json`
- account tax rules
- reserve cash policy
- execution rules

Task:

- convert evidence into actions for ISA / PENSION / KIS_MAIN

Output:

- existing Stage 2/4 compatible decision artifacts

This split makes it much easier to detect prompt bias.

## Proposed file layout

```text
data/
  raw/
    YYYY-MM-DD/
      reports/
      stockeasy/
      marketvoice/
      portfolio/
      market/
      macro/
      llm/
  normalized/
    YYYY-MM-DD/
      reports.normalized.json
      stockeasy.normalized.json
      marketvoice.normalized.json
      portfolio.normalized.json
      technical.normalized.json
      macro.normalized.json
      llm.normalized.json
  evidence/
    YYYY-MM-DD/
      entity-catalog.json
      evidence-graph.json
  features/
    YYYY-MM-DD/
      account-feature-matrix.json
      security-feature-matrix.json
      theme-feature-matrix.json
      cross-source-consensus.json
      source-divergence.json
      quality-matrix.json
      evidence-synthesis.json
```

We do not need to move current files immediately.
The first step is to generate these new files in parallel with existing outputs.

## Migration plan

### Phase 1. Add normalized layer

New scripts:

- `scripts/build-normalized-reports.js`
- `scripts/build-normalized-stockeasy.js`
- `scripts/build-normalized-marketvoice.js`
- `scripts/build-normalized-portfolio.js`
- `scripts/build-normalized-technical.js`
- `scripts/build-normalized-macro.js`
- `scripts/build-normalized-llm.js`

Goal:

- no behavior change yet
- just generate normalized bundles

### Phase 2. Add evidence graph

New script:

- `scripts/build-evidence-graph.js`

Goal:

- unify report/theme/security/account relationships
- make support/opposition lineage queryable

### Phase 3. Add decision features

New script:

- `scripts/build-decision-features.js`

Goal:

- output consensus/divergence/quality/account-security-theme matrices

### Phase 4. Rewire Stage 2 prompt generation

Modify:

- `scripts/build-stage2-strategy-prompt.js`
- `scripts/build-stage1-5-gemini-deep-research-prompt.js`
- `scripts/build-stage1-7-gemini-follow-up-prompt.js`

Goal:

- read evidence packs instead of ad hoc raw blobs
- reduce hard-coded narrative priors

### Phase 5. Rewire Stage 3 and Stage 4

Modify:

- `scripts/build-stage3-quant-scores.js`
- `scripts/build-stage4-execution-plan.js`

Goal:

- consume feature matrices directly
- produce more explainable scores and account actions

### Phase 6. Dashboard and wiki upgrade

Modify:

- dashboard account cards
- recommendation boards
- wiki generation

Goal:

- show `support`, `opposition`, `divergence`, and `quality`

## Acceptance criteria

V2 should be considered successful when:

1. every recommendation can cite its upstream observations
2. cross-source agreement is queryable without prompt inspection
3. degraded evidence quality is visible in structured output
4. Stage 2 can distinguish evidence from policy
5. adding a new source mostly means writing one new normalizer, not editing many downstream scripts

## Immediate next implementation target

The best first real build is:

1. normalized reports
2. normalized StockEasy
3. normalized MarketVoice
4. evidence graph
5. cross-source consensus file

That is the minimum slice that unlocks better reasoning without rewriting the
whole system at once.
