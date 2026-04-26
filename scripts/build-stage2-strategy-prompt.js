#!/usr/bin/env node
// 2단계: Stage 1 추출물과 포트폴리오/기술점수를 바탕으로 LLM 전략 탐색 프롬프트를 생성합니다.

import path from "node:path";

import {
  buildPortfolioMaps,
  parseDateArgs,
  truncate,
  writeText,
  won,
} from "./lib/pipeline-utils.js";
import { cachedReadJson, cachedReadText, loadAnalysisContext } from "./lib/analysis-context.js";
import { formatMarketVoiceForPrompt } from "./lib/marketvoice-utils.js";
import { allRefinementArtifactPaths } from "./lib/refinement-rounds.js";
import { formatStockeasyForPrompt } from "./lib/stockeasy-utils.js";

function summarizeAccounts(portfolio) {
  return (portfolio?.accounts ?? [])
    .map((account) => {
      const holdings = (account.holdings ?? [])
        .map((holding) => `${holding.name}(${holding.code ?? "N/A"}) ${holding.quantity ?? "N/A"}주`)
        .join(", ");
      return `- ${account.label}(${account.key}): 평가 ${won(account.evaluationAmount)} / 예수금 ${won(account.cashAvailable)} / 보유 ${holdings || "없음"}`;
    })
    .join("\n");
}

function listAccountKeys(portfolio) {
  return (portfolio?.accounts ?? [])
    .map((account) => account.key)
    .filter(Boolean);
}

