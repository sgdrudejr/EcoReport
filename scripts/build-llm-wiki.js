#!/usr/bin/env node
// EcoReport의 일일 산출물을 지속형 투자 위키로 컴파일합니다.

import fs from "node:fs/promises";
import path from "node:path";

import {
  ROOT_DIR,
  SECURITIES_BY_CODE,
  buildRunMetadata,
  compactWhitespace,
  enrichPortfolioWithSecurityCodes,
  getCategory,
  parseDateArgs,
  readJson,
  readText,
  resolveSecurityCodeFromCandidates,
  won,
  writeText,
} from "./lib/pipeline-utils.js";
import { allRefinementArtifactPaths } from "./lib/refinement-rounds.js";

const WIKI_ROOT = path.join(ROOT_DIR, "knowledge", "wiki");
const ACCOUNT_LABEL_BY_KEY = {
  ISA: "ISA",
  PENSION: "연금저축",
  KIS_MAIN: "한투 일반",
};

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

function uniqueStrings(items) {
  return [...new Set((items ?? []).map((item) => compactWhitespace(item ?? "")).filter(Boolean))];
}

function normalizeRuleKey(value) {
  return compactWhitespace(value ?? "")
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/[(){}\[\].,/:;!?-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/합니다|한다/g, "")
    .trim();
}

