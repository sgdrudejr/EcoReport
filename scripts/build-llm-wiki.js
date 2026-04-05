#!/usr/bin/env node
// EcoReport의 일일 산출물을 지속형 투자 위키로 컴파일합니다.

import fs from "node:fs/promises";
import path from "node:path";

import {
  ROOT_DIR,
  SECURITIES_MASTER,
  SECURITIES_BY_CODE,
  compactWhitespace,
  getCategory,
  parseDateArgs,
  readJson,
  readText,
  won,
  writeText,
} from "./lib/pipeline-utils.js";

const WIKI_ROOT = path.join(ROOT_DIR, "knowledge", "wiki");
const ACCOUNT_LABEL_BY_KEY = {
  ISA: "ISA",
  PENSION: "연금저축",
  TOSS: "토스증권",
};

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";
}

function safePct(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function cleanSentence(value) {
  const text = compactWhitespace(value ?? "");
  if (!text) return "";
  return /[.!?]|다\.|입니다\.$/.test(text) ? text : `${text}.`;
}

function bucketLabel(bucket) {
  const mapping = {
    stagedBuys: "실행 후보",
    stage2Candidates: "전략 후보",
    watches: "워치",
    trims: "축소 후보",
    holds: "보유 유지",
  };
  return mapping[bucket] ?? bucket;
}

function normalizeAccountKey(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (upper === "ISA") return "ISA";
  if (upper === "PENSION" || text === "연금저축") return "PENSION";
  if (upper === "TOSS" || text === "토스증권") return "TOSS";
  return text;
}

function buildSecurityLookups() {
  const exact = new Map();
  const loose = new Map();

  function add(name, code) {
    if (!name || !code) return;
    exact.set(normalizeText(name), code);
    const looseKey = normalizeLooseName(name);
    if (looseKey) loose.set(looseKey, code);
  }

  for (const security of SECURITIES_MASTER.securities ?? []) {
    add(security.name, security.code);
    for (const alias of security.keywords?.aliases ?? []) {
      add(alias, security.code);
    }
  }

  return { exact, loose };
}

function normalizeLooseName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.\.\./g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function resolveSecurityCode(nameOrCode, lookups) {
  if (!nameOrCode) return null;
  const token = String(nameOrCode).trim();
  if (SECURITIES_BY_CODE[token]) return token;

  const exact = lookups.exact.get(normalizeText(token));
  if (exact) return exact;

  const looseKey = normalizeLooseName(token);
  if (lookups.loose.has(looseKey)) return lookups.loose.get(looseKey);

  for (const [candidate, code] of lookups.loose.entries()) {
    if (!candidate || !looseKey) continue;
    if (candidate.startsWith(looseKey) || looseKey.startsWith(candidate)) {
      return code;
    }
  }

  return null;
}

function markdownLink(fromFile, targetFile, label) {
  const relative = path.relative(path.dirname(fromFile), targetFile).split(path.sep).join("/");
  return `[${label}](${relative})`;
}

function frontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
      continue;
    }
    lines.push(`${key}: ${value}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

async function existingDates(dir) {
  try {
    const names = await fs.readdir(dir);
    return names
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.replace(/\.md$/, ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

async function pageTitle(filePath, fallback) {
  const text = await readText(filePath, "");
  const match = text.match(/^title:\s+(.+)$/m);
  return match?.[1]?.trim() || fallback;
}

function loadStrategyAccount(strategy, accountKey) {
  if (!strategy?.accounts) return null;
  return (
    strategy.accounts[accountKey] ??
    strategy.accounts[ACCOUNT_LABEL_BY_KEY[accountKey]] ??
    null
  );
}

function topCandidates(plan, limit = 3) {
  const seen = new Set();
  return [
    ...(plan?.stagedBuys ?? []),
    ...(plan?.watches ?? []),
    ...(plan?.trims ?? []),
  ]
    .filter((item) => {
      const key = `${item.code ?? ""}|${item.name ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function stage3HoldingsIndex(stage3, lookups) {
  const byCode = new Map();
  for (const [rawCode, entry] of Object.entries(stage3?.holdings ?? {})) {
    const resolvedCode =
      SECURITIES_BY_CODE[rawCode] ? rawCode : resolveSecurityCode(entry?.name ?? rawCode, lookups);
    if (resolvedCode) byCode.set(resolvedCode, entry);
  }
  return byCode;
}

function stage4PlansIndex(stage4) {
  return new Map((stage4?.accountPlans ?? []).map((plan) => [normalizeAccountKey(plan.key), plan]));
}

function allSecurityCodes({ portfolio, stage4, lookups }) {
  const codes = new Set();

  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account.holdings ?? []) {
      const code = resolveSecurityCode(holding.code ?? holding.name, lookups);
      if (code) codes.add(code);
    }
  }

  for (const plan of stage4?.accountPlans ?? []) {
    for (const bucket of ["stage2Candidates", "stagedBuys", "trims", "holds", "watches"]) {
      for (const item of plan[bucket] ?? []) {
        const code = resolveSecurityCode(item.code ?? item.name, lookups);
        if (code) codes.add(code);
      }
    }
  }

  return [...codes];
}

