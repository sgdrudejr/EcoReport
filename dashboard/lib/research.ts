import path from "path";
import {
  listRepoFiles,
  readRepoJsonFile,
  readRepoTextFile,
} from "@/lib/repo-artifacts";
import { resolveRepoRoot } from "@/lib/repo-root";
import { normalizeArtifactDateContext } from "@/lib/trading-calendar";

const KNOWLEDGE_DAILY_DIR = "knowledge/daily";
const MARKET_DIR = "data/market";
const TECHNICAL_DIR = "data/technical";
const REPO_ROOT = resolveRepoRoot();

interface ResearchBriefingSourcePaths {
  stage1?: string | null;
  portfolio?: string | null;
  prior_briefing?: string | null;
  deep_research?: string | null;
  archive_output?: string | null;
}

export interface ResearchBriefingMeta {
  model?: string | null;
  used_chunk_count?: number | null;
  covered_report_count?: number | null;
  summary_chunk_count?: number | null;
  candidate_chunk_count?: number | null;
  briefing_candidate_count?: number | null;
  merged_text_length?: number | null;
  selected_chunk_count?: number | null;
  selected_report_count?: number | null;
  merged_text_char_length?: number | null;
  run_date?: string | null;
  effective_market_date?: string | null;
  workflow?: string | null;
  stage1_report_count?: number | null;
  selected_extract_budget?: number | null;
  selected_extract_count?: number | null;
  prompt_char_length?: number | null;
  deep_research_char_length?: number | null;
  prior_briefing_char_length?: number | null;
  source_paths?: ResearchBriefingSourcePaths | null;
}

export interface ResearchBriefingDocument {
  filename: string;
  slug: string;
  date: string;
  content: string;
  variant: "rich" | "standard";
  meta: ResearchBriefingMeta | null;
  runDate: string | null;
  effectiveMarketDate: string | null;
  hasExplicitDateContext: boolean;
}

export interface ResearchBriefingStats {
  variant: "rich" | "standard";
  model: string | null;
  usedChunkCount: number | null;
  coveredReportCount: number | null;
  mergedTextLength: number | null;
  summaryChunkCount: number | null;
  candidateChunkCount: number | null;
  sourceReportCount: number | null;
  selectedExtractCount: number | null;
  deepResearchCharLength: number | null;
  promptCharLength: number | null;
  workflow: string | null;
}

export interface ResearchBriefingMetricItem {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  detail: string;
}

export interface ResearchBriefingOverview {
  description: string;
  metricItems: ResearchBriefingMetricItem[];
  lengthLabel: string;
  lengthValue: number | null;
}

export interface MacroIndicator {
  key: string;
  label: string;
  close: number | null;
  changePct: number | null;
  signal?: string | null;
}

export interface ResearchSection {
  title: string;
  body: string;
}

export interface ResearchTag {
  label: string;
  tone: "rose" | "sky" | "emerald" | "amber" | "fuchsia" | "zinc";
  kind: "market" | "macro" | "sector" | "risk" | "action";
}

export interface ResearchScenarioBranch {
  id: string;
  label: string;
  probabilityPct: number | null;
  probabilityLabel: string | null;
  narrative: string;
  response: string;
  checkpoints: string[];
}

export interface ResearchCatalystItem {
  id: string;
  scope: string;
  timing: string;
  event: string;
  why: string;
}

export interface ResearchCheckpointItem {
  id: string;
  label: string;
}

export interface ResearchAccountGoal {
  account: string;
  goal: string;
}

export interface ResearchStrategyGuide {
  cashGuidance: string | null;
  weeklyPriority: string | null;
  accountGoals: ResearchAccountGoal[];
  supportingPoints: string[];
}

export interface ResearchActionGroup {
  id: string;
  account: string;
  items: string[];
}

export interface ResearchPortfolioInsights {
  strengths: string[];
  vulnerabilities: string[];
  upgradeAxes: string[];
}

interface Stage1Extract {
  id?: string | null;
  title?: string | null;
  broker?: string | null;
  report_type?: string | null;
  confidence?: string | null;
  related_holdings_in_my_portfolio?: unknown[];
  portfolio_impacts_candidate?: unknown[];
  catalysts?: unknown[];
  risks?: unknown[];
  what_changed?: unknown[];
}

interface Stage1ExtractState {
  reportCount?: number | null;
  extracts?: Stage1Extract[];
}

