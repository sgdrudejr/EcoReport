#!/usr/bin/env node
// Stage 1.7 / 1.8: 다회 정제 라운드용 Gemini refinement prompt를 생성합니다.

import path from "node:path";

import {
  ROOT_DIR,
  readJson,
  readText,
  truncate,
  writeText,
} from "./lib/pipeline-utils.js";
import { formatMarketVoiceForPrompt } from "./lib/marketvoice-utils.js";
import { formatStockeasyForPrompt } from "./lib/stockeasy-utils.js";
import {
  parseRefinementArgs,
  previousRefinementRound,
  refinementArtifactPaths,
  refinementRoundSpec,
} from "./lib/refinement-rounds.js";

function compact(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripFrontmatter(text) {
  return String(text ?? "").replace(/^---[\s\S]*?---\n?/, "").trim();
}

function summarizeTopics(refinementMap) {
  return (refinementMap?.topics ?? []).map((topic) => ({
    label: topic.label,
    scope: topic.scope,
    priority: topic.priority,
    reason: topic.reason,
    accountKeys: topic.accountKeys ?? [],
    targetCodes: topic.targetCodes ?? [],
    keywords: (topic.keywords ?? []).slice(0, 8),
    questions: (topic.questions ?? []).slice(0, 3),
    gaps: topic.gaps ?? [],
    evidence: (topic.evidence ?? []).slice(0, 3).map((item) => ({
      title: item.title,
      broker: item.broker,
      matchedKeywords: item.matchedKeywords,
      excerpt: item.excerpt,
    })),
  }));
}

function summarizeRules(rulesText, refinementMap) {
  const ruleLines = stripFrontmatter(rulesText)
    .split("\n")
    .filter((line) => /^[-*]\s+/.test(line.trim()))
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^(title|type|updated|source_date|run_date|effective_market_date|run_id|generated_at):/i.test(line))
    .filter((line) => line.length <= 140)
    .slice(0, 8);

  return [...new Set([...(refinementMap?.lessons?.avoid ?? []), ...ruleLines])].slice(0, 10);
}

function summarizeStage4(stage4) {
  return (stage4?.accountPlans ?? []).map((plan) => ({
    accountKey: plan.key,
    label: plan.label,
    totalScore: plan.totalScore ?? null,
    topGap: plan?.topGap?.category ?? null,
    stagedBuys: (plan.stagedBuys ?? []).slice(0, 2).map((item) => ({
      name: item.name,
      code: item.code,
      reason: item.reason,
      amount: item.suggestedAmount ?? null,
    })),
    trims: (plan.trims ?? []).slice(0, 2).map((item) => ({
      name: item.name,
      code: item.code,
      reason: item.reason,
    })),
    holds: (plan.holds ?? []).slice(0, 2).map((item) => ({
      name: item.name,
      code: item.code,
      reason: item.reason,
    })),
  }));
}

