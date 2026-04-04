#!/usr/bin/env node
// 4단계: Stage 1~3 데이터를 모두 활용해 계좌별 실행 계획을 생성합니다.

import path from "node:path";

import {
  CATEGORY_BY_CODE,
  PREFERRED_LABEL_BY_CATEGORY,
  ROOT_DIR,
  parseDateArgs,
  readJson,
  won,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";

function normalizeStrategyAccountKey(account) {
  if (account.key === "ISA") return "ISA";
  if (account.key === "PENSION") return "연금저축";
  if (account.key === "TOSS") return "토스증권";
  return null;
}

function buildCategoryGaps(account, strategy) {
  const strategyKey = normalizeStrategyAccountKey(account);
  const targetAllocation = strategy?.accounts?.[strategyKey]?.target_allocation ?? {};
  const holdingsValue = (account.holdings ?? []).reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0);
  const totalAssets = Math.max(account.evaluationAmount ?? 0, holdingsValue + (account.cashAvailable ?? 0));
  const amounts = new Map();
  for (const holding of account.holdings ?? []) {
    const category =
      CATEGORY_BY_CODE[holding.code]?.[account.key] ??
      CATEGORY_BY_CODE[holding.code]?.default ??
      "기타";
    amounts.set(category, (amounts.get(category) ?? 0) + (holding.marketValue ?? 0));
  }
  if (targetAllocation["현금파킹"] != null) {
    amounts.set("현금파킹", account.cashAvailable ?? 0);
  }
  return Object.entries(targetAllocation)
    .map(([category, pct]) => {
      const current = amounts.get(category) ?? 0;
      return {
        category,
        targetPct: pct,
        currentPct: totalAssets > 0 ? current / totalAssets : 0,
        gapAmount: Math.round(totalAssets * pct - current),
      };
    })
    .sort((left, right) => right.gapAmount - left.gapAmount);
}

function executionBuckets(account, quant, stage2Action, strategy) {
  const gaps = buildCategoryGaps(account, strategy);
  const nextTranchePct =
    strategy?.dca_plan?.schedule?.find((item) => item.status !== "done" && item.status !== "completed")?.pct ?? 0.25;
  const deployBudget = Math.round(
    Math.max(0, Math.min(account.cashAvailable ?? 0, (Math.max(account.evaluationAmount ?? 0, 0) + Math.max(account.cashAvailable ?? 0, 0)) * nextTranchePct)),
  );
  const buy = [];
  const trim = [];
  const hold = [];
  const watch = [];

  for (const holding of account.holdings ?? []) {
    const score = quant.holdings?.[holding.code]?.actionScore ?? 50;
    const entry = {
      code: holding.code,
      name: holding.name,
      score,
      reason: quant.holdings?.[holding.code]?.reportImpacts?.[0]?.reason ?? quant.holdings?.[holding.code]?.technicalSignal ?? "점수 기반 분류",
    };
    if (score >= 68) buy.push(entry);
    else if (score <= 38) trim.push(entry);
    else if (score >= 50) hold.push(entry);
    else watch.push(entry);
  }

  const topGap = gaps.find((item) => item.category !== "현금파킹" && item.gapAmount > 0);
  const candidateFromGap = topGap ? PREFERRED_LABEL_BY_CATEGORY[topGap.category] : null;

  return {
    deployBudget,
    reserveCash: Math.max((account.cashAvailable ?? 0) - deployBudget, 0),
    stage2Bias: stage2Action?.bias ?? "hold",
    topGap,
    gapSummary: gaps.slice(0, 4),
    buy,
    trim,
    hold,
    watch,
    candidateFromGap,
  };
}