interface RichSelectionSummary {
  stage1ReportCount: number | null;
  selectedExtractCount: number | null;
  selectedReportCount: number | null;
}

const RESEARCH_TAG_RULES: Array<{
  label: string;
  tone: ResearchTag["tone"];
  kind: ResearchTag["kind"];
  pattern: RegExp;
}> = [
  { label: "KOSPI", tone: "rose", kind: "market", pattern: /(KOSPI|코스피)/i },
  { label: "KOSDAQ", tone: "fuchsia", kind: "market", pattern: /(KOSDAQ|코스닥)/i },
  { label: "S&P500", tone: "sky", kind: "market", pattern: /(S&P ?500|SP500)/i },
  { label: "NASDAQ", tone: "sky", kind: "market", pattern: /(NASDAQ|나스닥)/i },
  { label: "원\/달러", tone: "amber", kind: "macro", pattern: /(원\/달러|USDKRW|환율)/i },
  { label: "WTI", tone: "amber", kind: "macro", pattern: /(WTI|유가|원유)/i },
  { label: "금", tone: "amber", kind: "macro", pattern: /(금\/원자재|골드|금 가격|금\b)/i },
  { label: "VIX", tone: "amber", kind: "risk", pattern: /\bVIX\b/i },
  { label: "금리/매크로", tone: "amber", kind: "macro", pattern: /(금리|매크로|CPI|FOMC|연준|한국은행)/i },
  { label: "HBM/메모리", tone: "sky", kind: "sector", pattern: /(HBM|메모리|반도체)/i },
  { label: "AI 인프라", tone: "sky", kind: "sector", pattern: /(AI 인프라|데이터센터|AI 모델|하이퍼스케일러)/i },
  { label: "전력 인프라", tone: "emerald", kind: "sector", pattern: /(전력 인프라|전력|전기요금|전력기기)/i },
  { label: "원자력", tone: "emerald", kind: "sector", pattern: /(원자력|SMR|원전)/i },
  { label: "방산", tone: "fuchsia", kind: "sector", pattern: /(방산|국방|NATO|우주항공)/i },
  { label: "리스크 경계", tone: "rose", kind: "risk", pattern: /(변동성|불확실성|경계|부담|급락|위험)/i },
];

const ACTION_CUE_PATTERN =
  /(주목|체크|보강|확대|축소|유지|관망|경계|점검|매수|매도|준비|유의|확인)/;

const SCENARIO_SECTION_PATTERN =
  /(3\s*[-~]\s*6개월.*시나리오|핵심 시나리오 트리|scenario tree)/i;

function getResearchMeta(relativePath: string) {
  return readRepoJsonFile<ResearchBriefingMeta>(`${relativePath}.meta.json`);
}

function getResearchSectionByPattern(content: string, pattern: RegExp) {
  return extractResearchSections(content).find((section) => pattern.test(section.title)) ?? null;
}

function toRepoRelativePath(target: string | null | undefined) {
  if (!target) return null;

  const absoluteTarget = path.resolve(target);
  if (!absoluteTarget.startsWith(REPO_ROOT)) {
    return null;
  }

  return path.relative(REPO_ROOT, absoluteTarget).split(path.sep).join(path.posix.sep);
}

function confidenceScore(value: string | null | undefined) {
  switch (String(value ?? "").toUpperCase()) {
    case "HIGH":
      return 3;
    case "MEDIUM":
      return 2;
    case "LOW":
      return 1;
    default:
      return 0;
  }
}

function scoreStage1Extract(item: Stage1Extract) {
  let score = confidenceScore(item.confidence);
  if (item.report_type === "macro") score += 3;
  if ((item.related_holdings_in_my_portfolio ?? []).length > 0) score += 4;
  if ((item.portfolio_impacts_candidate ?? []).length > 0) score += 3;
  if ((item.catalysts ?? []).length > 0) score += 2;
  if ((item.risks ?? []).length > 0) score += 1;
  if ((item.what_changed ?? []).length > 0) score += 1;
  return score;
}

function pickTopStage1Extracts(
  extracts: Stage1Extract[],
  predicate: (item: Stage1Extract) => boolean,
  limit: number,
) {
  return extracts
    .filter(predicate)
    .map((item) => ({ item, score: scoreStage1Extract(item) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ item }) => item);
}