function buildTechnicalSubset(portfolio, technical, watchlist) {
  const portfolioMaps = buildPortfolioMaps(portfolio);
  const codes = new Set([
    ...portfolioMaps.holdingsByCode.keys(),
    ...(watchlist?.core_etf ?? []).map((item) => item.code),
    ...(watchlist?.satellite_etf ?? []).map((item) => item.code),
  ]);

  const scores = technical?.scores ?? {};
  return [...codes]
    .map((code) => {
      const item = scores[code];
      if (!item) return null;
      return {
        code,
        name: item.name,
        score: item.score,
        signal: item.signal,
        signal_reason: truncate(item.signal_reason ?? "", 180),
        rsi: item.rsi,
        bollinger_position: item?.bollinger?.position ?? null,
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function summarizeRefinementMaps(refinementMaps) {
  return refinementMaps.flatMap((entry) =>
    (entry?.map?.topics ?? []).slice(0, entry.round >= 3 ? 4 : 6).map((topic) => ({
      round: entry.round,
      label: entry.label,
      topic: topic.label,
      scope: topic.scope,
      reason: topic.reason,
      accountKeys: topic.accountKeys ?? [],
      keywords: (topic.keywords ?? []).slice(0, 8),
      questions: (topic.questions ?? []).slice(0, 3),
      gaps: topic.gaps ?? [],
    })),
  );
}

function summarizeRules(text) {
  return String(text ?? "")
    .split("\n")
    .filter((line) => /^[-*]\s+/.test(line.trim()))
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^(---|title:|type:|updated:|source_date:|run_date:|effective_market_date:|run_id:|generated_at:)/i.test(line))
    .filter((line) => line.length <= 140)
    .slice(0, 8);
}

function summarizeDecisionMemory(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^## \[\d{4}-\d{2}-\d{2}\]/.test(line) || /^- /.test(line));

  return lines.slice(0, 16).join("\n");
}

function summarizeRefinementResponses(refinementResponses) {
  return refinementResponses
    .filter((entry) => entry.text)
    .map((entry) => `## Round ${entry.round} · ${entry.label}\n${truncate(entry.text, 1800)}`)
    .join("\n\n");
}

function extractRichnessScore(item) {
  let score = 0;
  const primary = item?.primary_claim ?? {};

  if (primary.condition) score += 3;
  if (primary.counterpoint) score += 3;
  score += Math.min((item?.claim_candidates ?? []).length, 4) * 1.25;
  score += Math.min((item?.catalysts ?? []).length, 3) * 1.75;
  score += Math.min((item?.risks ?? []).length, 3) * 1.75;
  score += Math.min((item?.key_numbers ?? []).length, 5) * 0.5;
  score += Math.min((item?.portfolio_impacts_candidate ?? []).length, 4) * 1.4;
  score += Math.min((item?.related_holdings_in_my_portfolio ?? []).length, 4) * 1.2;
  if (item?.thesis_novelty === "HIGH") score += 3;
  if (item?.thesis_novelty === "MED") score += 1.5;
  score += Math.abs(item?.sentiment_score ?? 0) * 3.5;

  if (item?.quality?.weakClaimCount && item?.quality?.totalClaims) {
    const weakRatio = item.quality.weakClaimCount / Math.max(item.quality.totalClaims, 1);
    score -= weakRatio * 2;
  }

  return score;
}

function extractDiversityKeys(item) {
  return [
    item?.sector,
    ...(item?.themes ?? []),
    item?.report_type,
  ]
    .filter(Boolean)
    .map((entry) => String(entry));
}

function selectRichExtracts(extracts, limit) {
  const ranked = [...extracts].sort((left, right) => extractRichnessScore(right) - extractRichnessScore(left));
  const selected = [];
  const diversityCounter = new Map();

  for (const item of ranked) {
    if (selected.length >= limit) break;
    const keys = extractDiversityKeys(item);
    const repeatedCount = keys.reduce(
      (sum, key) => sum + (diversityCounter.get(key) ?? 0),
      0,
    );
    const allow =
      selected.length < Math.min(4, limit) ||
      repeatedCount <= Math.max(1, Math.floor(selected.length / 3));

    if (!allow) continue;

    selected.push(item);
    keys.forEach((key) => {
      diversityCounter.set(key, (diversityCounter.get(key) ?? 0) + 1);
    });
  }

  if (selected.length < limit) {
    for (const item of ranked) {
      if (selected.length >= limit) break;
      if (selected.includes(item)) continue;
      selected.push(item);
    }
  }

  return selected;
}

function formatExtractKeyNumbers(item, maxCount = 4) {
  return (item?.key_numbers ?? [])
    .slice(0, maxCount)
    .map((entry) => `${entry.label ?? "number"}:${truncate(entry.value ?? "", 36)}`)
    .join(" / ");
}

function formatPortfolioLinks(item, maxCount = 4) {
  return (item?.related_holdings_in_my_portfolio ?? [])
    .slice(0, maxCount)
    .map((holding) => `${holding.name}(${holding.accountKey ?? "N/A"})`)
    .join(" / ");
}

function formatPortfolioImpacts(item, maxCount = 4) {
  return (item?.portfolio_impacts_candidate ?? [])
    .slice(0, maxCount)
    .map(
      (impact) =>
        `${impact.target_name ?? impact.account_key ?? "unknown"}:${impact.direction ?? "neutral"}@${impact.strength ?? "-"}`,
    )
    .join(" / ");
}

function formatExtractEvidenceBlocks(extracts) {
  if (!extracts.length) {
    return "- 관련 extract 없음";
  }

  return extracts
    .map((item) => {
      const lines = [
        `- [${item.id}] ${truncate(item.title, 88)} / ${item.broker ?? "-"} / ${item.report_type ?? "-"} / score ${extractRichnessScore(item).toFixed(1)}`,
        `  - thesis: ${truncate(item.key_thesis ?? item.primary_claim?.summary ?? "요약 없음", 240)}`,
      ];

      const qualityBits = [
        item?.primary_claim?.classification_confidence != null
          ? `claim_conf ${Number(item.primary_claim.classification_confidence).toFixed(2)}`
          : null,
        item?.sentiment_score != null
          ? `sentiment ${item.sentiment_score >= 0 ? "+" : ""}${Number(item.sentiment_score).toFixed(2)}`
          : null,
        item?.thesis_novelty && item.thesis_novelty !== "LOW"
          ? `novelty ${item.thesis_novelty}`
          : null,
      ].filter(Boolean);
      if (qualityBits.length) {
        lines.push(`  - quality: ${qualityBits.join(" / ")}`);
      }

      const numbers = formatExtractKeyNumbers(item, 4);
      if (numbers) lines.push(`  - numbers: ${numbers}`);

      if (item?.primary_claim?.condition) {
        lines.push(`  - conditions: ${truncate(item.primary_claim.condition, 260)}`);
      }
      if (item?.primary_claim?.counterpoint) {
        lines.push(`  - counterpoints: ${truncate(item.primary_claim.counterpoint, 260)}`);
      }
      if ((item?.catalysts ?? []).length > 0) {
        lines.push(
          `  - catalysts: ${item.catalysts.slice(0, 3).map((entry) => truncate(entry, 100)).join(" / ")}`,
        );
      }
      if ((item?.risks ?? []).length > 0) {
        lines.push(
          `  - risks: ${item.risks.slice(0, 3).map((entry) => truncate(entry, 100)).join(" / ")}`,
        );
      }

      const links = formatPortfolioLinks(item, 4);
      if (links) lines.push(`  - portfolio_links: ${links}`);

      const impacts = formatPortfolioImpacts(item, 4);
      if (impacts) lines.push(`  - impact_candidates: ${impacts}`);

      return lines.join("\n");
    })
    .join("\n");
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const context = await loadAnalysisContext(args, {
    stage1: true,
    portfolio: true,
    technical: true,
    watchlist: true,
    marketVoice: true,
    richBriefing: true,
    operatingRules: true,
    decisionJournal: true,
  });
  const { paths, data } = context;
  const refinementArtifacts = allRefinementArtifactPaths({ date: args.date });
  const outputPath =
    args.output ??
    path.join(paths.manualKitDir, "08-stage2-strategy-prompt.md");

  const [refinementMapsRaw, refinementResponsesRaw] = await Promise.all([
    Promise.all(refinementArtifacts.map(async (artifact) => ({
      round: artifact.spec.round,
      label: artifact.spec.label,
      map: await cachedReadJson(context.cache, artifact.mapJson, null),
    }))),
    Promise.all(refinementArtifacts.map(async (artifact) => ({
      round: artifact.spec.round,
      label: artifact.spec.label,
      text: await cachedReadText(context.cache, artifact.response, ""),
    }))),
  ]);
  const stage1 = data.stage1;
  const portfolio = data.portfolio;
  const technical = data.technical;
  const briefing = data.richBriefing;
  const watchlist = data.watchlist;
  const marketVoice = data.marketVoice;
  const operatingRules = data.operatingRules;
  const decisionJournal = data.decisionJournal;

  const directExtracts = selectRichExtracts(
    stage1.extracts.filter(
      (item) =>
        item.related_holdings_in_my_portfolio.length > 0 ||
        item.portfolio_impacts_candidate.length > 0,
    ),
    14,
  );
  const macroExtracts = selectRichExtracts(
    stage1.extracts.filter((item) => item.report_type === "macro"),
    4,
  );
  // 현재 보유와 무관한 신규 후보 발굴용 extract (비보유 종목 리포트 중 richness 상위)
  const newCandidateExtracts = selectRichExtracts(
    stage1.extracts.filter(
      (item) =>
        item.related_holdings_in_my_portfolio.length === 0 &&
        item.portfolio_impacts_candidate.length === 0 &&
        item.report_type !== "macro",
    ),
    6,
  );
  const technicalSubset = buildTechnicalSubset(portfolio, technical, watchlist);
  const briefingSummary = truncate(briefing, 3600);
  const refinementMaps = refinementMapsRaw.filter((entry) => entry.map);
  const refinementResponses = refinementResponsesRaw
    .map((entry) => ({ ...entry, text: String(entry.text ?? "").trim() }))
    .filter((entry) => entry.text);
  const followUpResearchSummary = JSON.stringify(summarizeRefinementMaps(refinementMaps), null, 2);
  const followUpDeepResearchSummary = summarizeRefinementResponses(refinementResponses);
  const operatingRuleSummary = summarizeRules(operatingRules).join("\n");
  const decisionMemorySummary = summarizeDecisionMemory(decisionJournal);
  const accountKeys = listAccountKeys(portfolio);
  const accountKeyHint = accountKeys.length > 0 ? accountKeys.join("|") : "ACCOUNT_KEY";
  const stockeasySummary = await formatStockeasyForPrompt({
    date: args.date,
    portfolio,
    watchlist,
  });

  const prompt = [
    "# EcoReport Stage 2 Strategy Exploration",
    "",
    `실행일은 ${args.runDate}, 기준 거래일은 ${args.effectiveMarketDate} 입니다.`,
    `오늘 날짜는 ${args.date} 입니다.`,
    "당신은 내 포트폴리오를 실제로 운용하는 전략 탐색 LLM입니다.",
    "아래 Stage 1 연구 노트, 계좌 상태, 기술점수를 바탕으로 새로운 투자 전략 옵션을 설계하세요.",
    "일반론보다 실제 운용 가능한 계좌별 대안을 제시하세요.",
    "",
    "## 내 현재 계좌",
    summarizeAccounts(portfolio),
    "",
    "## 시장/섹터 브리핑",
    briefingSummary || "- rich briefing 없음",
    "",
    "## 머니토링 실시간 시황 레이어",
    formatMarketVoiceForPrompt(marketVoice, {
      maxTopics: 6,
      maxResearch: 3,
    }),
    "",
    "## StockEasy 외부 강세 / 전략실 레이어",
    stockeasySummary,
    "",
    "## 다회 refinement 재인덱싱 메모",
    followUpResearchSummary || "- follow-up research map 없음",
    "",
    "## 다회 Deep Research 보강",
    followUpDeepResearchSummary || "- 2차 Deep Research 응답 없음",
    "",
    "## 운영 룰 / 금지사항",
    operatingRuleSummary || "- 운영 룰 위키 없음",
    "",
    "## 최근 의사결정 메모리",
    decisionMemorySummary || "- 누적 의사결정 메모리 없음",
    "",
    "## 직접 관련 리포트 연구 노트",
    formatExtractEvidenceBlocks(directExtracts),
    "",
    "## 매크로/전략 리포트 연구 노트",
    formatExtractEvidenceBlocks(macroExtracts),
    "",
    "## 신규 후보 발굴용 리포트 (현재 비보유 종목)",
    "아래는 현재 포트폴리오에 없지만 리포트 richness가 높은 종목들입니다. 신규 진입 후보 탐색에 활용하세요.",
    formatExtractEvidenceBlocks(newCandidateExtracts),
    "",
    "## 기술점수 스냅샷",
    JSON.stringify(
      {
        market_context: technical?.market_context ?? {},
        relevant_scores: technicalSubset,
      },
      null,
      2,
    ),
    "",
    "## 인사이트 합성 지침",
    "단순 요약보다 분석적 합성을 우선하세요.",
    "- 같은 테마에 대해 리포트 간 시간 전망이나 방향이 어긋나면 그 충돌을 먼저 식별하세요.",
    "- condition이 있는 주장은 실현 가능성을 HIGH/MEDIUM/LOW로 가늠하고, LOW는 바로 실행보다 risk/watch로 남기세요.",
    "- 직접 언급이 없더라도 보유 종목과 연결되는 2차 효과가 있다면 제시하되, confidence는 보수적으로 유지하세요.",
    "- 각 전략 변화와 후보에는 판단을 뒤집을 수 있는 반전 조건을 한 줄 포함하세요.",
    "- **필수: candidate_scores에 현재 보유 종목 외 신규 후보를 최소 3개 이상 포함하세요. '신규 후보 발굴용 리포트' 섹션을 적극 참고하고, Deep Research 보강 응답에서 언급된 대안 자산도 포함하세요.**",
    "- 신규 후보는 기존 보유와 겹치지 않는 섹터·테마에서 최소 1개 이상 발굴하세요.",
    "",
    "## 출력 요구사항",
    "반드시 유효한 JSON으로만 답하세요.",
    "문장은 짧게, 각 문자열은 1~2문장 이내로 유지하세요.",
    "strategy_changes는 최대 4개, candidate_scores는 최대 8개까지만 반환하세요.",
    "buy_candidates / trim_candidates / hold_candidates는 각 계좌당 최대 3개까지만 반환하세요.",
    "중요: Stage 2는 테마 논리 단계입니다. 이 단계에서 ETF/주식의 숫자 코드(예: 360750, 005930)를 직접 추천하지 마세요.",
    "candidate_scores.code는 반드시 THEME::<slug> 형식으로 작성하세요. 예: THEME::ai-power-grid, THEME::defense-nuclear.",
    "account_actions의 buy_candidates / trim_candidates / hold_candidates도 동일하게 THEME::<slug>만 사용하세요.",
    "실제 ETF 코드 매핑은 Stage 2.5에서 수행됩니다.",
    "refinement map에서 반복 확인이 필요한 토픽은 실제 전략 변화로 연결되는 경우만 반영하고, 근거가 얕으면 watch 또는 보류로 남기세요.",
    "머니토링 시황은 빠른 촉매 신호로만 사용하세요. 리포트·딥리서치와 충돌하면 강화보다 watch 또는 검증 우선으로 낮추세요.",
    "StockEasy는 외부 모멘텀과 전략실 기류를 확인하는 보조 레이어입니다. 내부 논리와 겹치면 설명과 우선순위를 강화하고, 충돌하면 즉시 추격 매수로 번역하지 마세요.",
    "계좌 역할과 맞지 않는 공격적 제안, 무효화 조건 없는 제안, 메타 표현(stage2 근거 등)은 쓰지 마세요.",
    "",
    JSON.stringify(
      {
        date: args.date,
        macro_view: {
          regime: "BULL|SIDEWAYS|BEAR|HIGH_VOL",
          confidence: "HIGH|MEDIUM|LOW",
          summary: "시장 레짐 요약",
        },
        strategy_changes: [
          {
            theme: "예: AI 인프라",
            direction: "reinforce|reduce|watch",
            why_now: "왜 지금 중요한지 | 반전 조건: ...",
            source_reports: ["report_012"],
            conflicting_reports: ["report_005"],
            condition_probability: "HIGH|MEDIUM|LOW",
          },
        ],
        account_actions: [
          {
            account_key: accountKeyHint,
            bias: "aggressive_add|selective_add|hold|defensive",
            rationale: "계좌 운용 핵심 논리",
            buy_candidates: ["THEME::ai-power-grid"],
            trim_candidates: ["THEME::gold-hedge"],
            hold_candidates: ["THEME::us-core-riskon"],
            reserve_cash_note: "현금 운영 원칙",
          },
        ],
        candidate_scores: [
          {
            code: "THEME::us-core-riskon",
            name: "미국 코어 위험선호",
            stance: "buy|hold|trim|watch",
            target_accounts: [accountKeys[0] ?? "ACCOUNT_KEY"],
            horizon: "1m|3m|6m",
            confidence: "HIGH|MEDIUM|LOW",
            thesis: "테마/논리 핵심",
            risks: ["위험요인"],
            impact_chain: "direct|thematic_2nd_order",
            invalidation_trigger: "이 판단을 뒤집는 조건",
          },
        ],
        portfolio_risks: ["핵심 위험 1", "핵심 위험 2"],
      },
      null,
      2,
    ),
  ].join("\n");

  await writeText(outputPath, `${prompt}\n`);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`stage2 strategy prompt 생성 실패: ${error.message}`);
  process.exit(1);
});
