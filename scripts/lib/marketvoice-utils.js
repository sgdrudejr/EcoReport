import path from "node:path";

import { ROOT_DIR, readJson } from "./pipeline-utils.js";

function compactText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(items) {
  return [...new Set((items ?? []).map((item) => compactText(item)).filter(Boolean))];
}

function directionLabel(direction) {
  if (direction === "positive") return "호재";
  if (direction === "negative") return "경계";
  if (direction === "mixed") return "혼합";
  return "중립";
}

function topicConnectionLabel(topic) {
  const direct = (topic?.portfolioMatches?.directHoldings ?? []).map(
    (item) => `${item.accountLabel ?? item.accountKey}:${item.name ?? item.code}`,
  );
  const thematic = (topic?.portfolioMatches?.thematicAccounts ?? []).map(
    (item) => `${item.accountLabel ?? item.accountKey}:${item.category}`,
  );
  const watchlist = (topic?.portfolioMatches?.watchlist ?? []).map(
    (item) => item.name ?? item.code,
  );

  return uniqueStrings([
    direct.length > 0 ? `직접 ${direct.join(", ")}` : null,
    thematic.length > 0 ? `테마 ${thematic.join(", ")}` : null,
    watchlist.length > 0 ? `관심 ${watchlist.join(", ")}` : null,
  ]).join(" / ");
}

export function buildMarketVoicePaths(date, rootDir = ROOT_DIR) {
  return {
    jsonPath: path.join(rootDir, "data", "analysis-state", date, "marketvoice-linked.json"),
    markdownPath: path.join(rootDir, "knowledge", "daily", `${date}-marketvoice.md`),
  };
}

export async function readMarketVoiceArtifact(date, fallback = null, rootDir = ROOT_DIR) {
  const { jsonPath } = buildMarketVoicePaths(date, rootDir);
  return readJson(jsonPath, fallback);
}

export function formatMarketVoiceForPrompt(artifact, options = {}) {
  const maxTopics = Number.isFinite(options.maxTopics) ? options.maxTopics : 5;
  const maxResearch = Number.isFinite(options.maxResearch) ? options.maxResearch : 3;
  const topics = Array.isArray(artifact?.topics) ? artifact.topics : [];
  const prioritizedTopics = topics.filter((topic) => (topic?.relevanceScore ?? 0) >= 35);
  const selectedTopics =
    prioritizedTopics.length > 0 ? prioritizedTopics.slice(0, maxTopics) : topics.slice(0, maxTopics);

  const lines = [];
  lines.push(`- 요약: ${artifact?.summary?.overview ?? "머니토링 시황 요약 없음"}`);

  if (selectedTopics.length === 0) {
    lines.push("- 포트폴리오에 직접 연결된 머니토링 이슈가 아직 없습니다.");
  } else {
    for (const topic of selectedTopics) {
      const linkages = topicConnectionLabel(topic);
      const linkageText = linkages ? ` / 연결: ${linkages}` : "";
      const linkageSummary = compactText(topic?.portfolioLinkage);
      const summaryText = linkageSummary || compactText(topic?.summary) || "요약 없음";
      const sourceCount = topic?.topicDocumentSize ?? topic?.quoteCount ?? 0;
      lines.push(
        `- [${topic?.relevanceScore ?? 0}점 · ${directionLabel(topic?.signalDirection)}] ${compactText(topic?.title) || "제목 없음"}${linkageText} / ${summaryText} / 소스 ${sourceCount}건`,
      );
    }
  }

  const deepResearchCandidates = Array.isArray(artifact?.deepResearchCandidates)
    ? artifact.deepResearchCandidates.slice(0, maxResearch)
    : [];

  if (deepResearchCandidates.length > 0) {
    lines.push("- 딥리서치 후보");
    for (const item of deepResearchCandidates) {
      lines.push(
        `  - ${compactText(item?.title) || "주제 없음"} / 이유: ${compactText(item?.reason) || "추가 검증 필요"} / 확인질문: ${compactText(item?.question) || "질문 없음"}`,
      );
    }
  }

  return lines.join("\n");
}