function uniqueRuleStrings(items) {
  const seen = new Set();
  const output = [];
  for (const item of items ?? []) {
    const text = compactWhitespace(item ?? "");
    if (!text) continue;
    const key = normalizeRuleKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function looksLikeNoisyDecisionReason(value) {
  const text = compactWhitespace(value ?? "");
  if (!text) return true;
  if (text.length > 220) return true;
  if (text.includes("...")) return true;
  if (/Compliance Notice|STOCK DATA|목표주가|컨센서스|영업이익|매출액|분기 실적|적자폭/i.test(text)) return true;
  const digitCount = (text.match(/\d/g) ?? []).length;
  if (digitCount >= 20) return true;
  return false;
}

function summarizeDecisionReason({ rawReason, plan, item, bucket }) {
  const cleaned = cleanSentence(rawReason);
  if (!looksLikeNoisyDecisionReason(cleaned)) {
    return cleaned.length > 160 ? `${cleaned.slice(0, 160)}...` : cleaned;
  }

  const name = item?.name ?? "해당 자산";
  const accountLabel = plan?.label ?? ACCOUNT_LABEL_BY_KEY[normalizeAccountKey(plan?.key)] ?? "해당";
  const category = plan?.topGap?.category ? `${plan.topGap.category} ` : "";

  if (bucket === "stagedBuys") {
    return `${name}은 ${accountLabel} 계좌에서 ${category}갭을 보강하기 위한 실행 후보입니다.`;
  }
  if (bucket === "trims") {
    return `${name}은 ${accountLabel} 계좌에서 확대보다 축소 또는 재평가 우선순위가 높습니다.`;
  }
  if (bucket === "holds") {
    return `${name}은 ${accountLabel} 계좌의 기존 보유 자산으로, 유지 이유와 재판단 조건을 계속 추적합니다.`;
  }
  if (bucket === "watches") {
    return `${name}은 ${accountLabel} 계좌에서 아직 관찰 단계이며 직접 근거가 더 필요합니다.`;
  }
  if (bucket === "stage2Candidates") {
    return `${name}은 ${accountLabel} 계좌의 전략 후보이며 실행 전 추가 검증이 필요합니다.`;
  }
  return `${name}에 대한 의사결정 근거를 다음 사이클에서 다시 확인해야 합니다.`;
}

function impactTypeLabel(targetType) {
  const mapping = {
    holding: "종목 직접",
    category: "카테고리",
    theme: "테마",
    account: "계좌",
    portfolio: "포트폴리오",
  };
  return mapping[targetType] ?? targetType ?? "unknown";
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
  if (upper === "TOSS" || text === "토스증권") return "KIS_MAIN";
  if (upper === "KIS_MAIN" || upper === "KIS" || text === "한투 일반" || text === "한투증권" || text === "한국투자증권") return "KIS_MAIN";
  return text;
}

function markdownLink(fromFile, targetFile, label) {
  const relative = path.relative(path.dirname(fromFile), targetFile).split(path.sep).join("/");
  return `[${label}](${relative})`;
}

async function analysisDates() {
  const analysisDir = path.join(ROOT_DIR, "data", "analysis-state");
  try {
    const entries = await fs.readdir(analysisDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
      .sort()
      .reverse();
  } catch {
    return [];
  }
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

function buildPageMeta(runMeta, title, type, extra = {}) {
  return {
    title,
    type,
    updated: runMeta.date,
    source_date: runMeta.date,
    run_date: runMeta.runDate,
    effective_market_date: runMeta.effectiveMarketDate,
    run_id: runMeta.runId ?? "N/A",
    generated_at: runMeta.generatedAt,
    ...extra,
  };
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

function stage3HoldingsIndex(stage3) {
  const byCode = new Map();
  for (const [rawCode, entry] of Object.entries(stage3?.holdings ?? {})) {
    const resolvedCode =
      SECURITIES_BY_CODE[rawCode]
        ? rawCode
        : resolveSecurityCodeFromCandidates(entry?.code, entry?.name, rawCode);
    if (resolvedCode) byCode.set(resolvedCode, entry);
  }
  return byCode;
}

function stage4PlansIndex(stage4) {
  return new Map((stage4?.accountPlans ?? []).map((plan) => [normalizeAccountKey(plan.key), plan]));
}

function allSecurityCodes({ portfolio, stage3, stage4 }) {
  const codes = new Set();

  for (const account of portfolio?.accounts ?? []) {
    for (const holding of account.holdings ?? []) {
      const code = resolveSecurityCodeFromCandidates(holding.code, holding.name);
      if (code) codes.add(code);
    }
  }

  for (const [rawCode, entry] of Object.entries(stage3?.holdings ?? {})) {
    const code = resolveSecurityCodeFromCandidates(rawCode, entry?.code, entry?.name);
    if (code) codes.add(code);
  }

  for (const plan of stage4?.accountPlans ?? []) {
    for (const bucket of ["stage2Candidates", "stagedBuys", "trims", "holds", "watches"]) {
      for (const item of plan[bucket] ?? []) {
        const code = resolveSecurityCodeFromCandidates(item.code, item.name);
        if (code) codes.add(code);
      }
    }
  }

  return [...codes];
}

function holdingRows(account, stage3ByCode) {
  const rows = [];
  for (const holding of account?.holdings ?? []) {
    const code = resolveSecurityCodeFromCandidates(holding.code, holding.name);
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

function extractRecentEvidence({ stage1, stage3Entry, code, securityName }) {
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

  if (evidence.length === 0) {
    for (const impact of stage3Entry?.reportImpacts ?? []) {
      const thesis = cleanSentence(impact.reason ?? "impact-map 근거");
      evidence.push(`- ${impact.title ?? impact.reportId ?? "Untitled report"}: ${thesis}`);
      if (evidence.length >= 3) break;
    }
  }

  return evidence;
}

function buildImpactLines({ impactMap, stage3Entry, relatedAccounts, relatedCategories }) {
  const lines = [];
  const seen = new Set();

  const pushLine = (key, value) => {
    if (!value || seen.has(key)) return;
    seen.add(key);
    lines.push(value);
  };

  for (const impact of stage3Entry?.reportImpacts ?? []) {
    const key = [impact.reportId, impact.targetType, impact.direction, impact.reason].join("|");
    const contribution =
      typeof impact.contribution === "number" ? impact.contribution.toFixed(3) : "N/A";
    pushLine(
      key,
      `- ${impact.title ?? impact.reportId ?? "Untitled report"}: ${impactTypeLabel(impact.targetType)} / ${impact.direction ?? "neutral"} / 기여 ${contribution} / ${cleanSentence(impact.reason ?? "impact-map 근거")}`,
    );
  }

  for (const report of impactMap?.reports ?? []) {
    for (const impact of report?.impacts ?? []) {
      const target = impact?.target ?? {};
      const accountKey = normalizeAccountKey(target.accountKey ?? target.name ?? "");
      const isRelevantAccount = target.type === "account" && relatedAccounts.has(accountKey);
      const isRelevantPortfolio = target.type === "portfolio";
      const isRelevantCategory = target.type === "category" && relatedCategories.has(target.name ?? "");
      if (!isRelevantAccount && !isRelevantPortfolio && !isRelevantCategory) continue;

      const scope =
        target.type === "account"
          ? `${impactTypeLabel(target.type)}(${ACCOUNT_LABEL_BY_KEY[accountKey] ?? accountKey ?? "N/A"})`
          : target.type === "category"
            ? `${impactTypeLabel(target.type)}(${target.name ?? "N/A"})`
            : impactTypeLabel(target.type);
      const reason = cleanSentence(
        impact.evidence?.snippets?.[0] ?? impact.evidence?.numbers?.[0] ?? "impact-map 근거",
      );
      const key = [
        report.reportId,
        target.type,
        accountKey ?? target.name ?? "",
        impact.direction,
        reason,
      ].join("|");
      pushLine(
        key,
        `- ${report.title ?? "Untitled report"}: ${scope} / ${impact.direction ?? "neutral"} / 강도 ${impact.strength ?? "N/A"} / 신뢰 ${impact.confidence ?? "N/A"} / ${reason}`,
      );
    }
  }

  return lines.slice(0, 6);
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

async function buildDecisionHistoryIndex() {
  const byCode = new Map();
  const byAccount = new Map();
  const all = [];
  const dates = await analysisDates();

  for (const date of dates) {
    const [stage1, stage4] = await Promise.all([
      readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "stage1-report-extracts-v2.json"), {}),
      readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "stage4-execution-plan.json"), {}),
    ]);

    for (const plan of stage4?.accountPlans ?? []) {
      for (const bucket of ["stagedBuys", "trims", "holds", "watches", "stage2Candidates"]) {
        for (const item of plan?.[bucket] ?? []) {
          const code = resolveSecurityCodeFromCandidates(item?.code, item?.name);
          const relatedThemes = (stage1?.extracts ?? [])
            .filter(
              (extract) =>
                (code && extract?.related_holdings_in_my_portfolio?.some((holding) => holding?.code === code)) ||
                compactWhitespace(extract?.title ?? "").includes(compactWhitespace(item?.name ?? "")),
            )
            .flatMap((extract) => extract?.themes ?? []);

          const entry = {
            date,
            accountKey: normalizeAccountKey(plan?.key),
            accountLabel: plan?.label ?? ACCOUNT_LABEL_BY_KEY[normalizeAccountKey(plan?.key)] ?? plan?.key ?? "N/A",
            action: bucketLabel(bucket),
            bucket,
            code: code ?? null,
            name: item?.name ?? SECURITIES_BY_CODE[code]?.name ?? "Unknown",
            amount: item?.suggestedAmount ?? null,
            reason: summarizeDecisionReason({
              rawReason: item?.reason ?? plan?.macroCommentary?.actionLine ?? "",
              plan,
              item,
              bucket,
            }),
            keywords: uniqueStrings([
              ...(plan?.macroCommentary?.assetFocus ?? []),
              plan?.topGap?.category,
              ...relatedThemes,
            ]).slice(0, 6),
          };

          all.push(entry);

          if (entry.code) {
            const codeEntries = byCode.get(entry.code) ?? [];
            codeEntries.push(entry);
            byCode.set(entry.code, codeEntries);
          }

          if (entry.accountKey) {
            const accountEntries = byAccount.get(entry.accountKey) ?? [];
            accountEntries.push(entry);
            byAccount.set(entry.accountKey, accountEntries);
          }
        }
      }
    }
  }

  return {
    byCode,
    byAccount,
    all: all.sort((left, right) => right.date.localeCompare(left.date)),
  };
}

function formatDecisionEntry(entry) {
  const amount = typeof entry.amount === "number" ? ` / ${won(entry.amount)}` : "";
  const keywords = (entry.keywords ?? []).length > 0 ? ` / 키워드: ${(entry.keywords ?? []).join(", ")}` : "";
  return `- ${entry.date} / ${entry.accountLabel} / ${entry.action} / ${entry.name}${amount}${keywords} / ${entry.reason}`;
}

async function buildOperatingRulesPage({ runMeta, refinementMaps, memoryDir }) {
  const file = path.join(memoryDir, "operating-rules.md");
  const avoidRules = refinementMaps.flatMap((entry) => entry?.map?.lessons?.avoid ?? []);
  const improveRulesFromMaps = refinementMaps.flatMap((entry) => entry?.map?.lessons?.improve ?? []);
  const noGoRules = uniqueRuleStrings([
    "계좌 역할과 맞지 않는 추천을 하지 않는다.",
    "직접 리포트 근거가 약한 자산을 고확신 매수처럼 포장하지 않는다.",
    "Morning Letter 표, 수급 수치, boilerplate 문장을 thesis로 오인하지 않는다.",
    "메타 표현(stage2 근거, 모델상, 시스템상)을 사용자-facing 문구에 노출하지 않는다.",
    "보유·관망 사유를 말줄임표나 한 줄 결론으로 끝내지 않는다.",
    "좋은 이야기만 남기지 말고 무효화 조건과 보류 조건을 반드시 같이 남긴다.",
    ...avoidRules,
  ]);
  const improveRules = uniqueRuleStrings([
    "2차 질문은 전반 브리핑이 아니라 계좌·종목·카테고리별 빈틈 보강용으로 쪼갠다.",
    "실행 금액이 큰 후보는 follow-up research map에서 별도 트랙으로 재검토한다.",
    "대시보드 문구는 실제 투자자가 이해할 이유와 체크포인트 중심으로 쓴다.",
    "3차 질문은 새 아이디어 확장보다 무효화 조건, 대체재, 계좌 번역 정밀화에 집중한다.",
    ...improveRulesFromMaps,
  ]);

  const content = [
    frontmatter(buildPageMeta(runMeta, "EcoReport Operating Rules", "memory")),
    "# EcoReport Operating Rules",
    "",
    "이 페이지는 우리가 반복해서 실패하기 쉬운 지점을 미리 차단하기 위한 운영 규칙입니다.",
    "",
    "## 절대 하지 말 것",
    "",
    ...noGoRules.map((item) => `- ${item}`),
    "",
    "## 계속 개선할 것",
    "",
    ...improveRules.map((item) => `- ${item}`),
    "",
    "## Why This Exists",
    "",
    "- 좋은 분석이 있어도 계좌 역할, 무효화 조건, 근거 두께가 빠지면 실제 자금 배치 품질이 떨어집니다.",
    "- 이 규칙은 프롬프트, 브리핑, 위키, 대시보드 문구를 한 방향으로 묶기 위해 존재합니다.",
  ].join("\n");

  await writeText(file, `${content}\n`);
  return file;
}

async function buildResearchBacklogPage({ runMeta, refinementMaps, memoryDir }) {
  const file = path.join(memoryDir, "research-backlog.md");
  const sections = refinementMaps
    .filter((entry) => (entry?.map?.topics ?? []).length > 0)
    .map((entry) => ({
      round: entry.round,
      label: entry.label,
      topics: (entry.map?.topics ?? []).slice(0, entry.round >= 3 ? 6 : 8),
    }));
  const content = [
    frontmatter(buildPageMeta(runMeta, "EcoReport Research Backlog", "memory")),
    "# EcoReport Research Backlog",
    "",
    "오늘 stage를 모두 돌린 뒤에도 다시 확인해야 하는 토픽을 남기는 페이지입니다.",
    "",
    "## Carry-Forward Topics",
    "",
    ...(sections.length > 0
      ? sections.flatMap((section) => [
          `### Round ${section.round} · ${section.label}`,
          "",
          ...section.topics.flatMap((topic) => [
            `#### ${topic.label}`,
            `- why_now: ${topic.reason}`,
            `- keywords: ${(topic.keywords ?? []).slice(0, 8).join(" / ")}`,
            ...((topic.questions ?? []).slice(0, 3).map((item) => `- question: ${item}`)),
            ...((topic.gaps ?? []).slice(0, 2).map((item) => `- gap: ${item}`)),
            "",
          ]),
        ])
      : ["- 현재 follow-up backlog 없음."]),
  ].join("\n");

  await writeText(file, `${content}\n`);
  return file;
}

async function buildDecisionJournalPage({ runMeta, decisionHistory, memoryDir }) {
  const file = path.join(memoryDir, "decision-journal.md");
  const entries = (decisionHistory?.all ?? []).slice(0, 80);
  const grouped = new Map();

  for (const entry of entries) {
    const current = grouped.get(entry.date) ?? [];
    current.push(entry);
    grouped.set(entry.date, current);
  }

  const sections = [];
  for (const [date, dateEntries] of grouped.entries()) {
    sections.push(`## [${date}]`);
    sections.push("");
    for (const entry of dateEntries.slice(0, 12)) {
      sections.push(formatDecisionEntry(entry));
    }
    sections.push("");
  }

  const recurring = uniqueStrings(
    (decisionHistory?.all ?? [])
      .filter((entry, index, array) => array.findIndex((candidate) => candidate.name === entry.name) !== index)
      .map((entry) => entry.name),
  ).slice(0, 8);

  const content = [
    frontmatter(buildPageMeta(runMeta, "EcoReport Decision Journal", "memory")),
    "# EcoReport Decision Journal",
    "",
    "이 페이지는 실제 체결 내역이 아니라, EcoReport가 날짜별로 어떤 자산을 왜 사거나 줄이라고 했는지 기억하는 저널입니다.",
    "",
    "## How To Use",
    "",
    "- 같은 종목이 며칠 연속 살아남는지 확인합니다.",
    "- 어떤 키워드와 서사에서 추천이 나왔는지 복기합니다.",
    "- 나중에 thesis가 틀렸을 때 어떤 조건을 놓쳤는지 되짚는 근거로 씁니다.",
    "",
    "## Recurring Names",
    "",
    ...(recurring.length > 0 ? recurring.map((item) => `- ${item}`) : ["- 아직 반복 등장 종목이 많지 않습니다."]),
    "",
    "## Recent Entries",
    "",
    ...sections,
  ].join("\n");

  await writeText(file, `${content}\n`);
  return file;
}

async function buildOverviewPage({ runMeta, recentDates }) {
  const date = runMeta.date;
  const file = path.join(WIKI_ROOT, "overview.md");
  const content = [
    frontmatter(buildPageMeta(runMeta, "EcoReport LLM Wiki Overview", "overview")),
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
    "- `memory/`: 운영 규칙, 리서치 백로그, 의사결정 저널",
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

async function buildDailyPage({ runMeta, portfolio, stage1, stage3, stage4, dailyPagesDir }) {
  const date = runMeta.date;
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
    frontmatter(buildPageMeta(runMeta, `EcoReport Daily Wiki ${date}`, "daily")),
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
    "",
    "## Memory Links",
    "",
    "- [Operating Rules](../memory/operating-rules.md)",
    "- [Research Backlog](../memory/research-backlog.md)",
    "- [Decision Journal](../memory/decision-journal.md)",
  ].join("\n");

  await writeText(file, `${content}\n`);
  return file;
}

async function buildAccountPages({ runMeta, portfolio, strategy, stage3, stage4, decisionHistory, accountDir }) {
  const date = runMeta.date;
  const stage3ByCode = stage3HoldingsIndex(stage3);
  const plansByKey = stage4PlansIndex(stage4);
  const accountFiles = [];

  for (const account of portfolio?.accounts ?? []) {
    const key = normalizeAccountKey(account.key);
    const label = ACCOUNT_LABEL_BY_KEY[key] ?? account.label ?? key;
    const plan = plansByKey.get(key);
    const strategyAccount = loadStrategyAccount(strategy, key);
    const rows = holdingRows(account, stage3ByCode);
    const file = path.join(accountDir, `${slugify(key.toLowerCase())}.md`);
    const recentMemory = (decisionHistory?.byAccount?.get(key) ?? []).slice(0, 5);
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
      frontmatter(buildPageMeta(runMeta, `${label} Account Playbook`, "account", { account_key: key })),
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
      "## Recent Decision Memory",
      "",
      ...(recentMemory.length > 0
        ? recentMemory.map((entry) => formatDecisionEntry(entry))
        : ["- 아직 누적 의사결정 메모리가 충분하지 않습니다."]),
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
  runMeta,
  portfolio,
  stage1,
  impactMap,
  stage3,
  stage4,
  strategy,
  decisionHistory,
  securityDir,
}) {
  const date = runMeta.date;
  const stage3ByCode = stage3HoldingsIndex(stage3);
  const plansByKey = stage4PlansIndex(stage4);
  const files = [];

  for (const code of allSecurityCodes({ portfolio, stage3, stage4 })) {
    const security = SECURITIES_BY_CODE[code];
    if (!security) continue;

    const currentHoldings = [];
    for (const account of portfolio?.accounts ?? []) {
      for (const holding of account.holdings ?? []) {
        const holdingCode = resolveSecurityCodeFromCandidates(holding.code, holding.name);
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
          const mentionCode = resolveSecurityCodeFromCandidates(item.code, item.name);
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

    const stage3Entry = stage3ByCode.get(code);
    const relatedAccounts = new Set([
      ...currentHoldings.map((item) => item.accountKey).filter(Boolean),
      ...mentions.map((item) => item.accountKey).filter(Boolean),
    ]);
    const relatedCategories = new Set([
      security.categories?.default,
      ...currentHoldings.map((item) => item.category),
      ...mentions.map((item) => getCategory(code, item.accountKey)),
    ].filter(Boolean));
    const evidence = extractRecentEvidence({ stage1, stage3Entry, code, securityName: security.name });
    const impactLines = buildImpactLines({
      impactMap,
      stage3Entry,
      relatedAccounts,
      relatedCategories,
    });
    const decisionMemory = (decisionHistory?.byCode?.get(code) ?? []).slice(0, 6);
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
      frontmatter(buildPageMeta(runMeta, security.name, "security", { code })),
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
      `- 리포트 영향 점수: ${stage3Entry?.report?.impactScore ?? "N/A"} / 계좌 오버레이 ${stage3Entry?.report?.directAccountImpactScore ?? "N/A"}`,
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
      "## Decision Memory",
      "",
      ...(decisionMemory.length > 0
        ? decisionMemory.map((entry) => formatDecisionEntry(entry))
        : ["- 아직 누적 의사결정 메모리가 충분하지 않습니다."]),
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

async function buildIndexPage({ overviewFile, dailyFile, accountFiles, securityFiles, memoryFiles }) {
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
  const memoryLinks = await Promise.all(
    (memoryFiles ?? []).map(async (item) => {
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
    "",
    "## Memory",
    "",
    ...memoryLinks,
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
    "- Refreshed operating rules, research backlog, and decision journal memory pages.",
    "",
  ].join("\n");

  await writeText(file, `${entry}\n`);
  return file;
}

async function ensureWikiDirs() {
  await fs.mkdir(path.join(WIKI_ROOT, "daily"), { recursive: true });
  await fs.mkdir(path.join(WIKI_ROOT, "accounts"), { recursive: true });
  await fs.mkdir(path.join(WIKI_ROOT, "securities"), { recursive: true });
  await fs.mkdir(path.join(WIKI_ROOT, "memory"), { recursive: true });
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const runMeta = buildRunMetadata(args);
  const date = runMeta.date;
  const refinementArtifacts = allRefinementArtifactPaths({ date });

  const portfolioRaw = await readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), {});
  const portfolio = enrichPortfolioWithSecurityCodes(portfolioRaw);
  const strategy = await readJson(path.join(ROOT_DIR, "config", "strategy.json"), {});
  const stage1 = await readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "stage1-report-extracts-v2.json"), {});
  const impactMap = await readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "impact-map.json"), {});
  const stage3 = await readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "stage3-quant-scores.json"), {});
  const stage4 = await readJson(path.join(ROOT_DIR, "data", "analysis-state", date, "stage4-execution-plan.json"), {});
  const refinementMaps = (
    await Promise.all(
      refinementArtifacts.map(async (artifact) => ({
        round: artifact.spec.round,
        label: artifact.spec.label,
        map: await readJson(artifact.mapJson, null),
      })),
    )
  ).filter((entry) => entry.map);

  if (!stage4 || Object.keys(stage4).length === 0) {
    throw new Error(`Missing Stage 4 execution plan for ${date}`);
  }

  await ensureWikiDirs();
  const decisionHistory = await buildDecisionHistoryIndex();
  const memoryDir = path.join(WIKI_ROOT, "memory");
  const dailyPagesDir = path.join(WIKI_ROOT, "daily");
  const dailyFile = await buildDailyPage({ runMeta, portfolio, stage1, stage3, stage4, dailyPagesDir });
  const recentDates = await existingDates(dailyPagesDir);
  const overviewFile = await buildOverviewPage({ runMeta, recentDates });
  const operatingRulesFile = await buildOperatingRulesPage({ runMeta, refinementMaps, memoryDir });
  const researchBacklogFile = await buildResearchBacklogPage({ runMeta, refinementMaps, memoryDir });
  const decisionJournalFile = await buildDecisionJournalPage({ runMeta, decisionHistory, memoryDir });
  const accountFiles = await buildAccountPages({
    runMeta,
    portfolio,
    strategy,
    stage3,
    stage4,
    decisionHistory,
    accountDir: path.join(WIKI_ROOT, "accounts"),
  });
  const securityFiles = await buildSecurityPages({
    runMeta,
    portfolio,
    stage1,
    impactMap,
    stage3,
    stage4,
    strategy,
    decisionHistory,
    securityDir: path.join(WIKI_ROOT, "securities"),
  });
  await buildIndexPage({
    overviewFile,
    dailyFile,
    accountFiles,
    securityFiles,
    memoryFiles: [operatingRulesFile, researchBacklogFile, decisionJournalFile],
  });
  await updateLog(date);

  console.log(WIKI_ROOT);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