function resolveStage2Candidates(account, stage2Data, bucket) {
  const allCandidates = stage2Data?.candidate_scores ?? [];
  const accountKeyHints = new Set([account.key, account.label]);
  const buyCodes = new Set(bucket.stage2Bias ? (stage2Data?.account_actions ?? [])
    .find((item) => item.account_key === account.key || item.account_key === account.label)?.buy_candidates ?? [] : []);
  const desiredCategory = bucket.topGap?.category ?? null;

  const matched = allCandidates.filter((item) => {
    const targets = item.target_accounts ?? [];
    const matchesAccount = targets.some((target) => accountKeyHints.has(target));
    const itemCategory =
      CATEGORY_BY_CODE[item.code]?.[account.key] ??
      CATEGORY_BY_CODE[item.code]?.default ??
      null;
    const matchesCategory = desiredCategory != null && itemCategory === desiredCategory;
    const alreadyHeld = (account.holdings ?? []).some((holding) => holding.code === item.code);
    const matchesGapLabel =
      bucket.candidateFromGap &&
      (item.name === bucket.candidateFromGap ||
        item.code === bucket.candidateFromGap ||
        (item.thesis ?? "").includes(bucket.candidateFromGap));
    const matchesBuyCode = buyCodes.has(item.code);
    return matchesCategory || matchesGapLabel || (matchesAccount && (alreadyHeld || itemCategory !== "기타")) || matchesBuyCode;
  });

  const sorted = matched
    .map((item) => {
      const itemCategory =
        CATEGORY_BY_CODE[item.code]?.[account.key] ??
        CATEGORY_BY_CODE[item.code]?.default ??
        null;
      const categoryBonus = desiredCategory != null && itemCategory === desiredCategory ? 4 : 0;
      const gapBonus = bucket.candidateFromGap && item.name === bucket.candidateFromGap ? 3 : 0;
      const buyCodeBonus = buyCodes.has(item.code) ? 2 : 0;
      const holdBonus = (account.holdings ?? []).some((holding) => holding.code === item.code) ? 1 : 0;
      return {
        ...item,
        __rank: categoryBonus + gapBonus + buyCodeBonus + holdBonus,
      };
    })
    .sort((left, right) => right.__rank - left.__rank);

  return sorted.slice(0, 3).map((item) => ({
    code: item.code,
    name: item.name,
    score: null,
    reason: item.thesis ?? "Stage 2 후보 논리",
    source: "stage2",
  }));
}

function distributeBudget(bucket, stage2Candidates = []) {
  const fallbackCandidates =
    bucket.candidateFromGap != null
      ? [
          {
            code: bucket.topGap?.code ?? null,
            name: bucket.candidateFromGap,
            score: null,
            reason: `${bucket.topGap?.category ?? "부족 자산군"} 목표 배분을 메우기 위한 보강`,
            source: "gap",
          },
          ...bucket.buy.slice(0, 2),
        ]
      : bucket.buy.slice(0, 3);
  const candidates = stage2Candidates.length > 0 ? stage2Candidates : fallbackCandidates;
  if (bucket.deployBudget <= 0 || candidates.length === 0) return [];
  const weights = candidates.length === 1 ? [1] : candidates.length === 2 ? [0.6, 0.4] : [0.5, 0.3, 0.2];
  return candidates.map((item, index) => ({
    ...item,
    suggestedAmount: Math.round(bucket.deployBudget * weights[index]),
  }));
}

function summarizeMacroTheme(stage2Data) {
  const summary = String(stage2Data?.macro_view?.summary ?? "").replace(/\s+/g, " ").trim();
  if (!summary) return null;
  if (/유가|원유|중동|이란|호르무즈/i.test(summary)) {
    return "중동 지정학 리스크와 유가 상승이 시장 변동성을 키우고 있습니다.";
  }
  if (/금리|CPI|인플레이션|연준|FOMC/i.test(summary)) {
    return "인플레이션과 금리 상방 압력이 위험자산 선호를 누르고 있습니다.";
  }
  if (/AI|데이터센터|전력|반도체/i.test(summary)) {
    return "AI 인프라와 전력 수요가 구조적 성장 축으로 다시 부각되고 있습니다.";
  }
  return summary;
}

function categoryNarrative(category) {
  if (category === "금") return "방어자산과 원자재 헤지";
  if (category === "배당/커버드콜") return "변동성 완충형 인컴 자산";
  if (category === "현금파킹") return "대기 자금과 금리 방어 버퍼";
  if (category === "S&P500" || category === "미국인덱스") return "미국 코어 인덱스";
  if (category === "나스닥100") return "미국 성장/빅테크";
  if (category === "전력기기") return "AI·전력 인프라";
  if (category === "방산") return "지정학 민감 방산";
  if (category === "원자력") return "에너지 안보/원전";
  return category;
}

function accountPersona(accountKey) {
  if (accountKey === "ISA") {
    return "절세 계좌 특성상 국내 ETF 중심의 방어·인컴·테마 배치를 유연하게 조정하는 역할";
  }
  if (accountKey === "PENSION") {
    return "장기 복리 관점에서 미국 코어 자산과 방어 자산을 안정적으로 쌓는 역할";
  }
  if (accountKey === "TOSS") {
    return "전술 테마와 성장 섹터를 민첩하게 반영하는 역할";
  }
  return "계좌 목적에 맞는 자산 배분 역할";
}

