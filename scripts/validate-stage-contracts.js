#!/usr/bin/env node
// Stage 1~4 산출물의 존재 여부뿐 아니라 단계 간 연결 품질을 검증합니다.

import path from "node:path";

import { ROOT_DIR, readJson, writeJson, writeText } from "./lib/pipeline-utils.js";

const HOLDING_ACTIONS = new Set(["BUY", "HOLD", "TRIM", "WATCH"]);
const IMPACT_DIRECTIONS = new Set(["positive", "negative", "neutral"]);

function parseArgs(argv) {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    output: null,
    markdown: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--date" && argv[index + 1]) {
      args.date = argv[index + 1];
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    } else if (token === "--markdown" && argv[index + 1]) {
      args.markdown = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function relative(filePath) {
  return path.relative(ROOT_DIR, filePath);
}

function statusFromCondition(condition, failLevel = "warn") {
  if (condition) return "ok";
  return failLevel;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function limitList(values, limit = 5) {
  return unique(values).slice(0, limit);
}

function countTruthy(values) {
  return values.filter(Boolean).length;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function getValueAtPath(payload, dottedPath) {
  return String(dottedPath ?? "")
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), payload);
}

function buildLedgerLookup(ledger) {
  const map = new Map();
  for (const entry of ledger?.entries ?? []) {
    if (entry?.validatorCheckId) {
      map.set(entry.validatorCheckId, entry);
    }
  }
  return map;
}

function createCheck(ledgerLookup, { id, label, status, detail, filePath, examples = [], metrics = null }) {
  const payload = {
    id,
    label,
    status,
    detail,
    path: filePath ? relative(filePath) : null,
  };

  if (examples.length > 0) {
    payload.examples = examples.slice(0, 5);
  }

  if (metrics) {
    payload.metrics = metrics;
  }

  const ledger = ledgerLookup.get(id);
  if (ledger) {
    payload.ledgerRef = {
      id: ledger.id,
      title: ledger.title,
      status: ledger.status,
      repairPlaybook: ledger.repairPlaybook,
    };
  }

  return payload;
}

function portfolioAccountKeys(portfolio) {
  return unique((portfolio?.accounts ?? []).map((account) => account.key));
}

function portfolioHoldings(portfolio) {
  return (portfolio?.accounts ?? []).flatMap((account) =>
    (account.holdings ?? []).map((holding) => ({
      ...holding,
      accountKey: account.key,
      accountLabel: account.label,
    })),
  );
}

function portfolioTickerSet(portfolio) {
  return new Set(
    unique(
      portfolioHoldings(portfolio)
        .map((holding) => holding.code)
        .filter(Boolean),
    ),
  );
}

function watchlistTickerSet(watchlist) {
  return new Set(
    unique(
      ["core_etf", "satellite_etf", "individual_stocks"].flatMap((section) =>
        toArray(watchlist?.[section]).map((item) => item.code),
      ),
    ),
  );
}

function extractIdSet(stage1) {
  return new Set(unique(toArray(stage1?.extracts).map((item) => item.id)));
}

function stage1Candidates(stage1) {
  return toArray(stage1?.extracts).flatMap((extract) =>
    toArray(extract.portfolio_impacts_candidate).map((candidate) => ({
      reportId: extract.id,
      reportTitle: extract.title,
      candidate,
    })),
  );
}

function impactEntries(impactMap) {
  return Object.entries(impactMap?.impacts ?? {}).flatMap(([ticker, impacts]) =>
    toArray(impacts).map((impact) => ({
      ticker,
      impact,
    })),
  );
}

function stage3HoldingEntries(stage3) {
  return Object.entries(stage3?.holdings ?? {}).map(([ticker, holding]) => ({
    ticker,
    holding,
  }));
}

function stage4Plans(stage4) {
  return toArray(stage4?.accountPlans);
}

function topLevelDateMismatches(expectedDate, records) {
  return records
    .filter((record) => record.payload && isNonEmptyString(record.payload.date) && record.payload.date !== expectedDate)
    .map((record) => `${record.name}:${record.payload.date}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const date = args.date;
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", date);

  const paths = {
    portfolio: path.join(ROOT_DIR, "data", "portfolio", "latest.json"),
    watchlist: path.join(ROOT_DIR, "config", "watchlist.json"),
    contractSpec: path.join(ROOT_DIR, "config", "stage-contracts.json"),
    stage1: path.join(analysisDir, "stage1-report-extracts-v2.json"),
    impactMap: path.join(analysisDir, "impact-map.json"),
    stage2: path.join(analysisDir, "stage2-strategy-options.json"),
    stage2Mock: path.join(analysisDir, "stage2-strategy-options.mock.json"),
    stage3: path.join(analysisDir, "stage3-quant-scores.json"),
    stage4: path.join(analysisDir, "stage4-execution-plan.json"),
    ledger: path.join(ROOT_DIR, "docs", "failure-ledger.json"),
  };

  const [
    portfolio,
    watchlist,
    stage1,
    impactMap,
    stage2Actual,
    stage2Mock,
    stage3,
    stage4,
    ledger,
    contractSpec,
  ] = await Promise.all([
    readJson(paths.portfolio, null),
    readJson(paths.watchlist, null),
    readJson(paths.stage1, null),
    readJson(paths.impactMap, null),
    readJson(paths.stage2, null),
    readJson(paths.stage2Mock, null),
    readJson(paths.stage3, null),
    readJson(paths.stage4, null),
    readJson(paths.ledger, { entries: [] }),
    readJson(paths.contractSpec, null),
  ]);

  const ledgerLookup = buildLedgerLookup(ledger);
  const checks = [];

  const accountKeys = portfolioAccountKeys(portfolio);
  const holdings = portfolioHoldings(portfolio);
  const codedHoldings = holdings.filter((holding) => holding.code);
  const portfolioTickers = portfolioTickerSet(portfolio);
  const watchlistTickers = watchlistTickerSet(watchlist);
  const incompleteAccounts = (portfolio?.accounts ?? []).filter((account) => account.incomplete);
  const uncodedHoldings = holdings.filter((holding) => !holding.code);

  checks.push(
    createCheck(ledgerLookup, {
      id: "portfolio_snapshot_present",
      label: "Portfolio Snapshot Present",
      status: statusFromCondition(accountKeys.length > 0, "error"),
      detail:
        accountKeys.length > 0
          ? `계좌 ${accountKeys.length}개 / coded holdings ${portfolioTickers.size}개`
          : "data/portfolio/latest.json 이 없거나 계좌가 비어 있습니다.",
      filePath: paths.portfolio,
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "portfolio_snapshot_incomplete",
      label: "Portfolio Snapshot Completeness",
      status: statusFromCondition(incompleteAccounts.length === 0 && uncodedHoldings.length === 0, "warn"),
      detail:
        incompleteAccounts.length === 0 && uncodedHoldings.length === 0
          ? "모든 계좌와 holding code가 연결 가능합니다."
          : `incomplete 계좌 ${incompleteAccounts.length}개 / code 누락 holding ${uncodedHoldings.length}개`,
      filePath: paths.portfolio,
      examples: [
        ...limitList(incompleteAccounts.map((account) => account.key)),
        ...limitList(uncodedHoldings.map((holding) => holding.name ?? holding.accountKey)),
      ],
    }),
  );

  const stage1Extracts = toArray(stage1?.extracts);
  const hasStage1Extracts = stage1Extracts.length > 0;
  const stage1ExtractIds = extractIdSet(stage1);
  const candidates = stage1Candidates(stage1);
  const invalidStage1Extracts = stage1Extracts.filter(
    (extract) =>
      !isNonEmptyString(extract.id) ||
      !isNonEmptyString(extract.title) ||
      !isNonEmptyString(extract.report_type) ||
      !isNonEmptyString(extract.date) ||
      !isNonEmptyString(extract.text_path) ||
      !isNonEmptyString(extract.key_thesis),
  );
  const invalidCandidates = candidates.filter(({ candidate }) => {
    const code = candidate.target_code || candidate.ticker || candidate.symbol;
    const direction = candidate.direction;
    return (
      !isNonEmptyString(code) ||
      !isNonEmptyString(candidate.reason) ||
      !IMPACT_DIRECTIONS.has(String(direction ?? "").trim().toLowerCase())
    );
  });

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage1_extracts_present",
      label: "Stage 1 Extracts Present",
      status: statusFromCondition(stage1Extracts.length > 0, "error"),
      detail:
        stage1Extracts.length > 0
          ? `extract ${stage1Extracts.length}건 / impact candidate ${candidates.length}건`
          : "stage1-report-extracts-v2.json 이 없거나 extracts가 비어 있습니다.",
      filePath: paths.stage1,
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage1_required_fields",
      label: "Stage 1 Required Fields",
      status: hasStage1Extracts
        ? statusFromCondition(invalidStage1Extracts.length === 0, "warn")
        : "warn",
      detail:
        !hasStage1Extracts
          ? "Stage 1 산출물이 없어 field-level validation을 건너뜁니다."
          : invalidStage1Extracts.length === 0
          ? "핵심 필드(id/title/report_type/date/text_path/key_thesis)가 채워져 있습니다."
          : `핵심 필드가 비어 있는 extract ${invalidStage1Extracts.length}건`,
      filePath: paths.stage1,
      examples: limitList(invalidStage1Extracts.map((extract) => extract.id || extract.title || "unknown_extract")),
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage1_candidate_shape",
      label: "Stage 1 Candidate Shape",
      status: hasStage1Extracts
        ? statusFromCondition(invalidCandidates.length === 0, "warn")
        : "warn",
      detail:
        !hasStage1Extracts
          ? "Stage 1 산출물이 없어 candidate validation을 건너뜁니다."
          : invalidCandidates.length === 0
          ? "portfolio_impacts_candidate 구조가 기본 계약을 충족합니다."
          : `핵심 필드(target_code/direction/reason)가 부족한 candidate ${invalidCandidates.length}건`,
      filePath: paths.stage1,
      examples: limitList(invalidCandidates.map(({ reportId, candidate }) => `${reportId}:${candidate.target_name ?? candidate.target_code ?? "unknown"}`)),
    }),
  );

  const impacts = impactEntries(impactMap);
  const invalidImpactReportRefs = impacts.filter(({ impact }) => !stage1ExtractIds.has(impact.report_id));
  const invalidImpactTickers = impacts.filter(({ ticker }) => !portfolioTickers.has(ticker));
  const invalidImpactShape = impacts.filter(({ impact }) => {
    const direction = String(impact.direction ?? "").trim().toLowerCase();
    return (
      !IMPACT_DIRECTIONS.has(direction) ||
      !isFiniteNumber(impact.magnitude) ||
      !Array.isArray(impact.account_relevance) ||
      impact.account_relevance.length === 0 ||
      !isNonEmptyString(impact.rationale)
    );
  });
  const impactCountMismatch =
    impactMap?.coverage?.impact_count != null &&
    Number(impactMap.coverage.impact_count) !== impacts.length;

  checks.push(
    createCheck(ledgerLookup, {
      id: "impact_map_present",
      label: "Impact Map Present",
      status: statusFromCondition(Boolean(impactMap), "warn"),
      detail: impactMap ? `impact ${impacts.length}건` : "impact-map.json 이 없습니다.",
      filePath: paths.impactMap,
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "impact_map_empty_with_stage1_candidates",
      label: "Impact Map Bridge Coverage",
      status: statusFromCondition(!(candidates.length > 0 && impacts.length === 0), "warn"),
      detail:
        candidates.length > 0 && impacts.length === 0
          ? `Stage 1 candidate ${candidates.length}건인데 impact-map이 비어 있습니다.`
          : `Stage 1 candidate ${candidates.length}건 중 impact ${impacts.length}건으로 연결되었습니다.`,
      filePath: paths.impactMap,
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "impact_map_reference_integrity",
      label: "Impact Map Reference Integrity",
      status: statusFromCondition(
        invalidImpactReportRefs.length === 0 && invalidImpactTickers.length === 0 && invalidImpactShape.length === 0,
        "warn",
      ),
      detail:
        invalidImpactReportRefs.length === 0 && invalidImpactTickers.length === 0 && invalidImpactShape.length === 0
          ? "impact-map의 report/ticker/shape 연결이 정상입니다."
          : `잘못된 report ref ${invalidImpactReportRefs.length}건 / portfolio 외 ticker ${invalidImpactTickers.length}건 / shape 오류 ${invalidImpactShape.length}건`,
      filePath: paths.impactMap,
      examples: [
        ...limitList(invalidImpactReportRefs.map(({ impact }) => impact.report_id)),
        ...limitList(invalidImpactTickers.map(({ ticker }) => ticker)),
      ],
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "impact_map_coverage_count_consistency",
      label: "Impact Map Coverage Count Consistency",
      status: statusFromCondition(!impactCountMismatch, "warn"),
      detail: impactCountMismatch ? "coverage.impact_count 와 실제 impact 개수가 다릅니다." : "coverage.impact_count 와 실제 impact 개수가 일치합니다.",
      filePath: paths.impactMap,
      metrics: impactMap?.coverage?.impact_count != null ? { declared: Number(impactMap.coverage.impact_count), actual: impacts.length } : null,
    }),
  );

  const stage2 = stage2Actual ?? stage2Mock;
  const stage2Mode = stage2Actual ? "actual" : stage2Mock ? "mock" : "missing";

  const contractRecords = [
    {
      key: "stage1",
      label: "Stage 1 Contract",
      payload: stage1,
      filePath: paths.stage1,
      missingStatus: "error",
    },
    {
      key: "impact-map",
      label: "Impact Map Contract",
      payload: impactMap,
      filePath: paths.impactMap,
      missingStatus: "warn",
    },
    {
      key: "stage2",
      label: "Stage 2 Contract",
      payload: stage2,
      filePath: stage2Actual ? paths.stage2 : paths.stage2Mock,
      missingStatus: "warn",
    },
    {
      key: "stage3",
      label: "Stage 3 Contract",
      payload: stage3,
      filePath: paths.stage3,
      missingStatus: "error",
    },
    {
      key: "stage4",
      label: "Stage 4 Contract",
      payload: stage4,
      filePath: paths.stage4,
      missingStatus: "error",
    },
  ];

  checks.push(
    createCheck(ledgerLookup, {
      id: "contract_spec_present",
      label: "Contract Spec Present",
      status: statusFromCondition(Boolean(contractSpec?.stages), "error"),
      detail: contractSpec?.stages
        ? `config/stage-contracts.json loaded (${Object.keys(contractSpec.stages).length} stages)`
        : "config/stage-contracts.json 을 읽지 못했습니다.",
      filePath: paths.contractSpec,
    }),
  );

  for (const record of contractRecords) {
    const stageSpec = contractSpec?.stages?.[record.key];
    const contract = record.payload?._contract ?? null;
    const missingTopLevelKeys = (stageSpec?.requiredKeys ?? []).filter(
      (key) => getValueAtPath(record.payload, key) === undefined,
    );
    const missingNestedKeys = (stageSpec?.requiredNestedKeys ?? []).filter(
      (key) => getValueAtPath(record.payload, key) === undefined,
    );
    const contractMismatch =
      contract != null &&
      (contract.version !== (contractSpec?.version ?? "1.0") || contract.stage !== record.key);

    checks.push(
      createCheck(ledgerLookup, {
        id: `${record.key}_contract_presence`,
        label: `${record.label} Presence`,
        status: !record.payload
          ? record.missingStatus
          : statusFromCondition(Boolean(contract), "error"),
        detail: !record.payload
          ? "산출물이 없어 contract 검증을 건너뜁니다."
          : contract
            ? "_contract 메타데이터가 존재합니다."
            : "_contract 메타데이터가 없습니다.",
        filePath: record.filePath,
      }),
    );

    checks.push(
      createCheck(ledgerLookup, {
        id: `${record.key}_contract_shape`,
        label: `${record.label} Shape`,
        status: !record.payload || !contract || !stageSpec
          ? "warn"
          : statusFromCondition(!contractMismatch, "error"),
        detail: !record.payload
          ? "산출물이 없어 contract shape 검증을 건너뜁니다."
          : !stageSpec
            ? `stage-contracts.json 에 ${record.key} 정의가 없습니다.`
            : !contract
              ? "_contract 가 없어 shape 검증을 완료하지 못했습니다."
              : !contractMismatch
                ? `version=${contract.version}, stage=${contract.stage}`
                : `expected version=${contractSpec?.version ?? "1.0"}, stage=${record.key} / actual version=${contract.version}, stage=${contract.stage}`,
        filePath: record.filePath,
      }),
    );

    checks.push(
      createCheck(ledgerLookup, {
        id: `${record.key}_required_keys_contract`,
        label: `${record.label} Required Keys`,
        status: !record.payload || !stageSpec
          ? "warn"
          : statusFromCondition(
              missingTopLevelKeys.length === 0 && missingNestedKeys.length === 0,
              "error",
            ),
        detail: !record.payload
          ? "산출물이 없어 required key 검증을 건너뜁니다."
          : !stageSpec
            ? `stage-contracts.json 에 ${record.key} 정의가 없습니다.`
            : missingTopLevelKeys.length === 0 && missingNestedKeys.length === 0
              ? "required keys / nested keys 계약을 충족합니다."
              : `missing top-level ${missingTopLevelKeys.length} / missing nested ${missingNestedKeys.length}`,
        filePath: record.filePath,
        examples: [...limitList(missingTopLevelKeys), ...limitList(missingNestedKeys)],
      }),
    );
  }

  const holdingsBias = toArray(stage2?.holdings_bias);
  const invalidHoldingsBias = holdingsBias.filter(
    (item) =>
      !isNonEmptyString(item.ticker) ||
      !HOLDING_ACTIONS.has(String(item.action ?? "").trim().toUpperCase()) ||
      !isFiniteNumber(item.conviction),
  );
  const unknownStage2Tickers = holdingsBias
    .map((item) => item.ticker)
    .filter((ticker) => ticker && !portfolioTickers.has(ticker) && !watchlistTickers.has(ticker));

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage2_missing_or_mock",
      label: "Stage 2 Availability",
      status: statusFromCondition(stage2Mode === "actual", "warn"),
      detail:
        stage2Mode === "actual"
          ? `실제 Stage 2 결과 사용 (${stage2?.model ?? "unknown model"})`
          : stage2Mode === "mock"
            ? "mock Stage 2 결과만 존재합니다."
            : "Stage 2 결과가 없습니다.",
      filePath: stage2Actual ? paths.stage2 : paths.stage2Mock,
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage2_holdings_bias_shape",
      label: "Stage 2 Holdings Bias Shape",
      status: statusFromCondition(invalidHoldingsBias.length === 0, "warn"),
      detail:
        invalidHoldingsBias.length === 0
          ? `holdings_bias ${holdingsBias.length}건이 기본 계약을 충족합니다.`
          : `ticker/action/conviction 계약을 어긴 holdings_bias ${invalidHoldingsBias.length}건`,
      filePath: stage2Actual ? paths.stage2 : paths.stage2Mock,
      examples: limitList(invalidHoldingsBias.map((item) => item.ticker || "unknown_ticker")),
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage2_unknown_tickers",
      label: "Stage 2 Unknown Tickers",
      status: statusFromCondition(unknownStage2Tickers.length === 0, "warn"),
      detail:
        unknownStage2Tickers.length === 0
          ? "Stage 2 ticker가 portfolio/watchlist universe 안에 있습니다."
          : `portfolio/watchlist 밖 ticker ${unknownStage2Tickers.length}건`,
      filePath: stage2Actual ? paths.stage2 : paths.stage2Mock,
      examples: limitList(unknownStage2Tickers),
    }),
  );

  const stage3Holdings = stage3HoldingEntries(stage3);
  const stage3TickerSet = new Set(
    stage3Holdings
      .map(({ ticker, holding }) => holding.code || ticker)
      .filter(Boolean),
  );
  const missingStage3Tickers = [...portfolioTickers].filter((ticker) => !stage3TickerSet.has(ticker));
  const extraStage3Tickers = [...stage3TickerSet].filter((ticker) => !portfolioTickers.has(ticker));
  const extraStage3Examples = stage3Holdings
    .filter(({ ticker, holding }) => !portfolioTickers.has(holding.code || ticker))
    .map(({ ticker, holding }) => `${holding.name ?? "unknown"}:${holding.code ?? ticker}`);
  const invalidStage3ReportRefs = stage3Holdings.flatMap(({ holding }) =>
    toArray(holding.reportImpacts)
      .filter((impact) => impact?.reportId && !stage1ExtractIds.has(impact.reportId))
      .map((impact) => impact.reportId),
  );
  const stage3ImpactCoverage = Number(stage3?.coverage?.impactCoverage ?? 0);
  const impactCoverageMismatch = (impacts.length > 0 && stage3ImpactCoverage <= 0) || (impacts.length === 0 && stage3ImpactCoverage > 0);

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage3_present",
      label: "Stage 3 Quant Present",
      status: statusFromCondition(stage3Holdings.length > 0, "error"),
      detail:
        stage3Holdings.length > 0
          ? `holding ${stage3Holdings.length}건`
          : "stage3-quant-scores.json 이 없거나 holdings가 비어 있습니다.",
      filePath: paths.stage3,
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage3_portfolio_coverage",
      label: "Stage 3 Portfolio Coverage",
      status: statusFromCondition(missingStage3Tickers.length === 0 && extraStage3Tickers.length === 0, "warn"),
      detail:
        missingStage3Tickers.length === 0 && extraStage3Tickers.length === 0
          ? "Stage 3 holdings가 포트폴리오 coded holding을 커버합니다."
          : `Stage 3 누락 ticker ${missingStage3Tickers.length}건 / extra ticker ${extraStage3Tickers.length}건`,
      filePath: paths.stage3,
      examples: [...limitList(missingStage3Tickers), ...limitList(extraStage3Examples)],
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage3_report_reference_integrity",
      label: "Stage 3 Report Reference Integrity",
      status: statusFromCondition(invalidStage3ReportRefs.length === 0, "warn"),
      detail:
        invalidStage3ReportRefs.length === 0
          ? "Stage 3 reportImpacts가 Stage 1 extract id와 연결됩니다."
          : `Stage 1에 없는 reportId 참조 ${unique(invalidStage3ReportRefs).length}건`,
      filePath: paths.stage3,
      examples: limitList(invalidStage3ReportRefs),
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage3_impact_coverage_consistency",
      label: "Stage 3 Impact Coverage Consistency",
      status: statusFromCondition(!impactCoverageMismatch, "warn"),
      detail:
        !impactCoverageMismatch
          ? `impact-map(${impacts.length})와 Stage 3 impactCoverage(${stage3ImpactCoverage})가 대체로 일치합니다.`
          : `impact-map(${impacts.length})와 Stage 3 impactCoverage(${stage3ImpactCoverage})가 어긋납니다.`,
      filePath: paths.stage3,
    }),
  );

  const accountPlans = stage4Plans(stage4);
  const stage4AccountKeys = unique(accountPlans.map((plan) => plan.key));
  const missingStage4Accounts = accountKeys.filter((key) => !stage4AccountKeys.includes(key));
  const extraStage4Accounts = stage4AccountKeys.filter((key) => !accountKeys.includes(key));
  const missingActionLines = accountPlans.filter((plan) => !isNonEmptyString(plan?.macroCommentary?.actionLine));
  const invalidStage4Drivers = accountPlans.flatMap((plan) =>
    toArray(plan.stage1Drivers)
      .filter((driver) => !stage1ExtractIds.has(driver.id))
      .map((driver) => `${plan.key}:${driver.id ?? "missing_id"}`),
  );
  const totalStage4Drivers = countTruthy(accountPlans.flatMap((plan) => toArray(plan.stage1Drivers)).map((driver) => driver?.id));

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage4_present",
      label: "Stage 4 Plan Present",
      status: statusFromCondition(accountPlans.length > 0, "error"),
      detail:
        accountPlans.length > 0
          ? `account plan ${accountPlans.length}건`
          : "stage4-execution-plan.json 이 없거나 accountPlans가 비어 있습니다.",
      filePath: paths.stage4,
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage4_account_alignment",
      label: "Stage 4 Account Alignment",
      status: statusFromCondition(missingStage4Accounts.length === 0 && extraStage4Accounts.length === 0, "warn"),
      detail:
        missingStage4Accounts.length === 0 && extraStage4Accounts.length === 0
          ? "Stage 4 accountPlans가 현재 포트폴리오 계좌와 정렬됩니다."
          : `누락 account ${missingStage4Accounts.length}개 / extra account ${extraStage4Accounts.length}개`,
      filePath: paths.stage4,
      examples: [...limitList(missingStage4Accounts), ...limitList(extraStage4Accounts)],
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage4_action_line_presence",
      label: "Stage 4 Action Line Presence",
      status: statusFromCondition(missingActionLines.length === 0, "warn"),
      detail:
        missingActionLines.length === 0
          ? "모든 account plan에 actionLine이 있습니다."
          : `actionLine이 비어 있는 account plan ${missingActionLines.length}건`,
      filePath: paths.stage4,
      examples: limitList(missingActionLines.map((plan) => plan.key)),
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage4_driver_reference_integrity",
      label: "Stage 4 Driver Reference Integrity",
      status: statusFromCondition(invalidStage4Drivers.length === 0, "warn"),
      detail:
        invalidStage4Drivers.length === 0
          ? "Stage 4 stage1Drivers가 Stage 1 extract id와 연결됩니다."
          : `Stage 1에 없는 stage1Driver 참조 ${invalidStage4Drivers.length}건`,
      filePath: paths.stage4,
      examples: limitList(invalidStage4Drivers),
    }),
  );

  checks.push(
    createCheck(ledgerLookup, {
      id: "stage4_missing_stage1_drivers",
      label: "Stage 4 Driver Coverage",
      status: statusFromCondition(!(impacts.length > 0 && totalStage4Drivers === 0), "warn"),
      detail:
        impacts.length > 0 && totalStage4Drivers === 0
          ? "impact-map은 존재하지만 Stage 4 stage1Drivers가 비어 있습니다."
          : `Stage 4에 연결된 stage1Drivers ${totalStage4Drivers}건`,
      filePath: paths.stage4,
    }),
  );

  const dateMismatches = topLevelDateMismatches(date, [
    { name: "stage1", payload: stage1 },
    { name: "impactMap", payload: impactMap },
    { name: "stage2", payload: stage2 },
    { name: "stage3", payload: stage3 },
    { name: "stage4", payload: stage4 },
  ]);

  checks.push(
    createCheck(ledgerLookup, {
      id: "cross_stage_date_alignment",
      label: "Cross-Stage Date Alignment",
      status: statusFromCondition(dateMismatches.length === 0, "warn"),
      detail:
        dateMismatches.length === 0
          ? `모든 주요 산출물의 date가 ${date}와 일치합니다.`
          : `요청 날짜와 다른 산출물: ${dateMismatches.join(", ")}`,
      filePath: paths.stage4,
      examples: limitList(dateMismatches),
    }),
  );

  const summary = {
    date,
    generatedAt: new Date().toISOString(),
    overallStatus: checks.some((item) => item.status === "error")
      ? "error"
      : checks.some((item) => item.status === "warn")
        ? "warn"
        : "ok",
    counts: {
      portfolioAccounts: accountKeys.length,
      portfolioHoldings: holdings.length,
      portfolioCodedHoldings: codedHoldings.length,
      portfolioTickers: portfolioTickers.size,
      stage1Extracts: stage1Extracts.length,
      stage1Candidates: candidates.length,
      impactCount: impacts.length,
      stage2Mode,
      stage2HoldingsBias: holdingsBias.length,
      stage3Holdings: stage3Holdings.length,
      stage4Plans: accountPlans.length,
    },
    checks,
  };

  const outputJson =
    args.output ?? path.join(analysisDir, "stage-contract-validation.json");
  const outputMarkdown =
    args.markdown ?? path.join(ROOT_DIR, "knowledge", "daily", `${date}-stage-contract-validation.md`);

  const markdown = [
    `# EcoReport Stage Contract Validation (${date})`,
    "",
    `- overallStatus: **${summary.overallStatus}**`,
    `- generatedAt: ${summary.generatedAt}`,
    `- stage1Extracts: ${summary.counts.stage1Extracts}`,
    `- stage1Candidates: ${summary.counts.stage1Candidates}`,
    `- impactCount: ${summary.counts.impactCount}`,
    `- stage2Mode: ${summary.counts.stage2Mode}`,
    `- stage3Holdings: ${summary.counts.stage3Holdings}`,
    `- stage4Plans: ${summary.counts.stage4Plans}`,
    "",
    "## Checks",
    ...checks.map((item) => {
      const ledgerLine = item.ledgerRef
        ? ` | ledger: ${item.ledgerRef.id} -> ${item.ledgerRef.repairPlaybook}`
        : "";
      const exampleLine =
        item.examples && item.examples.length > 0
          ? ` | examples: ${item.examples.join(", ")}`
          : "";
      return `- [${item.status.toUpperCase()}] ${item.label}: ${item.detail}${ledgerLine}${exampleLine}`;
    }),
  ].join("\n");

  await writeJson(outputJson, summary);
  await writeText(outputMarkdown, `${markdown}\n`);

  console.log(outputJson);

  if (summary.overallStatus === "error") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`validate-stage-contracts 실패: ${error.message}`);
  process.exit(1);
});