function deriveRichSelectionSummary(
  meta: ResearchBriefingMeta | null,
): RichSelectionSummary | null {
  if (!meta) return null;

  const fallbackStage1Count = meta.stage1_report_count ?? null;
  const stage1Path = toRepoRelativePath(meta.source_paths?.stage1 ?? null);
  if (!stage1Path) {
    return {
      stage1ReportCount: fallbackStage1Count,
      selectedExtractCount: meta.selected_extract_count ?? meta.selected_extract_budget ?? null,
      selectedReportCount: meta.selected_extract_count ?? meta.selected_extract_budget ?? null,
    };
  }

  const stage1 = readRepoJsonFile<Stage1ExtractState>(stage1Path);
  const extracts = stage1?.extracts ?? [];
  if (extracts.length === 0) {
    return {
      stage1ReportCount: stage1?.reportCount ?? fallbackStage1Count,
      selectedExtractCount: meta.selected_extract_count ?? meta.selected_extract_budget ?? null,
      selectedReportCount: meta.selected_extract_count ?? meta.selected_extract_budget ?? null,
    };
  }

  const maxExtracts = Math.max(meta.selected_extract_budget ?? 18, 1);
  const macro = pickTopStage1Extracts(
    extracts,
    (item) => item.report_type === "macro",
    Math.max(4, Math.floor(maxExtracts / 3)),
  );
  const portfolioLinked = pickTopStage1Extracts(
    extracts,
    (item) =>
      (item.related_holdings_in_my_portfolio ?? []).length > 0 ||
      (item.portfolio_impacts_candidate ?? []).length > 0,
    Math.max(6, Math.floor(maxExtracts / 2)),
  );
  const catalystHeavy = pickTopStage1Extracts(
    extracts,
    (item) => (item.catalysts ?? []).length > 0 || (item.what_changed ?? []).length > 0,
    Math.max(4, Math.floor(maxExtracts / 3)),
  );

  const selectedIds = new Set<string>();
  for (const item of [...macro, ...portfolioLinked, ...catalystHeavy]) {
    const itemId =
      item.id?.trim() ||
      [item.title?.trim(), item.broker?.trim(), item.report_type?.trim()]
        .filter(Boolean)
        .join("::");
    if (itemId) {
      selectedIds.add(itemId);
    }
  }

  const selectedCount =
    meta.selected_extract_count ?? (selectedIds.size > 0 ? selectedIds.size : null);

  return {
    stage1ReportCount: stage1?.reportCount ?? extracts.length ?? fallbackStage1Count,
    selectedExtractCount: selectedCount,
    selectedReportCount: selectedCount,
  };
}

export function loadResearchBriefings(): ResearchBriefingDocument[] {
  const documents = listRepoFiles(KNOWLEDGE_DAILY_DIR)
    .filter((filename) =>
      /^\d{4}-\d{2}-\d{2}-gemini-briefing(?:-rich)?\.md$/.test(filename),
    )
    .reduce<ResearchBriefingDocument[]>((acc, filename) => {
      const relativePath = path.posix.join(KNOWLEDGE_DAILY_DIR, filename);
      const content = readRepoTextFile(relativePath);
      if (!content) return acc;
      const meta = getResearchMeta(relativePath);
      const context = normalizeArtifactDateContext({
        date: filename.slice(0, 10),
        runDate: meta?.run_date ?? null,
        effectiveMarketDate: meta?.effective_market_date ?? null,
        generatedAt: null,
      });

      acc.push({
        filename,
        slug: filename.replace(/\.md$/, ""),
        date: context.effectiveMarketDate ?? filename.slice(0, 10),
        content,
        variant: filename.includes("-rich.") ? "rich" : "standard",
        meta,
        runDate: context.runDate,
        effectiveMarketDate: context.effectiveMarketDate ?? filename.slice(0, 10),
        hasExplicitDateContext: context.hasExplicitContext,
      } satisfies ResearchBriefingDocument);
      return acc;
    }, []);

  return documents
    .sort((left, right) => {
      const leftRunDate = left.runDate ?? "";
      const rightRunDate = right.runDate ?? "";
      if (leftRunDate !== rightRunDate) {
        return rightRunDate.localeCompare(leftRunDate);
      }
      if (left.hasExplicitDateContext !== right.hasExplicitDateContext) {
        return left.hasExplicitDateContext ? -1 : 1;
      }
      if (left.date !== right.date) {
        return right.date.localeCompare(left.date);
      }
      if (left.variant !== right.variant) {
        return left.variant === "rich" ? -1 : 1;
      }
      return right.filename.localeCompare(left.filename);
    });
}