function topImpactReasons(impactMap, account, limit = 3) {
  const reasons = [];

  for (const report of impactMap?.reports ?? []) {
    for (const impact of report.impacts ?? []) {
      const target = impact.target ?? {};
      const matchesAccount = target.accountKey === account.key;
      const matchesHolding =
        target.type === "holding" &&
        (account.holdings ?? []).some((holding) => holding.code === target.code);
      const matchesCategory =
        target.type === "category" &&
        Boolean(target.accountKey === account.key && target.name);
      if (!matchesAccount && !matchesHolding && !matchesCategory) continue;

      reasons.push({
        reportTitle: report.title,
        direction: impact.direction ?? "neutral",
        targetType: target.type ?? "unknown",
        targetName: target.name ?? target.code ?? account.label,
        text: impact.evidence?.snippets?.[0] ?? null,
        riskTags: impact.riskTags ?? [],
      });
    }
  }

  return reasons.slice(0, limit);
}

function simplifyDriverText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const cleaned = text
    .replace(/^[•\-–—\s]+/, "")
    .replace(/\s*\.\.\.\s*$/, "")
    .trim();
  if (cleaned.length <= 180) return cleaned;
  const sentence = cleaned.match(/^(.{40,180}?[.!?])(?:\s|$)/)?.[1];
  if (sentence) return sentence.trim();
  return `${cleaned.slice(0, 177).trim()}...`;
}