function holdingRows(account, stage3ByCode, lookups) {
  const rows = [];
  for (const holding of account?.holdings ?? []) {
    const code = resolveSecurityCode(holding.code ?? holding.name, lookups);
    const security = code ? SECURITIES_BY_CODE[code] : null;
    const score = code ? stage3ByCode.get(code)?.actionScore : null;
    rows.push({
      code,
      name: security?.name ?? holding.name ?? "Unknown",
      category: code ? getCategory(code, account.key) ?? "기타" : "미분류",
      marketValue: holding.marketValue ?? null,
      quantity: holding.quantity ?? null,
      score,
    });
  }
  return rows;
}

function extractRecentEvidence(stage1, impactMap, code, securityName) {
  const relatedExtracts = (stage1?.extracts ?? []).filter((extract) => {
    const haystack = [
      extract?.ticker,
      extract?.company_name,
      extract?.title,
      extract?.key_thesis,
      ...(extract?.key_points ?? []),
      ...(extract?.what_changed ?? []),
      ...(extract?.themes ?? []),
    ]
      .filter(Boolean)
      .join("\n");
    return code
      ? haystack.includes(code) || haystack.includes(securityName)
      : haystack.includes(securityName);
  });

  const evidence = relatedExtracts.slice(0, 3).map((extract) => {
    const thesis = compactWhitespace(extract.key_thesis ?? extract.summary ?? "핵심 논지 정리 필요");
    return `- ${extract.title ?? "Untitled report"}: ${thesis}`;
  });

  const relatedImpactLines = [];
  for (const report of impactMap?.reports ?? []) {
    for (const impact of report?.impacts ?? []) {
      const targetCode = impact?.target?.code;
      if (targetCode && targetCode === code) {
        relatedImpactLines.push(
          `- ${report.title ?? "Untitled report"}: ${impact.direction ?? "neutral"} / strength ${impact.strength ?? "N/A"} / confidence ${impact.confidence ?? "N/A"}`
        );
      }
    }
  }

  return {
    evidence,
    impactLines: relatedImpactLines,
  };
}

function buildOpportunityMemo({ security, plans, holdings, stage3Entry }) {
  const buyMentions = plans.filter((item) => item.bucket === "stagedBuys");
  const watchMentions = plans.filter((item) => item.bucket === "watches");
  const trimMentions = plans.filter((item) => item.bucket === "trims");

  if (buyMentions.length > 0) {
    const accounts = [...new Set(buyMentions.map((item) => ACCOUNT_LABEL_BY_KEY[item.accountKey] ?? item.accountKey))];
    return [
      `- 현재 실행 후보입니다. ${accounts.join(", ")} 계좌에서 실제 자금 배치 대상으로 올라와 있습니다.`,
      `- 돈이 되는 이유는 단순 뉴스가 아니라 전략상 필요한 카테고리 갭을 메우는 자산으로 선택됐기 때문입니다.`,
      `- 무효화 조건은 다음 일일 러너에서 후보에서 빠지거나, action score가 약세로 꺾이거나, 같은 카테고리의 더 강한 대안이 등장하는 경우입니다.`,
    ];
  }

  if (trimMentions.length > 0) {
    return [
      "- 현재는 확대보다 축소/재평가 관점이 더 강합니다.",
      "- 돈을 버는 관점에서는 새 진입보다 자본 보존이 우선인 상태입니다.",
    ];
  }

  if (watchMentions.length > 0 || holdings.length > 0) {
    return [
      "- 현재는 워치 또는 기존 보유 자산입니다.",
      "- 리포트 근거가 늘어나고 점수가 개선될 때만 추가 매수로 승격시키는 것이 좋습니다.",
      `- 현재 가용 신호는 ${stage3Entry?.signal ?? "N/A"} 수준입니다.`,
    ];
  }

  return [
    "- 아직 실행 우선순위가 높은 자산은 아닙니다.",
    "- 다만 계좌 전략과 연결되는 테마 자산이므로 향후 리포트와 점수 변화가 붙으면 후보로 승격될 수 있습니다.",
  ];
}