export function loadResearchBriefingBySlug(slug: string) {
  return loadResearchBriefings().find((doc) => doc.slug === slug) ?? null;
}

export function getResearchBriefingStats(
  briefing: ResearchBriefingDocument | null,
): ResearchBriefingStats {
  const meta = briefing?.meta ?? null;
  const richSummary = briefing?.variant === "rich" ? deriveRichSelectionSummary(meta) : null;
  const selectedExtractCount =
    meta?.selected_extract_count ??
    richSummary?.selectedExtractCount ??
    meta?.selected_extract_budget ??
    null;
  const sourceReportCount =
    meta?.stage1_report_count ?? richSummary?.stage1ReportCount ?? null;

  return {
    variant: briefing?.variant ?? "standard",
    model: meta?.model ?? null,
    usedChunkCount:
      meta?.selected_chunk_count ??
      meta?.used_chunk_count ??
      selectedExtractCount ??
      meta?.summary_chunk_count ??
      null,
    coveredReportCount:
      meta?.selected_report_count ??
      meta?.covered_report_count ??
      richSummary?.selectedReportCount ??
      null,
    mergedTextLength:
      meta?.merged_text_char_length ??
      meta?.merged_text_length ??
      meta?.prompt_char_length ??
      null,
    summaryChunkCount: meta?.summary_chunk_count ?? null,
    candidateChunkCount:
      meta?.briefing_candidate_count ??
      meta?.candidate_chunk_count ??
      sourceReportCount ??
      null,
    sourceReportCount,
    selectedExtractCount,
    deepResearchCharLength: meta?.deep_research_char_length ?? null,
    promptCharLength: meta?.prompt_char_length ?? null,
    workflow: meta?.workflow ?? null,
  };
}

export function getResearchBriefingOverview(
  briefing: ResearchBriefingDocument | null,
): ResearchBriefingOverview {
  const stats = getResearchBriefingStats(briefing);

  if (briefing?.variant === "rich") {
    const sourceReportLabel =
      typeof stats.sourceReportCount === "number"
        ? `${stats.sourceReportCount.toLocaleString()}건`
        : "여러 건";
    const selectedExtractLabel =
      typeof stats.selectedExtractCount === "number"
        ? `상위 ${stats.selectedExtractCount.toLocaleString()}개 추출`
        : "핵심 추출";

    return {
      description: `${sourceReportLabel} 리포트에서 ${selectedExtractLabel}과 딥리서치를 다시 엮은 최종 브리핑입니다.`,
      metricItems: [
        {
          key: "source-reports",
          label: "원천 리포트",
          value: stats.sourceReportCount,
          unit: "건",
          detail: "Stage 1에서 구조화 추출한 전체 리포트 수",
        },
        {
          key: "selected-extracts",
          label: "선정 추출",
          value: stats.selectedExtractCount,
          unit: "개",
          detail: "최종 브리핑 프롬프트에 실린 핵심 추출 수",
        },
        {
          key: "deep-research",
          label: "딥리서치",
          value: stats.deepResearchCharLength,
          unit: "자",
          detail: "보강용 Deep Research 원문 길이",
        },
        {
          key: "combined-input",
          label: "결합 입력",
          value: stats.promptCharLength ?? stats.mergedTextLength,
          unit: "자",
          detail: "최종 브리핑 생성에 사용한 전체 입력 길이",
        },
      ],
      lengthLabel: "결합 입력 길이",
      lengthValue: stats.promptCharLength ?? stats.mergedTextLength,
    };
  }

  const reportCoverageLabel =
    typeof stats.coveredReportCount === "number"
      ? `${stats.coveredReportCount.toLocaleString()}건 리포트`
      : "여러 증권사 리포트";

  return {
    description: `${reportCoverageLabel}에서 추린 핵심 섹션을 계층적으로 정리한 브리핑입니다.`,
    metricItems: [
      {
        key: "covered-reports",
        label: "활용 리포트",
        value: stats.coveredReportCount,
        unit: "건",
        detail: "요약에 직접 활용된 리포트 수",
      },
      {
        key: "used-chunks",
        label: "사용 청크",
        value: stats.usedChunkCount,
        unit: "개",
        detail: "실제 인용에 반영된 텍스트 조각",
      },
      {
        key: "candidate-chunks",
        label: "후보 청크",
        value: stats.candidateChunkCount,
        unit: "개",
        detail: "검토 후보로 올라온 텍스트 조각",
      },
      {
        key: "summary-chunks",
        label: "요약 전용",
        value: stats.summaryChunkCount,
        unit: "개",
        detail: "배경 설명 위주 청크",
      },
    ],
    lengthLabel: "원문 길이",
    lengthValue: stats.mergedTextLength,
  };
}

