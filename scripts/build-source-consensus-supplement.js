#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  parseDateArgs,
  readJson,
  resolveSecurityCodeFromCandidates,
  writeJson,
  writeText,
} from "./lib/pipeline-utils.js";

const NEW_SOURCES = ["technical", "kis_etf", "news"];
const SOURCE_LABELS = {
  reports: "리포트",
  stockeasy: "StockEasy",
  marketvoice: "MarketVoice",
  technical: "기술지표",
  kis_etf: "KIS ETF",
  news: "뉴스",
  macro: "매크로",
  llm: "LLM",
};

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function round(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function sourceValue(item, source) {
  return Number(item?.support?.[source] ?? 0) || 0;
}

function hasNewSourceSupport(item) {
  return NEW_SOURCES.some((source) => sourceValue(item, source) > 0);
}

function newSourceSupportScore(item) {
  return NEW_SOURCES.reduce((sum, source) => sum + sourceValue(item, source), 0);
}

function existingSourceSupportScore(item) {
  return Object.entries(item?.support ?? {})
    .filter(([source]) => !NEW_SOURCES.includes(source))
    .reduce((sum, [, value]) => sum + (Number(value) || 0), 0);
}

function formatSupport(support) {
  const parts = Object.entries(support ?? {})
    .filter(([, value]) => Number(value) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .map(([source, value]) => `${SOURCE_LABELS[source] ?? source} ${round(value, 2)}`);
  return parts.length > 0 ? parts.join(" / ") : "근거 약함";
}

function supplementLabel(item) {
  const net = Number(item?.netScore ?? 0);
  const hasExisting = existingSourceSupportScore(item) > 0;
  if (!hasExisting) return net >= 0 ? "신규관찰" : "단독경계";
  if (net >= 0.35) return "강화확인";
  if (net >= 0.15) return "보완확인";
  if (net <= -0.15) return "감속점검";
  return "중립확인";
}

function actionHint(item) {
  const label = supplementLabel(item);
  if (label === "강화확인") return "기존 긍정 근거에 새 보강 소스가 붙은 항목입니다. 단, 실행은 Stage4 금액/계좌 제한을 유지합니다.";
  if (label === "보완확인") return "기존 판단을 보강하지만 단독 매수 근거로 쓰기에는 아직 약합니다.";
  if (label === "감속점검") return "기존 아이디어와 새 소스가 약하거나 엇갈립니다. 추격보다 조건 확인이 우선입니다.";
  if (label === "신규관찰") return "새 소스에서만 떠오른 후보입니다. 리포트/공시/계좌 적합성 확인 전까지 관찰 전용입니다.";
  if (label === "단독경계") return "새 소스 단독 부정 신호입니다. 기존 보유/실행 판단을 바로 바꾸지 말고 충돌 근거를 확인합니다.";
  return "판단 유지, 보조 근거로만 사용합니다.";
}

function normalizeActionBucket(bucket) {
  if (bucket === "stagedBuys") return "매수";
  if (bucket === "trims") return "축소";
  if (bucket === "holds") return "보유";
  if (bucket === "watches") return "관찰";
  if (bucket === "stage2Candidates") return "후보";
  return bucket;
}

function buildStage4Lookup(stage4) {
  const byCode = new Map();
  for (const plan of stage4?.accountPlans ?? []) {
    for (const bucket of ["stagedBuys", "trims", "holds", "watches", "stage2Candidates"]) {
      for (const item of plan?.[bucket] ?? []) {
        const code = resolveSecurityCodeFromCandidates(item?.code, item?.name);
        if (!code) continue;
        const current = byCode.get(code) ?? [];
        current.push({
          accountKey: plan.key,
          accountLabel: plan.label ?? plan.key,
          bucket: normalizeActionBucket(bucket),
          reason: item.reason ?? item.rationale ?? item.entryCondition ?? null,
        });
        byCode.set(code, current);
      }
    }
  }
  return byCode;
}

function buildHoldingCardLookup(holdingCards) {
  const byCode = new Map();
  for (const card of holdingCards?.cards ?? []) {
    const code = resolveSecurityCodeFromCandidates(card?.code, card?.name);
    if (!code) continue;
    const current = byCode.get(code) ?? [];
    current.push({
      accountKey: card.accountKey ?? null,
      decisionLabel: card.decisionLabel ?? card.decisionBucket ?? null,
      reportCoverage: card.reportCoverage?.statusLabel ?? null,
      externalCoverage: card.externalCoverage?.statusLabel ?? null,
    });
    byCode.set(code, current);
  }
  return byCode;
}

function pickSecuritySupplements(features, stage4ByCode, cardsByCode) {
  return (features?.securityFeatures ?? [])
    .filter(hasNewSourceSupport)
    .map((item) => ({
      code: item.code,
      name: item.name,
      netScore: round(item.netScore),
      sourceCount: item.sourceCount ?? 0,
      newSourceSupport: round(newSourceSupportScore(item)),
      existingSourceSupport: round(existingSourceSupportScore(item)),
      label: supplementLabel(item),
      support: item.support,
      supportSummary: formatSupport(item.support),
      stage4: stage4ByCode.get(item.code) ?? [],
      holdingCards: cardsByCode.get(item.code) ?? [],
      actionHint: actionHint(item),
    }))
    .sort(
      (left, right) =>
        right.existingSourceSupport - left.existingSourceSupport ||
        right.newSourceSupport - left.newSourceSupport ||
        right.netScore - left.netScore,
    );
}

function pickThemeSupplements(features) {
  return (features?.themeFeatures ?? [])
    .filter((item) => hasNewSourceSupport(item) && (item.sourceCount ?? 0) >= 2)
    .map((item) => ({
      theme: item.theme,
      netScore: round(item.netScore),
      sourceCount: item.sourceCount ?? 0,
      newSourceSupport: round(newSourceSupportScore(item)),
      existingSourceSupport: round(existingSourceSupportScore(item)),
      label: supplementLabel(item),
      support: item.support,
      supportSummary: formatSupport(item.support),
      actionHint: actionHint(item),
    }))
    .sort(
      (left, right) =>
        right.sourceCount - left.sourceCount ||
        right.netScore - left.netScore ||
        right.newSourceSupport - left.newSourceSupport,
    );
}

function pickConflicts(sourceDivergence) {
  return (sourceDivergence?.divergence?.sourceConflicts ?? [])
    .filter((item) => (item.sources ?? []).some((source) => NEW_SOURCES.includes(source)))
    .map((item) => ({
      entityType: item.entityType,
      entityId: item.entityId,
      directions: item.directions ?? [],
      sources: item.sources ?? [],
      sourceSummary: (item.sources ?? []).map((source) => SOURCE_LABELS[source] ?? source).join(" / "),
    }))
    .slice(0, 30);
}

function markdownTable(rows, columns) {
  if (rows.length === 0) return ["- 없음"];
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) =>
      `| ${columns
        .map((column) =>
          compactText(column.value(row))
            .replace(/\|/g, "/")
            .replace(/\n/g, " "),
        )
        .join(" | ")} |`,
  );
  return [header, divider, ...body];
}