function roundInstructions(spec) {
  if (spec.round >= 3) {
    return {
      intro: [
        "이번 질문은 3차 세부화 단계다.",
        "이미 1차/2차 연구에서 살아남은 토픽만 다시 다루며, 새로운 전반론을 펼치지 않는다.",
        "핵심 목표는 실행 조건, 무효화 조건, 대체재, 헤지 관계를 마지막으로 선명하게 만드는 것이다.",
      ],
      outputRules: [
        "- 각 토픽마다 지금 살아남은 thesis를 2문장 이내로 다시 정의할 것",
        "- 매수/보유/축소 판단을 실제로 바꾸는 이벤트 또는 가격 구조를 반드시 적을 것",
        "- 틀릴 때의 무효화 조건과 대체재를 반드시 같이 적을 것",
        "- 마지막 라운드에서 새 테마 추천을 억지로 만들지 말 것",
      ],
      format: [
        "## Round 3 Final Extraction",
        "### [토픽명]",
        "- 지금 살아남은 핵심 논리",
        "- 지금 바로 실행하지 않는다면 무엇을 기다려야 하는가",
        "- 무효화 조건",
        "- 대체재 / 헤지 관계",
        "",
        "## Account Translation",
        "- ISA / PENSION / KIS_MAIN 각각",
        "- 이 토픽이 그 계좌에서 어떤 역할인지",
        "- 늘릴 자산 / 줄일 자산 / 대체할 자산",
        "",
        "## Exact Triggers",
        "- 1~2주 체크포인트",
        "- 1~3개월 체크포인트",
        "",
        "## No-Go / Replace",
        "- 지금 사지 말아야 하는 조건",
        "- 대신 봐야 하는 대체재",
      ],
    };
  }

  return {
    intro: [
      "이번 질문은 1차 딥리서치 결과를 반복 요약하는 단계가 아니라, 1차 답변에서 남은 빈틈을 메우는 정밀 follow-up 단계다.",
      "전반론 반복을 금지하고, 실제 계좌 운용에서 모호했던 부분만 좁고 깊게 확인한다.",
      "특히 '왜 지금', '무엇을 보면 판단을 바꿀지', '어떤 경우에는 사지 말아야 하는지'를 더 선명하게 만든다.",
    ],
    outputRules: [
      "- 각 토픽마다 4개 소제목을 모두 채울 것",
      "- 리포트나 시장 evidence가 얕으면 그 사실을 분명히 쓸 것",
      "- 계좌 관점 번역이 반드시 있어야 하며, 한국 상장 ETF/국내 계좌 실행 언어로 정리할 것",
    ],
    format: [
      "## Round 2 Research Corrections",
      "### [토픽명]",
      "- 무엇이 1차 답변에서 아직 모호했는가",
      "- 지금 추가로 확인된 핵심 사실",
      "- 실제 계좌 운용에서 의미하는 바",
      "- 무엇을 보면 판단을 바꿔야 하는가",
      "",
      "## Account-Level Refinement",
      "- ISA / PENSION / KIS_MAIN 각각",
      "- 현재 토픽이 그 계좌에서 왜 중요한지",
      "- 늘릴 자산 / 줄일 자산 / 보류 자산",
      "",
      "## No-Go / Wait",
      "- 지금 사지 말아야 하는 조건",
      "- 지금 줄이지 말아야 하는 조건",
      "- 다음 확인 전까지 관망해야 하는 포인트",
      "",
      "## Exact Checkpoints",
      "- 이벤트 / 데이터 / 가격 구조 / 실적 / 정책 중 무엇을 체크할지",
      "- 가능하면 1~2주, 1~3개월로 구분",
    ],
  };
}