async function buildOverviewPage({ date, recentDates }) {
  const file = path.join(WIKI_ROOT, "overview.md");
  const content = [
    frontmatter({
      title: "EcoReport LLM Wiki Overview",
      type: "overview",
      updated: date,
      source_date: date,
    }),
    "# EcoReport LLM Wiki",
    "",
    "이 위키의 목적은 `매일 리포트를 읽는 것`이 아니라 `돈이 되는 투자 메모리`를 누적하는 것입니다.",
    "",
    "## Why This Exists",
    "",
    "- 일일 산출물이 채팅이나 단발 보고서에서 증발하지 않게 합니다.",
    "- 계좌, 종목, 카테고리, 실행 계획을 같은 지식 그래프 안에 묶습니다.",
    "- 다음 질문이 오면 원문을 다시 훑기보다 기존 판단과 무효화 조건부터 읽게 합니다.",
    "",
    "## Money-First Rule",
    "",
    "좋은 위키 페이지는 아래 다섯 가지를 답해야 합니다.",
    "",
    "1. 왜 이 자산이 돈을 벌 수 있는가",
    "2. 어떤 계좌에서 이겨야 하는가",
    "3. 어떤 근거가 붙어 있는가",
    "4. 어떤 조건이면 틀린 판단인가",
    "5. 다음에 무엇을 확인해야 하는가",
    "",
    "## Current Structure",
    "",
    "- `daily/`: 날짜별 의사결정 로그",
    "- `accounts/`: 계좌별 플레이북",
    "- `securities/`: 종목/ETF thesis 페이지",
    "- `index.md`: 위키 카탈로그",
    "- `log.md`: 위키 업데이트 이력",
    "",
    "## Recent Daily Pages",
    "",
    ...([...new Set([date, ...recentDates])].filter(Boolean).slice(0, 10).map((item) => `- [${item}](daily/${item}.md)`)),
    "",
    "## Related Docs",
    "",
    "- [System Guide](../../docs/LLM_WIKI_SYSTEM.md)",
    "- [Operator Runbook](../../docs/OPERATOR_RUNBOOK.md)",
  ].join("\n");

  await writeText(file, `${content}\n`);
  return file;
}

async function buildDailyPage({ date, portfolio, stage1, stage3, stage4, dailyPagesDir }) {
  const file = path.join(dailyPagesDir, `${date}.md`);
  const accountBlocks = (stage4?.accountPlans ?? []).map((plan) => {
    const buyLines = (plan.stagedBuys ?? []).slice(0, 4).map((item) => {
      const amount = typeof item.suggestedAmount === "number" ? ` / ${won(item.suggestedAmount)}` : "";
      return `- ${item.name}${amount}`;
    });
    const watchLines = (plan.watches ?? []).slice(0, 4).map((item) => `- ${item.name}`);
    return [
      `### ${plan.label} (${plan.key})`,
      "",
      `- 총점: ${plan.totalScore ?? "N/A"}`,
      `- 집행 예산: ${won(plan.deployBudget)}`,
      `- 유보 현금: ${won(plan.reserveCash)}`,
      `- 가장 큰 갭: ${plan.topGap?.category ?? "N/A"} (${won(plan.topGap?.gapAmount)})`,
      `- 코멘트: ${plan.macroCommentary?.actionLine ?? "요약 없음"}`,
      "",
      "실행 후보:",
      ...(buyLines.length > 0 ? buyLines : ["- 없음"]),
      "",
      "워치:",
      ...(watchLines.length > 0 ? watchLines : ["- 없음"]),
      "",
    ].join("\n");
  });

  const topIdeas = (stage4?.accountPlans ?? [])
    .flatMap((plan) =>
      (plan.stagedBuys ?? []).map((item) => ({
        accountKey: plan.key,
        accountLabel: plan.label,
        name: item.name,
        amount: item.suggestedAmount,
      })),
    )
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, 5);

  const content = [
    frontmatter({
      title: `EcoReport Daily Wiki ${date}`,
      type: "daily",
      updated: date,
      source_date: date,
    }),
    `# Daily Decision Memo - ${date}`,
    "",
    "## Snapshot",
    "",
    `- 시장 레짐: ${stage4?.regime?.name ?? stage3?.regime?.name ?? "N/A"}`,
    `- 포트폴리오 점수: ${stage4?.portfolioScore ?? "N/A"}`,
    `- 리포트 수: ${stage1?.reportCount ?? 0}`,
    `- 계좌 수: ${(portfolio?.accounts ?? []).length}`,
    "",
    "## Top Capital Deployment Ideas",
    "",
    ...(topIdeas.length > 0
      ? topIdeas.map((idea) => `- ${idea.accountLabel}: ${idea.name} / ${won(idea.amount)}`)
      : ["- 오늘은 강한 신규 집행 후보가 없습니다."]),
    "",
    "## Account Plans",
    "",
    ...accountBlocks,
    "",
    "## Source Files",
    "",
    `- [Stage 1](../../data/analysis-state/${date}/stage1-report-extracts-v2.json)`,
    `- [Impact Map](../../data/analysis-state/${date}/impact-map.json)`,
    `- [Stage 3](../../data/analysis-state/${date}/stage3-quant-scores.json)`,
    `- [Stage 4](../../data/analysis-state/${date}/stage4-execution-plan.json)`,
    `- [Portfolio](../../data/portfolio/latest.json)`,
  ].join("\n");

  await writeText(file, `${content}\n`);
  return file;
}