export function extractResearchSections(content: string): ResearchSection[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const headingMatches = [...normalized.matchAll(/^##\s+(.+)$/gm)];

  if (headingMatches.length === 0) {
    return [
      {
        title: "전체 브리핑",
        body: normalized,
      },
    ];
  }

  return headingMatches.map((match, index) => {
    const title = match[1].trim();
    const start = match.index! + match[0].length;
    const end =
      index + 1 < headingMatches.length
        ? headingMatches[index + 1].index!
        : normalized.length;

    return {
      title,
      body: normalized.slice(start, end).trim(),
    };
  });
}

function uniqueByLabel<T extends { label: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.label)) return false;
    seen.add(item.label);
    return true;
  });
}

function splitIntoSentences(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?。]|다\.)\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function extractResearchTags(content: string, limit = 10): ResearchTag[] {
  const tags = RESEARCH_TAG_RULES.filter((rule) => rule.pattern.test(content)).map((rule) => ({
    label: rule.label,
    tone: rule.tone,
    kind: rule.kind,
  }));

  return uniqueByLabel(tags).slice(0, limit);
}

export function extractResearchActionPoints(content: string, limit = 4): string[] {
  const sentences = splitIntoSentences(content);
  const matched = sentences.filter((sentence) => {
    if (sentence.length < 24 || sentence.length > 180) return false;
    return ACTION_CUE_PATTERN.test(sentence);
  });

  return [...new Set(matched)].slice(0, limit);
}

export function extractSectionTags(section: ResearchSection, limit = 6) {
  return extractResearchTags(`${section.title}\n${section.body}`, limit);
}

function parseBulletGroups(body: string) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const groups: Array<{ header: string; items: string[] }> = [];
  let current: { header: string; items: string[] } | null = null;

  for (const rawLine of lines) {
    const topLevelMatch = rawLine.match(/^[-*]\s+(.+)$/);
    if (topLevelMatch) {
      if (current) groups.push(current);
      current = {
        header: cleanMarkdownInline(topLevelMatch[1]),
        items: [],
      };
      continue;
    }

    if (!current) continue;

    const nestedMatch = rawLine.match(/^\s{2,}(?:[-*]|\d+\.)\s+(.+)$/);
    if (nestedMatch) {
      current.items.push(cleanMarkdownInline(nestedMatch[1]));
      continue;
    }

    if (rawLine.trim()) {
      current.items.push(cleanMarkdownInline(rawLine.trim()));
    }
  }

  if (current) groups.push(current);
  return groups;
}

function parseLabelValue(line: string) {
  const normalized = cleanMarkdownInline(line);
  const match = normalized.match(/^([^:：]+?)\s*[:：]\s*(.*)$/);
  if (!match) {
    return {
      label: normalized,
      value: "",
    };
  }

  return {
    label: match[1].trim(),
    value: match[2].trim(),
  };
}

function uniqueStrings(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function splitPortfolioInsightParagraph(paragraph: string) {
  const normalized = cleanMarkdownInline(paragraph).replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const trimmed = normalized
    .replace(/^포트폴리오 관점 시사점[:：]?\s*/i, "")
    .replace(/^현재 포트폴리오는\s*/i, "현재 포트폴리오는 ")
    .replace(/^취약점은\s*/i, "")
    .replace(/^향후 포트폴리오 보완 축은\s*/i, "")
    .replace(/^보완 축은\s*/i, "")
    .trim();

  const ordinalChunks = trimmed
    .split(/(?=(?:첫째|둘째|셋째|넷째|다섯째)\s*,)/)
    .map((item) => item.trim())
    .filter(Boolean);

  const items = (ordinalChunks.length > 1 ? ordinalChunks : [trimmed]).map((item) =>
    item.replace(/^(?:첫째|둘째|셋째|넷째|다섯째)\s*,\s*/i, "").trim(),
  );

  return uniqueStrings(items);
}

export function extractResearchDiagnosis(content: string) {
  const section = getResearchSectionByPattern(content, /오늘 한 줄 진단|one line/i);
  if (!section) return null;

  const bullet = parseBulletGroups(section.body)[0];
  if (bullet?.header) return bullet.header;

  const firstLine = section.body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => cleanMarkdownInline(line))
    .find(Boolean);

  return firstLine ?? null;
}