function buildMacroCommentary({
  account,
  bucket,
  stage2Action,
  stage2Data,
  stage1Drivers,
  impactMap,
}) {
  const macroHeadline = summarizeMacroTheme(stage2Data);
  const gapCategory = bucket.topGap?.category ?? null;
  const assetFocus = gapCategory ? categoryNarrative(gapCategory) : null;
  const persona = accountPersona(account.key);
  const firstBuy = bucket.stage2Candidates?.[0] ?? bucket.buy?.[0] ?? null;
  const reserveNote = stage2Action?.reserve_cash_note
    ? String(stage2Action.reserve_cash_note).replace(/\s+/g, " ").trim()
    : null;
  const rationale = stage2Action?.rationale
    ? String(stage2Action.rationale).replace(/\s+/g, " ").trim()
    : null;
  const isReadableDriver = (value) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 28) return false;
    if ((text.match(/\b\d[\d,.-]*\b/g) ?? []).length >= 10) return false;
    if ((text.match(/[u│■•□]/g) ?? []).length >= 3) return false;
    if (/다올투자증권|여의나루로|본사영업점/i.test(text)) return false;
    return true;
  };

  const mappedDrivers = topImpactReasons(impactMap, account, 3)
    .map((item) => {
      const reportLabel = simplifyDriverText(item.reportTitle)?.replace(/^\[[^\]]+\]\s*/, "") ?? "관련 리포트";
      const directionLabel =
        item.direction === "positive"
          ? "긍정"
          : item.direction === "negative"
            ? "부정"
            : item.direction === "mixed"
              ? "혼합"
              : "중립";
      const riskHint =
        item.riskTags?.includes("oil")
          ? "유가"
          : item.riskTags?.includes("rates")
            ? "금리"
            : item.riskTags?.includes("geopolitics")
              ? "지정학"
              : item.riskTags?.includes("ai")
                ? "AI 인프라"
                : item.riskTags?.includes("defense")
                  ? "방산"
                  : null;
      const base = `${reportLabel}는 ${item.targetName}에 ${directionLabel} 신호를 줍니다${riskHint ? ` (${riskHint})` : ""}.`;
      return base;
    })
    .filter(Boolean);

  const researchDrivers = (stage1Drivers ?? [])
    .map((item) => String(item.thesis ?? "").replace(/\s+/g, " ").trim())
    .map((item) => simplifyDriverText(item))
    .filter((item) => isReadableDriver(item))
    .slice(0, 2);

  const summaryParts = [
    macroHeadline,
    assetFocus ? `${account.label}은 ${assetFocus} 비중 조정이 핵심입니다.` : null,
    `${persona}로 작동하는 계좌입니다.`,
  ].filter(Boolean);

  const actionLine =
    bucket.deployBudget > 0 && (bucket.topGap || firstBuy)
      ? `${account.label}은 ${bucket.topGap?.category ?? "핵심 자산"}을 우선 보강하고, ${
          firstBuy?.name ?? bucket.candidateFromGap ?? "선별 후보"
        }를 중심으로 ${won(bucket.deployBudget)} 한도에서 분할 접근하는 편이 좋습니다.`
      : `${account.label}은 지금은 공격적 확대보다 기존 포지션과 현금 비중을 재점검하는 편이 좋습니다.`;

  return {
    summary: summaryParts.join(" "),
    drivers: [
      ...(macroHeadline ? [macroHeadline] : []),
      ...(rationale ? [rationale] : []),
      ...mappedDrivers,
      ...researchDrivers,
    ].slice(0, 4),
    assetFocus: [
      ...(assetFocus ? [assetFocus] : []),
      ...(bucket.topGap?.category ? [bucket.topGap.category] : []),
      ...bucket.gapSummary.slice(0, 2).map((item) => item.category),
    ]
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index)
      .slice(0, 4),
    actionLine,
    reserveNote,
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const stateDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const [portfolio, strategy, stage1, stage2, quant, impactMap] = await Promise.all([
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] }),
    readJson(path.join(ROOT_DIR, "config", "strategy.json"), { accounts: {} }),
    readJson(path.join(stateDir, "stage1-report-extracts-v2.json"), { extracts: [] }),
    readJson(path.join(stateDir, "stage2-strategy-options.json"), null),
    readJson(path.join(stateDir, "stage3-quant-scores.json"), { holdings: {}, accounts: {}, portfolio: {} }),
    readJson(path.join(stateDir, "impact-map.json"), { reports: [] }),
  ]);
  const stage2Data = stage2 ?? (await readJson(path.join(stateDir, "stage2-strategy-options.mock.json"), { account_actions: [], strategy_changes: [] }));

  const accountPlans = (portfolio.accounts ?? []).map((account) => {
    const stage2Action =
      stage2Data.account_actions?.find((item) => item.account_key === account.key || item.account_key === normalizeStrategyAccountKey(account)) ??
      null;
    const bucket = executionBuckets(account, quant, stage2Action, strategy);
    const stage2Candidates = resolveStage2Candidates(account, stage2Data, bucket);
    bucket.stage2Candidates = stage2Candidates;
    const stage1Drivers = stage1.extracts
      .filter((item) => item.related_accounts?.includes(account.key))
      .slice(0, 4)
      .map((item) => ({ id: item.id, title: item.title, thesis: item.key_thesis }));
    const stagedBuys = distributeBudget(bucket, stage2Candidates);
    const macroCommentary = buildMacroCommentary({
      account,
      bucket,
      stage2Action,
      stage2Data,
      stage1Drivers,
      impactMap,
    });
    return {
      key: account.key,
      label: account.label,
      totalScore: quant.accounts?.[account.key]?.totalScore ?? 50,
      stage2Bias: bucket.stage2Bias,
      deployBudget: bucket.deployBudget,
      reserveCash: bucket.reserveCash,
      topGap: bucket.topGap,
      candidateFromGap: bucket.candidateFromGap,
      stage2Candidates,
      stagedBuys,
      trims: bucket.trim.slice(0, 3),
      holds: bucket.hold.slice(0, 3),
      watches: bucket.watch.slice(0, 3),
      macroCommentary,
      stage1Drivers,
    };
  });

  const outputJson = args.output ?? path.join(stateDir, "stage4-execution-plan.json");
  const outputMarkdown =
    args.markdown ?? path.join(ROOT_DIR, "reports", "daily", `${args.date}-stage4-execution-plan.md`);
  const outputBriefing =
    args.briefing ?? path.join(ROOT_DIR, "reports", "daily", `${args.date}-briefing.md`);

  const payload = {
    date: args.date,
    runDate: args.runDate,
    effectiveMarketDate: args.effectiveMarketDate,
    generatedAt: new Date().toISOString(),
    portfolioScore: quant.portfolio?.totalScore ?? 50,
    regime: quant.regime ?? null,
    accountPlans,
  };

  const regimeConfidence =
    typeof quant.regime?.confidence === "number" ? quant.regime.confidence.toFixed(2) : "N/A";

  const markdown = [
    `# EcoReport Stage 4 Execution Plan (${args.date})`,
    "",
    `- 실행일: ${args.runDate}`,
    `- 기준 거래일: ${args.effectiveMarketDate}`,
    `- 포트폴리오 총점: ${quant.portfolio?.totalScore ?? "N/A"}점`,
    `- 레짐: ${quant.regime?.name ?? "N/A"} (신뢰도 ${regimeConfidence})`,
    "",
    ...accountPlans.flatMap((account) => [
      `## ${account.label} (${account.key})`,
      `- 계좌 총점: ${account.totalScore}점`,
      `- Stage 2 bias: ${account.stage2Bias}`,
      `- 이번 단계 투입 가능 금액: ${won(account.deployBudget)}`,
      `- 남길 예수금: ${won(account.reserveCash)}`,
      `- 가장 부족한 자산군: ${account.topGap ? `${account.topGap.category} / ${won(Math.max(account.topGap.gapAmount, 0))}` : "없음"}`,
      `- 우선 보강 후보: ${account.candidateFromGap ?? "없음"}`,
      `- 매크로 → 자산군 → 액션: ${account.macroCommentary?.actionLine ?? "요약 없음"}`,
      "",
      "### 1차 실행",
      ...(account.stagedBuys.length > 0
        ? account.stagedBuys.map((item) => `- ${item.name}${item.code ? `(${item.code})` : ""} ${won(item.suggestedAmount)} / 이유: ${item.reason}`)
        : ["- 즉시 매수 후보 없음"]),
      "",
      "### 비중 축소/재점검",
      ...(account.trims.length > 0
        ? account.trims.map((item) => `- ${item.name}(${item.code}) / ${item.score}점 / ${item.reason}`)
        : ["- 즉시 축소 대상 없음"]),
      "",
      "### 유지/관찰",
      ...(account.holds.length > 0 ? account.holds.map((item) => `- 유지: ${item.name}(${item.code}) / ${item.score}점`) : ["- 유지 후보 없음"]),
      ...(account.watches.length > 0 ? account.watches.map((item) => `- 관찰: ${item.name}(${item.code}) / ${item.score}점`) : []),
      "",
      "### Stage 1 근거",
      ...(account.stage1Drivers.length > 0
        ? account.stage1Drivers.map((item) => `- ${item.id}: ${item.title} / ${item.thesis}`)
        : ["- 직접 관련 리포트 추출 없음"]),
      "",
      "### 매크로 코멘터리",
      ...(account.macroCommentary?.drivers?.length > 0
        ? account.macroCommentary.drivers.map((item) => `- ${item}`)
        : ["- 직접 연결된 거시 코멘트 없음"]),
      "",
    ]),
  ].join("\n");

  const briefing = [
    `# EcoReport 어드바이저 브리핑 (${args.date})`,
    "",
    `- run_date: ${args.runDate}`,
    `- effective_market_date: ${args.effectiveMarketDate}`,
    `- generated_at: ${new Date().toISOString()}`,
    `- 포트폴리오 총점: ${quant.portfolio?.totalScore ?? "N/A"}점`,
    `- 현재 레짐: ${quant.regime?.name ?? "N/A"} / 신뢰도 ${regimeConfidence}`,
    `- 핵심 코멘트: ${quant.portfolio?.note ?? "요약 없음"}`,
    "",
    "## 오늘의 우선 액션",
    ...accountPlans.map((account) => {
      const firstBuy = account.stagedBuys[0];
      const topGap = account.topGap?.category ?? "없음";
      return `- ${account.label}: ${topGap} 보강 우선 / ${account.totalScore}점 / 1차 ${firstBuy ? `${firstBuy.name} ${won(firstBuy.suggestedAmount)}` : "즉시 매수 없음"}`;
    }),
    "",
    "## 계좌별 코멘트",
    ...accountPlans.flatMap((account) => [
      `### ${account.label}`,
      `- 계좌 총점: ${account.totalScore}점`,
      ...(account.macroCommentary?.summary ? [`- 매크로 요약: ${account.macroCommentary.summary}`] : []),
      `- 부족한 자산군: ${account.topGap ? `${account.topGap.category} (${won(Math.max(account.topGap.gapAmount, 0))})` : "없음"}`,
      `- 남길 예수금: ${won(account.reserveCash)}`,
      `- 우선 후보: ${account.stage2Candidates.length > 0 ? account.stage2Candidates.map((item) => item.name).join(", ") : account.candidateFromGap ?? "없음"}`,
      ...(account.macroCommentary?.actionLine ? [`- 액션 연결: ${account.macroCommentary.actionLine}`] : []),
      ...(account.trims.length > 0
        ? [`- 재점검 필요: ${account.trims.map((item) => `${item.name} ${item.score}점`).join(", ")}`]
        : [`- 재점검 필요: 즉시 축소 대상 없음`]),
      "",
    ]),
  ].join("\n");

  await writeJson(outputJson, payload);
  await writeText(outputMarkdown, `${markdown}\n`);
  await writeText(outputBriefing, `${briefing}\n`);
  console.log(outputJson);
}

main().catch((error) => {
  console.error(`stage4 execution plan 생성 실패: ${error.message}`);
  process.exit(1);
});