async function buildAccountPages({ date, portfolio, strategy, stage3, stage4, accountDir, lookups }) {
  const stage3ByCode = stage3HoldingsIndex(stage3, lookups);
  const plansByKey = stage4PlansIndex(stage4);
  const accountFiles = [];

  for (const account of portfolio?.accounts ?? []) {
    const key = normalizeAccountKey(account.key);
    const label = ACCOUNT_LABEL_BY_KEY[key] ?? account.label ?? key;
    const plan = plansByKey.get(key);
    const strategyAccount = loadStrategyAccount(strategy, key);
    const rows = holdingRows(account, stage3ByCode, lookups);
    const file = path.join(accountDir, `${slugify(key.toLowerCase())}.md`);
    const holdingsTable = rows.length > 0
      ? [
          "| 종목 | 코드 | 카테고리 | 평가금액 | 수량 | Action Score |",
          "| --- | --- | --- | ---: | ---: | ---: |",
          ...rows.map((row) => `| ${row.name} | ${row.code ?? "N/A"} | ${row.category} | ${won(row.marketValue)} | ${row.quantity ?? "N/A"} | ${row.score ?? "N/A"} |`),
        ]
      : ["보유 종목 없음"];

    const targetLines = Object.entries(strategyAccount?.target_allocation ?? {}).map(
      ([category, weight]) => `- ${category}: ${safePct(weight)}`
    );

    const candidateLines = topCandidates(plan, 5).map((item) => {
      const amount = item.suggestedAmount ? ` / ${won(item.suggestedAmount)}` : "";
      return `- ${item.name}${amount}`;
    });

    const content = [
      frontmatter({
        title: `${label} Account Playbook`,
        type: "account",
        updated: date,
        source_date: date,
        account_key: key,
      }),
      `# ${label} Account Playbook`,
      "",
      "## Role",
      "",
      `- 역할 요약: ${cleanSentence(plan?.macroCommentary?.summary ?? "전술/전략 자산 배치를 실행하는 것")}`,
      `- 현재 점수는 ${plan?.totalScore ?? stage3?.accounts?.[key]?.totalScore ?? "N/A"} 입니다.`,
      `- 현재 가용 현금은 ${won(account.cashAvailable)} 입니다.`,
      "",
      "## Target Allocation",
      "",
      ...(targetLines.length > 0 ? targetLines : ["- 전략 배분값 없음"]),
      "",
      "## Current Holdings",
      "",
      ...holdingsTable,
      "",
      "## What To Do Next",
      "",
      `- 집행 예산: ${won(plan?.deployBudget)}`,
      `- 유보 현금: ${won(plan?.reserveCash)}`,
      `- 가장 큰 카테고리 갭: ${plan?.topGap?.category ?? "N/A"} (${won(plan?.topGap?.gapAmount)})`,
      `- 행동 한 줄 요약: ${plan?.macroCommentary?.actionLine ?? "계획 없음"}`,
      "",
      "## Candidate Assets",
      "",
      ...(candidateLines.length > 0 ? candidateLines : ["- 없음"]),
      "",
      "## Money-Making Rule",
      "",
      "- 이 페이지는 단순 현황판이 아니라, 어떤 카테고리 갭을 언제 메워야 복리가 좋아지는지 기억하는 플레이북이어야 합니다.",
      "- 새 리포트가 들어오면 반드시 이 계좌의 기존 전략과 연결해서 보강/보류/관망 중 하나로 귀결시킵니다.",
    ].join("\n");

    await writeText(file, `${content}\n`);
    accountFiles.push(file);
  }

  return accountFiles;
}