export function extractResearchCatalystTimeline(
  content: string,
  limit = 6,
): ResearchCatalystItem[] {
  const section = getResearchSectionByPattern(content, /촉매 일정|catalyst/i);
  if (!section) return [];

  return parseBulletGroups(section.body)
    .map((group, index) => {
      const line = cleanMarkdownInline(group.header);
      const bracketMatch = line.match(/^\[(.+?)\]\s*(.+)$/);
      const scope = bracketMatch?.[1]?.trim() ?? "시장";
      const rest = bracketMatch?.[2]?.trim() ?? line;
      const [timing = "", event = "", ...whyParts] = rest
        .split(/\s*\/\s*/)
        .map((item) => item.trim())
        .filter(Boolean);

      return {
        id: `catalyst-${index + 1}`,
        scope,
        timing: timing || "시기 업데이트 대기",
        event: event || rest,
        why: whyParts.join(" / "),
      } satisfies ResearchCatalystItem;
    })
    .filter((item) => item.event)
    .slice(0, limit);
}

export function extractResearchCheckpoints(
  content: string,
  limit = 8,
): ResearchCheckpointItem[] {
  const section = getResearchSectionByPattern(content, /체크포인트|watch/i);
  if (!section) return [];

  const items = parseBulletGroups(section.body).flatMap((group) => {
    const { value } = parseLabelValue(group.header);
    if (group.items.length > 0) {
      return group.items;
    }
    return value ? [value] : [group.header];
  });

  return uniqueStrings(items)
    .slice(0, limit)
    .map((label, index) => ({
      id: `checkpoint-${index + 1}`,
      label,
    }));
}

export function extractResearchStrategyGuide(content: string): ResearchStrategyGuide {
  const section = getResearchSectionByPattern(content, /^Strategy\b|이번 주 대응/i);
  if (!section) {
    return {
      cashGuidance: null,
      weeklyPriority: null,
      accountGoals: [],
      supportingPoints: [],
    };
  }

  const guide: ResearchStrategyGuide = {
    cashGuidance: null,
    weeklyPriority: null,
    accountGoals: [],
    supportingPoints: [],
  };

  for (const group of parseBulletGroups(section.body)) {
    const { label, value } = parseLabelValue(group.header);
    const combined = uniqueStrings([value, ...group.items]);

    if (/현금 비중/i.test(label)) {
      guide.cashGuidance = combined[0] ?? null;
      continue;
    }

    if (/계좌별 목표/i.test(label)) {
      guide.accountGoals = uniqueStrings(
        group.items.map((item) => {
          const parsed = parseLabelValue(item);
          if (parsed.value) {
            return `${parsed.label}: ${parsed.value}`;
          }
          return item;
        }),
      ).map((item) => {
        const parsed = parseLabelValue(item);
        return {
          account: parsed.label,
          goal: parsed.value || item,
        };
      });
      continue;
    }

    if (/우선순위/i.test(label)) {
      guide.weeklyPriority = combined[0] ?? null;
      continue;
    }

    guide.supportingPoints.push(...combined);
  }

  guide.supportingPoints = uniqueStrings(guide.supportingPoints);
  return guide;
}

export function extractResearchActionGroups(
  content: string,
  limit = 4,
): ResearchActionGroup[] {
  const section = getResearchSectionByPattern(content, /^Action\b|오늘 실행/i);
  if (!section) return [];

  return parseBulletGroups(section.body)
    .map((group, index) => {
      const { label, value } = parseLabelValue(group.header);
      const items = uniqueStrings([value, ...group.items]);

      return {
        id: `action-group-${index + 1}`,
        account: label || `Action ${index + 1}`,
        items,
      } satisfies ResearchActionGroup;
    })
    .filter((group) => group.items.length > 0)
    .slice(0, limit);
}