function buildMarkdown(payload) {
  const topThemes = payload.themeSupplements.slice(0, 12);
  const reinforced = payload.securitySupplements.filter((item) => item.existingSourceSupport > 0).slice(0, 12);
  const newOnly = payload.securitySupplements
    .filter((item) => item.existingSourceSupport === 0)
    .slice(0, 12);
  const conflicts = payload.newSourceConflicts.slice(0, 12);

  return [
    `# 2026-05-04 새 보강 소스 보완 리포트`,
    "",
    `- 기준일: ${payload.date}`,
    `- 새 보강 소스: 기술지표, KIS ETF${payload.sourceCoverage.news ? ", 뉴스" : ""}`,
    `- 정규화 관측치: 기술 ${payload.sourceCoverage.technical}건 / KIS ETF ${payload.sourceCoverage.kisEtf}건 / 뉴스 ${payload.sourceCoverage.news}건`,
    `- 보완 종목: ${payload.securitySupplements.length}개`,
    `- 보완 테마: ${payload.themeSupplements.length}개`,
    `- 새 소스 포함 충돌: ${payload.newSourceConflicts.length}개`,
    "",
    "## 1. 새롭게 강화된 테마",
    ...markdownTable(topThemes, [
      { label: "판정", value: (row) => row.label },
      { label: "테마", value: (row) => row.theme },
      { label: "점수", value: (row) => row.netScore },
      { label: "소스", value: (row) => row.supportSummary },
      { label: "보완 해석", value: (row) => row.actionHint },
    ]),
    "",
    "## 2. 기존 판단을 보강한 종목",
    ...markdownTable(reinforced, [
      { label: "판정", value: (row) => row.label },
      { label: "종목", value: (row) => `${row.name}(${row.code})` },
      { label: "점수", value: (row) => row.netScore },
      { label: "소스", value: (row) => row.supportSummary },
      {
        label: "현재 Stage4",
        value: (row) =>
          row.stage4.length > 0
            ? row.stage4.map((item) => `${item.accountLabel}:${item.bucket}`).join(", ")
            : "Stage4 직접 액션 없음",
      },
      { label: "보완 해석", value: (row) => row.actionHint },
    ]),
    "",
    "## 3. 새 소스 단독으로 떠오른 관찰 후보",
    ...markdownTable(newOnly, [
      { label: "판정", value: (row) => row.label },
      { label: "종목", value: (row) => `${row.name}(${row.code})` },
      { label: "점수", value: (row) => row.netScore },
      { label: "소스", value: (row) => row.supportSummary },
      { label: "보완 해석", value: (row) => row.actionHint },
    ]),
    "",
    "## 4. 새 소스가 만든 충돌 체크",
    ...markdownTable(conflicts, [
      { label: "대상", value: (row) => `${row.entityType}:${row.entityId}` },
      { label: "방향", value: (row) => row.directions.join(", ") },
      { label: "소스", value: (row) => row.sourceSummary },
      { label: "처리", value: () => "다음 실행 전 리포트 원문/기술지표/KIS ETF 순위를 함께 확인" },
    ]),
    "",
    "## 5. 적용 원칙",
    "- 이 보완 리포트는 기존 2026-05-04 Stage4 실행안을 대체하지 않습니다.",
    "- `강화확인`과 `보완확인`은 기존 판단의 신뢰도를 올리는 보조 근거입니다.",
    "- `신규관찰`은 KIS ETF/기술지표 단독 후보이므로 리포트·공시·계좌 적합성 확인 전 매수 근거로 쓰지 않습니다.",
    "- 충돌 항목은 추격 매수보다 조건 확인과 분할/보류 판단에 우선 반영합니다.",
    "",
  ].join("\n");
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const featureDir = path.join(ROOT_DIR, "data", "features", args.date);
  const normalizedDir = path.join(ROOT_DIR, "data", "normalized", args.date);
  const [features, sourceDivergence, stage4, holdingCards, technical, kisEtf, news] = await Promise.all([
    readJson(path.join(featureDir, "decision-features.json"), null),
    readJson(path.join(featureDir, "source-divergence.json"), null),
    readJson(path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage4-execution-plan.json"), null),
    readJson(path.join(ROOT_DIR, "data", "analysis-state", args.date, "holding-decision-cards.json"), null),
    readJson(path.join(normalizedDir, "technical.normalized.json"), null),
    readJson(path.join(normalizedDir, "kis_etf.normalized.json"), null),
    readJson(path.join(normalizedDir, "news.normalized.json"), null),
  ]);

  if (!features) {
    throw new Error(`decision-features.json이 없습니다: ${path.join(featureDir, "decision-features.json")}`);
  }

  const stage4ByCode = buildStage4Lookup(stage4);
  const cardsByCode = buildHoldingCardLookup(holdingCards);
  const payload = {
    date: args.date,
    generatedAt: new Date().toISOString(),
    sourceCoverage: {
      technical: technical?.observations?.length ?? 0,
      kisEtf: kisEtf?.observations?.length ?? 0,
      news: news?.observations?.length ?? 0,
    },
    themeSupplements: pickThemeSupplements(features),
    securitySupplements: pickSecuritySupplements(features, stage4ByCode, cardsByCode),
    newSourceConflicts: pickConflicts(sourceDivergence),
  };

  const jsonPath = path.join(featureDir, "source-consensus-supplement.json");
  const markdownPath = path.join(ROOT_DIR, "reports", "daily", `${args.date}-source-consensus-supplement.md`);
  await writeJson(jsonPath, payload);
  await writeText(markdownPath, `${buildMarkdown(payload)}\n`);
  console.log(jsonPath);
  console.log(markdownPath);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