async function buildSecurityPages({
  date,
  portfolio,
  stage1,
  impactMap,
  stage3,
  stage4,
  strategy,
  securityDir,
  lookups,
}) {
  const stage3ByCode = stage3HoldingsIndex(stage3, lookups);
  const plansByKey = stage4PlansIndex(stage4);
  const files = [];

  for (const code of allSecurityCodes({ portfolio, stage4, lookups })) {
    const security = SECURITIES_BY_CODE[code];
    if (!security) continue;

    const currentHoldings = [];
    for (const account of portfolio?.accounts ?? []) {
      for (const holding of account.holdings ?? []) {
        const holdingCode = resolveSecurityCode(holding.code ?? holding.name, lookups);
        if (holdingCode === code) {
          currentHoldings.push({
            accountKey: normalizeAccountKey(account.key),
            accountLabel: account.label,
            holding,
            category: getCategory(code, normalizeAccountKey(account.key)) ?? security.categories?.default ?? "기타",
          });
        }
      }
    }

    const mentions = [];
    for (const [accountKey, plan] of plansByKey.entries()) {
      for (const bucket of ["stagedBuys", "stage2Candidates", "trims", "holds", "watches"]) {
        for (const item of plan?.[bucket] ?? []) {
          const mentionCode = resolveSecurityCode(item.code ?? item.name, lookups);
          if (mentionCode !== code) continue;
          mentions.push({
            accountKey,
            accountLabel: plan.label,
            bucket,
            item,
          });
        }
      }
    }

    const { evidence, impactLines } = extractRecentEvidence(stage1, impactMap, code, security.name);
    const stage3Entry = stage3ByCode.get(code);
    const file = path.join(securityDir, `${code}-${slugify(security.name)}.md`);
    const opportunityLines = buildOpportunityMemo({
      security,
      plans: mentions,
      holdings: currentHoldings,
      stage3Entry,
    });

    const holdingLines = currentHoldings.map((item) => {
      const strategyAccount = loadStrategyAccount(strategy, item.accountKey);
      const targetWeight = strategyAccount?.target_allocation?.[item.category];
      return `- ${item.accountLabel}: ${won(item.holding.marketValue)} / 카테고리 ${item.category} / 목표 ${targetWeight ? safePct(targetWeight) : "N/A"}`;
    });

    const mentionLines = mentions.map((item) => {
      const amount = item.item?.suggestedAmount ? ` / ${won(item.item.suggestedAmount)}` : "";
      return `- ${item.accountLabel}: ${bucketLabel(item.bucket)}${amount}`;
    });

    const content = [
      frontmatter({
        title: security.name,
        type: "security",
        updated: date,
        source_date: date,
        code,
      }),
      `# ${security.name}`,
      "",
      "## Snapshot",
      "",
      `- 코드: ${code}`,
      `- 유형: ${security.type ?? "N/A"}`,
      `- 버킷: ${security.bucket ?? "N/A"}`,
      `- 자산군: ${security.asset_class ?? "N/A"}`,
      `- 지역: ${security.region ?? "N/A"}`,
      `- 현재 신호: ${stage3Entry?.signal ?? "N/A"} / action score ${stage3Entry?.actionScore ?? "N/A"}`,
      "",
      "## Why This Can Make Money",
      "",
      ...opportunityLines,
      "",
      "## Current Exposure",
      "",
      ...(holdingLines.length > 0 ? holdingLines : ["- 현재 보유 없음"]),
      "",
      "## Where It Shows Up In The Plan",
      "",
      ...(mentionLines.length > 0 ? mentionLines : ["- 현재 일일 계획에서 직접 언급되지 않음"]),
      "",
      "## Evidence",
      "",
      ...(evidence.length > 0 ? evidence : ["- 최근 Stage 1 리포트에서 직접 근거가 아직 충분히 축적되지 않았습니다."]),
      "",
      "## Impact Map",
      "",
      ...(impactLines.length > 0 ? impactLines : ["- 현재 확정 impact-map 근거 없음"]),
      "",
      "## Next Review Trigger",
      "",
      "- 다음 일일 러너에서 이 종목이 `stagedBuys`에 남는지 확인합니다.",
      "- 새 리포트가 들어오면 이 종목 또는 같은 카테고리 대체재와 연결해 업데이트합니다.",
      "- 점수가 약화되거나 카테고리 갭이 해소되면 신규 자금 우선순위에서 내립니다.",
    ].join("\n");

    await writeText(file, `${content}\n`);
    files.push(file);
  }

  return files;
}