export function extractResearchPortfolioInsights(content: string): ResearchPortfolioInsights {
  const section = getResearchSectionByPattern(content, /포트폴리오 관점 시사점|시사점/i);
  if (!section) {
    return {
      strengths: [],
      vulnerabilities: [],
      upgradeAxes: [],
    };
  }

  const insights: ResearchPortfolioInsights = {
    strengths: [],
    vulnerabilities: [],
    upgradeAxes: [],
  };

  const bulletGroups = parseBulletGroups(section.body);

  for (const group of bulletGroups) {
    const { label, value } = parseLabelValue(group.header);
    const items = uniqueStrings([value, ...group.items]);

    if (/좋은 점|강점/i.test(label)) {
      insights.strengths.push(...items);
      continue;
    }

    if (/취약점|약점|리스크/i.test(label)) {
      insights.vulnerabilities.push(...items);
      continue;
    }

    if (/보완 축|보완|업그레이드/i.test(label)) {
      insights.upgradeAxes.push(...items);
    }
  }

  if (
    insights.strengths.length === 0 &&
    insights.vulnerabilities.length === 0 &&
    insights.upgradeAxes.length === 0
  ) {
    const paragraphs = section.body
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean);

    for (const paragraph of paragraphs) {
      const items = splitPortfolioInsightParagraph(paragraph);
      if (items.length === 0) continue;

      const normalizedParagraph = cleanMarkdownInline(paragraph).replace(/\s+/g, " ").trim();

      if (/^(취약점|약점|리스크)(?:은|는|:|：|\s|$)/i.test(normalizedParagraph)) {
        insights.vulnerabilities.push(...items);
        continue;
      }

      if (
        /^(향후\s+포트폴리오\s+보완 축|보완 축|업그레이드|향후)(?:은|는|:|：|\s|$)/i.test(
          normalizedParagraph,
        )
      ) {
        insights.upgradeAxes.push(...items);
        continue;
      }

      if (
        /^(강점|좋은 점|장점)(?:은|는|:|：|\s|$)/i.test(normalizedParagraph) ||
        insights.strengths.length === 0
      ) {
        insights.strengths.push(...items);
      }
    }
  }

  return {
    strengths: uniqueStrings(insights.strengths),
    vulnerabilities: uniqueStrings(insights.vulnerabilities),
    upgradeAxes: uniqueStrings(insights.upgradeAxes),
  };
}

export function extractSectionActionPoints(section: ResearchSection, limit = 3) {
  return extractResearchActionPoints(section.body, limit);
}

function cleanMarkdownInline(value: string) {
  return value
    .replace(/\[(.*?)\]\([^)]+\)/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/, "")
    .trim();
}

