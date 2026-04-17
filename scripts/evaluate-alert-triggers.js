#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  buildRunMetadata,
  parseDateArgs,
  readJson,
  readText,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function evaluateCondition(condition, context) {
  const normalized = String(condition ?? "").trim();

  if (/^vix\s*>\s*([\d.]+)$/i.test(normalized)) {
    const threshold = Number.parseFloat(normalized.match(/^vix\s*>\s*([\d.]+)$/i)?.[1] ?? "0");
    const actual = context.vix;
    return {
      matched: typeof actual === "number" && actual > threshold,
      actual,
      comparator: `>${threshold}`,
    };
  }

  if (/^wti\s*>\s*([\d.]+)$/i.test(normalized)) {
    const threshold = Number.parseFloat(normalized.match(/^wti\s*>\s*([\d.]+)$/i)?.[1] ?? "0");
    const actual = context.wti;
    return {
      matched: typeof actual === "number" && actual > threshold,
      actual,
      comparator: `>${threshold}`,
    };
  }

  if (/^wti\s*<\s*([\d.]+)$/i.test(normalized)) {
    const threshold = Number.parseFloat(normalized.match(/^wti\s*<\s*([\d.]+)$/i)?.[1] ?? "0");
    const actual = context.wti;
    return {
      matched: typeof actual === "number" && actual < threshold,
      actual,
      comparator: `<${threshold}`,
    };
  }

  if (/^usdkrw\s*>\s*([\d.]+)$/i.test(normalized)) {
    const threshold = Number.parseFloat(normalized.match(/^usdkrw\s*>\s*([\d.]+)$/i)?.[1] ?? "0");
    const actual = context.usdkrw;
    return {
      matched: typeof actual === "number" && actual > threshold,
      actual,
      comparator: `>${threshold}`,
    };
  }

  if (/^vix_change_pct\s*>\s*([\d.]+)$/i.test(normalized)) {
    const threshold = Number.parseFloat(
      normalized.match(/^vix_change_pct\s*>\s*([\d.]+)$/i)?.[1] ?? "0",
    );
    const actual = context.vixChangePct;
    return {
      matched: typeof actual === "number" && actual > threshold,
      actual,
      comparator: `>${threshold}`,
    };
  }

  if (/^usdkrw_change_pct\s*>\s*([\d.]+)$/i.test(normalized)) {
    const threshold = Number.parseFloat(
      normalized.match(/^usdkrw_change_pct\s*>\s*([\d.]+)$/i)?.[1] ?? "0",
    );
    const actual = context.usdkrwChangePct;
    return {
      matched: typeof actual === "number" && actual > threshold,
      actual,
      comparator: `>${threshold}`,
    };
  }

  if (/^any_holding_daily_change\s*<\s*(-?[\d.]+)$/i.test(normalized)) {
    const threshold = Number.parseFloat(
      normalized.match(/^any_holding_daily_change\s*<\s*(-?[\d.]+)$/i)?.[1] ?? "0",
    );
    const worstHolding = [...context.holdingMoves].sort((left, right) => left.changePct - right.changePct)[0] ?? null;
    const actual = worstHolding?.changePct ?? null;
    return {
      matched: typeof actual === "number" && actual < threshold,
      actual,
      comparator: `<${threshold}`,
      detail: worstHolding
        ? `${worstHolding.accountKey} ${worstHolding.name}${worstHolding.code ? `(${worstHolding.code})` : ""} ${Math.round(worstHolding.changePct * 10000) / 100}%`
        : null,
    };
  }

  const keywordMatch = normalized.match(/^keyword_detected\('([^']+)','([^']+)'\)$/i);
  if (keywordMatch) {
    const first = normalizeText(keywordMatch[1]);
    const second = normalizeText(keywordMatch[2]);
    const corpus = normalizeText(context.keywordCorpus);
    return {
      matched: corpus.includes(first) && corpus.includes(second),
      actual: corpus.length > 0 ? "corpus" : null,
      comparator: `${first}+${second}`,
    };
  }

  return {
    matched: false,
    actual: null,
    comparator: "unsupported",
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  let marketFile = path.join(ROOT_DIR, "data", "market", `${args.date}.json`);
  let portfolioFile = path.join(ROOT_DIR, "data", "portfolio", "latest.json");
  let technicalFile = path.join(ROOT_DIR, "data", "technical", `${args.date}.json`);
  let outputJson = null;
  let outputMarkdown = null;

  for (let index = 0; index < process.argv.length; index += 1) {
    const token = process.argv[index];
    if (token === "--market-file" && process.argv[index + 1]) {
      marketFile = process.argv[index + 1];
      index += 1;
    } else if (token === "--portfolio-file" && process.argv[index + 1]) {
      portfolioFile = process.argv[index + 1];
      index += 1;
    } else if (token === "--technical-file" && process.argv[index + 1]) {
      technicalFile = process.argv[index + 1];
      index += 1;
    } else if (token === "--output" && process.argv[index + 1]) {
      outputJson = process.argv[index + 1];
      index += 1;
    } else if (token === "--markdown" && process.argv[index + 1]) {
      outputMarkdown = process.argv[index + 1];
      index += 1;
    }
  }
  const date = args.date;
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state", date);

  const [alertsConfig, market, fred, technical, portfolio, stage1, richBriefing] = await Promise.all([
    readJson(path.join(ROOT_DIR, "config", "alerts.json"), { triggers: [] }),
    readJson(marketFile, null),
    readJson(path.join(ROOT_DIR, "data", "macro", `fred-${date}.json`), null),
    readJson(technicalFile, null),
    readJson(portfolioFile, { accounts: [] }),
    readJson(path.join(analysisDir, "stage1-report-extracts-v2.json"), { extracts: [] }),
    readText(path.join(ROOT_DIR, "knowledge", "daily", `${date}-gemini-briefing-rich.md`), ""),
  ]);

  const technicalScores = technical?.scores ?? {};
  const intradayHoldings = market?.holdings ?? {};
  const holdingMoves = (portfolio?.accounts ?? []).flatMap((account) =>
    (account.holdings ?? []).map((holding) => ({
      accountKey: account.key,
      name: holding.name,
      code: holding.code ?? null,
      changePct:
        intradayHoldings[holding.code ?? ""]?.changePct ??
        technicalScores[holding.code ?? ""]?.change_pct ??
        (holding.currentPrice && holding.avgPrice
          ? (holding.currentPrice - holding.avgPrice) / holding.avgPrice
          : null),
    })),
  ).filter((item) => typeof item.changePct === "number");

  const keywordCorpus = [
    richBriefing,
    ...(stage1?.extracts ?? []).flatMap((item) => [item?.title, item?.key_thesis, item?.primary_claim?.summary]),
  ]
    .filter(Boolean)
    .join(" ");

  const context = {
    vix: market?.macros?.VIX?.close ?? fred?.VIXCLS ?? technical?.market_context?.vix ?? market?.macro?.VIX?.close ?? null,
    vixChangePct: market?.macros?.VIX?.changePct ?? market?.macro?.VIX?.change_pct ?? null,
    wti: market?.macros?.WTI?.close ?? market?.macro?.WTI?.close ?? null,
    usdkrw: market?.macros?.USDKRW?.close ?? market?.macro?.USDKRW?.close ?? null,
    usdkrwChangePct: market?.macros?.USDKRW?.changePct ?? market?.macro?.USDKRW?.change_pct ?? null,
    holdingMoves,
    keywordCorpus,
  };

  const evaluated = (alertsConfig?.triggers ?? []).map((trigger) => {
    const result = evaluateCondition(trigger.condition, context);
    return {
      name: trigger.name,
      condition: trigger.condition,
      action: trigger.action ?? null,
      triggered: result.matched,
      actual: result.actual,
      comparator: result.comparator,
      detail: result.detail ?? null,
    };
  });

  const payload = {
    ...buildRunMetadata(args),
    sourceFiles: {
      market: marketFile,
      portfolio: portfolioFile,
      technical: technicalFile,
    },
    summary: {
      triggerCount: evaluated.length,
      firedCount: evaluated.filter((item) => item.triggered).length,
    },
    triggers: evaluated,
  };

  const outJson = outputJson ?? path.join(analysisDir, "emergency-alerts.json");
  const outMd = outputMarkdown ?? path.join(ROOT_DIR, "reports", "daily", `${date}-emergency-alerts.md`);
  const markdown = [
    `# Emergency Alerts (${date})`,
    "",
    `- fired: ${payload.summary.firedCount} / ${payload.summary.triggerCount}`,
    "",
    ...evaluated.map(
      (item) =>
        `- [${item.triggered ? "TRIGGERED" : "idle"}] ${item.name} / 조건: ${item.condition} / 실제값: ${item.actual ?? "N/A"}${item.detail ? ` / 상세: ${item.detail}` : ""} / 액션: ${item.action ?? "-"}`,
    ),
    "",
  ].join("\n");

  await writeJson(outJson, payload);
  await writeText(outMd, markdown);
  console.log(outJson);
}

main().catch((error) => {
  console.error(`[evaluate-alert-triggers] 실패: ${error.message}`);
  process.exit(1);
});