async function buildIndexPage({ overviewFile, dailyFile, accountFiles, securityFiles }) {
  const file = path.join(WIKI_ROOT, "index.md");
  const accountLinks = await Promise.all(
    accountFiles.map(async (item) => {
      const title = await pageTitle(item, path.basename(item, ".md"));
      return `- ${markdownLink(file, item, title.replace(/ Account Playbook$/, ""))}`;
    }),
  );
  const securityLinks = await Promise.all(
    securityFiles
      .slice()
      .sort()
      .map(async (item) => {
        const title = await pageTitle(item, path.basename(item, ".md"));
        return `- ${markdownLink(file, item, title)}`;
      }),
  );
  const content = [
    "# EcoReport Wiki Index",
    "",
    "이 파일은 투자 의사결정에 바로 필요한 페이지를 빠르게 찾기 위한 카탈로그입니다.",
    "",
    "## Overview",
    "",
    `- ${markdownLink(file, overviewFile, "EcoReport LLM Wiki Overview")}`,
    "",
    "## Daily",
    "",
    `- ${markdownLink(file, dailyFile, path.basename(dailyFile, ".md"))}`,
    "",
    "## Accounts",
    "",
    ...accountLinks,
    "",
    "## Securities",
    "",
    ...securityLinks,
  ].join("\n");

  await writeText(file, `${content}\n`);
  return file;
}

async function updateLog(date) {
  const file = path.join(WIKI_ROOT, "log.md");
  const previous = await readText(file, "# EcoReport Wiki Log\n",);
  if (previous.includes(`## [${date}]`)) {
    return file;
  }

  const entry = [
    previous.trimEnd(),
    "",
    `## [${date}] compile | Daily pipeline -> persistent wiki`,
    "",
    "- Built daily decision memo from Stage 1~4 outputs.",
    "- Refreshed account playbooks from portfolio, strategy, and execution plan.",
    "- Refreshed security thesis pages for holdings and active candidates.",
    "",
  ].join("\n");

  await writeText(file, `${entry}\n`);
  return file;
}

async function ensureWikiDirs() {
  await fs.mkdir(path.join(WIKI_ROOT, "daily"), { recursive: true });
  await fs.mkdir(path.join(WIKI_ROOT, "accounts"), { recursive: true });
  await fs.mkdir(path.join(WIKI_ROOT, "securities"), { recursive: true });
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const date = args.date;
  const lookups = buildSecurityLookups();

  const portfolio = await readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), {});
  const strategy = await readJson(path.join(ROOT_DIR, "config", "strategy.json"), {});
  const stage1 = await readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "stage1-report-extracts-v2.json"), {});
  const impactMap = await readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "impact-map.json"), {});
  const stage3 = await readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "stage3-quant-scores.json"), {});
  const stage4 = await readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "stage4-execution-plan.json"), {});

  if (!stage4 || Object.keys(stage4).length === 0) {
    throw new Error(`Missing Stage 4 execution plan for ${date}`);
  }

  await ensureWikiDirs();
  const dailyPagesDir = path.join(WIKI_ROOT, "daily");
  const dailyFile = await buildDailyPage({ date, portfolio, stage1, stage3, stage4, dailyPagesDir });
  const recentDates = await existingDates(dailyPagesDir);
  const overviewFile = await buildOverviewPage({ date, recentDates });
  const accountFiles = await buildAccountPages({
    date,
    portfolio,
    strategy,
    stage3,
    stage4,
    accountDir: path.join(WIKI_ROOT, "accounts"),
    lookups,
  });
  const securityFiles = await buildSecurityPages({
    date,
    portfolio,
    stage1,
    impactMap,
    stage3,
    stage4,
    strategy,
    securityDir: path.join(WIKI_ROOT, "securities"),
    lookups,
  });
  await buildIndexPage({ overviewFile, dailyFile, accountFiles, securityFiles });
  await updateLog(date);

  console.log(WIKI_ROOT);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