function parseScenarioProbability(value: string) {
  const match = value.match(/확률\s*(\d{1,3})%|(\d{1,3})%/i);
  const parsed = Number.parseInt(match?.[1] ?? match?.[2] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function stripScenarioProbabilityLabel(value: string) {
  return value
    .replace(/\((?:확률\s*)?\d{1,3}%\)/gi, "")
    .replace(/\[(.*?)\]/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseScenarioBlocks(body: string) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: Array<{ header: string; lines: string[] }> = [];
  let current: { header: string; lines: string[] } | null = null;

  for (const rawLine of lines) {
    const topLevelMatch = rawLine.match(/^[-*]\s+(.+)$/);
    if (topLevelMatch) {
      if (current) blocks.push(current);
      current = {
        header: cleanMarkdownInline(topLevelMatch[1]),
        lines: [],
      };
      continue;
    }

    if (!current) continue;

    const nestedMatch = rawLine.match(/^\s{2,}[-*]\s+(.+)$/);
    if (nestedMatch) {
      current.lines.push(cleanMarkdownInline(nestedMatch[1]));
      continue;
    }

    if (rawLine.trim()) {
      current.lines.push(cleanMarkdownInline(rawLine.trim()));
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

export function isStructuredResearchSectionTitle(title: string) {
  return SCENARIO_SECTION_PATTERN.test(title);
}

export function extractResearchScenarioBranches(
  content: string,
  limit = 2,
): ResearchScenarioBranch[] {
  const section = extractResearchSections(content).find((item) =>
    SCENARIO_SECTION_PATTERN.test(item.title),
  );

  if (!section) return [];

  return parseScenarioBlocks(section.body)
    .map((block, index) => {
      const probabilityPct = parseScenarioProbability(block.header);
      const label = stripScenarioProbabilityLabel(block.header);
      const lineMap = new Map(
        block.lines.map((line) => {
          const match = line.match(/^([^:]+):\s*(.+)$/);
          return match
            ? [match[1].trim().toLowerCase(), match[2].trim()]
            : [line.trim().toLowerCase(), line.trim()];
        }),
      );

      let narrative =
        lineMap.get("전개") ??
        lineMap.get("시나리오") ??
        lineMap.get("상황") ??
        "";
      let response =
        lineMap.get("대응") ??
        lineMap.get("포트폴리오 대응") ??
        lineMap.get("액션") ??
        lineMap.get("전략") ??
        "";
      const checkpoints = (
        lineMap.get("체크포인트") ??
        lineMap.get("관찰 포인트") ??
        lineMap.get("확인 지표") ??
        ""
      )
        .split(/\s*[,/]\s*|\s*\|\s*/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item, index, items) => items.indexOf(item) === index);

      if ((!narrative || !response) && /(?:->|→|대응[:：])/.test(block.header)) {
        const [left, right] = block.header.split(/(?:->|→|대응[:：])/);
        const leftText = left?.trim() ?? "";
        const rightText = right?.trim() ?? "";
        if (!narrative) {
          narrative = stripScenarioProbabilityLabel(leftText);
        }
        if (!response) {
          response = rightText;
        }
      }

      if (!narrative) {
        narrative = block.lines.find((line) => !/^(대응|체크포인트|관찰 포인트|확인 지표)\s*:/i.test(line)) ?? "";
      }

      return {
        id: `scenario-${index + 1}`,
        label: label || `Scenario ${index + 1}`,
        probabilityPct,
        probabilityLabel: probabilityPct != null ? `${probabilityPct}%` : null,
        narrative,
        response,
        checkpoints,
      } satisfies ResearchScenarioBranch;
    })
    .filter((item) => item.narrative || item.response)
    .slice(0, limit);
}

export function loadLatestMacroIndicators(date?: string): MacroIndicator[] {
  const marketFilename =
    date != null
      ? `${date}.json`
      : listRepoFiles(MARKET_DIR)
          .filter((file) => file.endsWith(".json"))
          .sort()
          .reverse()[0];

  if (!marketFilename) return [];

  const marketRelativePath = path.posix.join(MARKET_DIR, marketFilename);
  const market = readRepoJsonFile<{
    indices?: Record<string, { close?: number | null; change_pct?: number | null }>;
    macro?: Record<string, { close?: number | null; change_pct?: number | null }>;
    date?: string;
  }>(marketRelativePath);
  if (!market) return [];

  const marketDate = date ?? market.date ?? path.posix.basename(marketFilename, ".json");
  const technical = readRepoJsonFile<{ market_context?: { signal?: string | null } }>(
    path.posix.join(TECHNICAL_DIR, `${marketDate}.json`),
  );

  const indicators: MacroIndicator[] = [
    {
      key: "KOSPI",
      label: "코스피",
      close: market.indices?.KOSPI?.close ?? null,
      changePct: market.indices?.KOSPI?.change_pct ?? null,
      signal: technical?.market_context?.signal ?? null,
    },
    {
      key: "SP500",
      label: "S&P500",
      close: market.indices?.SP500?.close ?? null,
      changePct: market.indices?.SP500?.change_pct ?? null,
    },
    {
      key: "NASDAQ",
      label: "나스닥",
      close: market.indices?.NASDAQ?.close ?? null,
      changePct: market.indices?.NASDAQ?.change_pct ?? null,
    },
    {
      key: "USDKRW",
      label: "원/달러",
      close: market.macro?.USDKRW?.close ?? null,
      changePct: market.macro?.USDKRW?.change_pct ?? null,
    },
    {
      key: "WTI",
      label: "WTI",
      close: market.macro?.WTI?.close ?? null,
      changePct: market.macro?.WTI?.change_pct ?? null,
    },
    {
      key: "GOLD",
      label: "금",
      close: market.macro?.GOLD?.close ?? null,
      changePct: market.macro?.GOLD?.change_pct ?? null,
    },
  ];

  return indicators.filter((item) => item.close != null);
}