async function main() {
  const args = parseRefinementArgs(process.argv.slice(2));
  const spec = refinementRoundSpec(args.round);
  const paths = refinementArtifactPaths({ date: args.date, round: args.round });
  const priorRound = previousRefinementRound(args.round);
  const priorPaths = priorRound
    ? refinementArtifactPaths({ date: args.date, round: priorRound })
    : null;
  const stage4Path = path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage4-execution-plan.json");
  const primaryDeepResearchPath = path.join(
    paths.manualKitDir,
    "09-stage1-5-gemini-deep-research-response.md",
  );
  const richBriefingPath = path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-gemini-briefing-rich.md`);
  const operatingRulesPath = path.join(ROOT_DIR, "knowledge", "wiki", "memory", "operating-rules.md");
  const researchBacklogPath = path.join(ROOT_DIR, "knowledge", "wiki", "memory", "research-backlog.md");
  const decisionJournalPath = path.join(ROOT_DIR, "knowledge", "wiki", "memory", "decision-journal.md");
  const marketVoicePath = path.join(ROOT_DIR, "data", "analysis-state", args.date, "marketvoice-linked.json");
  const portfolioPath = path.join(ROOT_DIR, "data", "portfolio", "latest.json");
  const watchlistPath = path.join(ROOT_DIR, "config", "watchlist.json");
  const outputPath = args.output
    ? path.isAbsolute(args.output)
      ? args.output
      : path.join(ROOT_DIR, args.output)
    : paths.prompt;

  const [
    refinementMap,
    primaryDeepResearch,
    richBriefing,
    priorResponse,
    operatingRules,
    researchBacklog,
    decisionJournal,
    stage4,
    marketVoice,
    portfolio,
    watchlist,
  ] = await Promise.all([
    readJson(paths.mapJson, null),
    readText(primaryDeepResearchPath, ""),
    readText(richBriefingPath, ""),
    priorPaths ? readText(priorPaths.response, "") : "",
    readText(operatingRulesPath, ""),
    readText(researchBacklogPath, ""),
    readText(decisionJournalPath, ""),
    readJson(stage4Path, null),
    readJson(marketVoicePath, null),
    readJson(portfolioPath, { accounts: [] }),
    readJson(watchlistPath, {}),
  ]);

  if (!refinementMap) {
    throw new Error(`refinement map이 없습니다: ${paths.mapJson}`);
  }

  const topicSummary = summarizeTopics(refinementMap);
  const noGoRules = summarizeRules(operatingRules, refinementMap);
  const stage4Summary = summarizeStage4(stage4);
  const instructions = roundInstructions(spec);
  const stockeasySummary = await formatStockeasyForPrompt({
    date: args.date,
    portfolio,
    watchlist,
  });

  const prompt = [
    `너는 EcoReport의 ${spec.label} Deep Research 파트너다.`,
    ...instructions.intro,
    "",
    `[날짜] ${args.date}`,
    `[라운드] ${spec.round}`,
    `[목적] ${spec.purpose}`,
    "",
    "[절대 하지 말 것]",
    ...noGoRules.map((item) => `- ${item}`),
    "- `stage2 근거`, `시스템상`, `모델상` 같은 메타 표현 사용 금지",
    "- 리포트 근거가 얕은 종목을 확신형 문장으로 포장 금지",
    "- 보유/관망 사유를 말줄임표나 한 줄 결론으로 끝내기 금지",
    "",
    "[1차 Deep Research 요약 일부]",
    truncate(primaryDeepResearch, 7000) || "- 1차 Deep Research 응답 없음",
    "",
    priorResponse
      ? `[직전 정제 라운드 응답 일부]\n${truncate(priorResponse, 5000)}`
      : "[직전 정제 라운드 응답 일부]\n- 직전 refinement 응답 없음",
    "",
    "[현재 rich briefing 일부]",
    truncate(richBriefing, 4500) || "- rich briefing 없음",
    "",
    "[실시간 머니토링 이벤트 레이어]",
    formatMarketVoiceForPrompt(marketVoice, {
      maxTopics: 4,
      maxResearch: 2,
    }),
    "",
    "[StockEasy 외부 강세 / 전략실 레이어]",
    stockeasySummary,
    "",
    "[현재 Stage 4 실행 계획 요약]",
    JSON.stringify(stage4Summary, null, 2),
    "",
    "[위키 메모리: research backlog 일부]",
    truncate(stripFrontmatter(researchBacklog), 2500) || "- research backlog 없음",
    "",
    "[위키 메모리: decision journal 일부]",
    truncate(stripFrontmatter(decisionJournal), 2500) || "- decision journal 없음",
    "",
    "[이번 라운드에서 다시 봐야 할 우선순위 토픽]",
    JSON.stringify(topicSummary, null, 2),
    "",
    "[출력 규칙]",
    ...instructions.outputRules,
    "- StockEasy 신호는 외부 risk-on/risk-off 확인과 한국 상장 ETF 번역 힌트로 적극 활용하되, 내부 리포트·딥리서치와 충돌하면 검증 우선으로 다룰 것",
    "",
    ...instructions.format,
    "",
    spec.round >= 3
      ? "중요: 이번 답변은 최종 정리 직전의 마지막 세부화 문서다. 새 일반론을 늘리지 말고, 위 토픽에 대해 실행 디테일과 무효화 조건만 더 선명하게 만든다."
      : "중요: 이번 답변은 전체 시장 브리핑을 다시 쓰는 문서가 아니다. 위 토픽 리스트에 대해서만 깊이를 추가하는 2차 정밀 보강 문서다.",
  ].join("\n");

  await writeText(outputPath, `${prompt}\n`);
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`refinement Gemini prompt 생성 실패: ${error.message}`);
  process.exit(1);
});
