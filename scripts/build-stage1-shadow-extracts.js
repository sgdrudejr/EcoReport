#!/usr/bin/env node

import path from "node:path";
import process from "node:process";

import {
  ROOT_DIR,
  buildRunMetadata,
  compactWhitespace,
  extractNumericPhrases,
  isBoilerplateParagraph,
  parseDateArgs,
  readJson,
  readText,
  reportTypeFromMeta,
  sectorFromText,
  splitParagraphs,
  themesFromText,
  truncate,
  writeJson,
} from "./lib/pipeline-utils.js";

const MAX_STAGE1_CHUNKS_PER_REPORT = 6;
const MIN_STAGE1_CHUNKS_PER_REPORT = 1;

const CONDITION_PATTERN =
  /만약|경우|지속된다면|지속될 경우|완화될 경우|안정화될 경우|유지될 경우|상승할 경우|하락할 경우|장기화될 경우|마무리될 경우|재개될 경우|확대될 경우|축소될 경우|종전\s*시|협상\s*무드\s*지속|상회\s*시|하회\s*시/;
const COUNTERPOINT_PATTERN = /반면|그러나|다만|리스크|우려|부담|불확실성|압박|약세|하락|감소|둔화|장기화|지연|재점화|악화/;
const POSITIVE_PATTERN = /긍정|개선|회복|상향|확대|증가|견조|안정화|완화|반등|유효|추천|최선호|매력|수혜|부각|유리/;
const NEGATIVE_PATTERN = /부정|악화|하향|둔화|부담|우려|리스크|압박|불확실성|하락|감소|약세|훼손|무효화|제한적|장기화|지연/;
const TARGET_PATTERN = /목표주가|TP\s*[:：]|목표\s*가격|투자의견|BUY|Buy|매수|중립|매도/;
const NOISE_PATTERN =
  /자료\s*:|Research Center|Bloomberg|QuantiWise|DART|Relative to|주가수익률|시가총액|괴리율|수익률|URL\s*:|www\.|@[A-Za-z0-9.-]+|그림\s*\d+|표\s*\d+|Chart|Figure|52\s*주\s*최고가|외국인\s*지분율|발행주식수|일평균\s*거래대금|상위\s*업종|하위\s*업종|Top\s*10|종목코드|종목\s*업종|1W\s*조정률|1M\s*누적|3M\s*누적|6M\s*12M|유니버스\s*200/i;

function normalizeIndexEntries(raw) {
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.entries)
      ? raw.entries
      : Array.isArray(raw?.reports)
        ? raw.reports
        : [];

  return entries
    .map((entry) => {
      const reportId = entry?.report_id ?? entry?.id ?? null;
      if (!reportId) return null;
      return {
        reportId,
        id: reportId,
        title: entry?.title ?? null,
        broker: entry?.broker ?? null,
        source: entry?.source ?? null,
        date: entry?.date ?? null,
        category: entry?.category ?? null,
        ticker: entry?.ticker ?? null,
        ticker_name: entry?.ticker_name ?? null,
        opinion: entry?.opinion ?? null,
        target_price: entry?.target_price ?? null,
        full_text_path: entry?.full_text_path ?? null,
        text_length: entry?.full_text_length ?? entry?.text_length ?? null,
      };
    })
    .filter(Boolean);
}

function compareChunks(left, right) {
  return (
    right.priority_score - left.priority_score ||
    Number(right.chunk_flags.has_holding_match) - Number(left.chunk_flags.has_holding_match) ||
    left.chunk_seq - right.chunk_seq
  );
}

function countNumericSignals(text) {
  return extractNumericPhrases(text, 24).length;
}

function pickStage1Chunks(reportChunks) {
  const available = reportChunks.filter((chunk) => !chunk?.chunk_flags?.is_disclaimer);
  if (available.length === 0) return [];

  const eligible = available
    .filter((chunk) => chunk.priority_score >= 5 || chunk?.chunk_flags?.has_holding_match)
    .sort(compareChunks);

  if (eligible.length === 0) {
    return [...available].sort(compareChunks).slice(0, MIN_STAGE1_CHUNKS_PER_REPORT);
  }

  return eligible.slice(0, MAX_STAGE1_CHUNKS_PER_REPORT);
}

function buildSelectionReason(chunk) {
  const reasons = [];
  if (chunk?.chunk_flags?.has_target_price) reasons.push("목표주가/투자의견");
  if (chunk?.chunk_flags?.has_holding_match) reasons.push("보유종목 직접 관련");
  if (chunk?.chunk_flags?.has_condition) reasons.push("조건절");
  if (chunk?.chunk_flags?.has_counterpoint) reasons.push("반론/리스크");

  const numericSignals = countNumericSignals(chunk?.core_text ?? "");
  if (numericSignals > 0) {
    reasons.push(`숫자 신호 ${Math.min(numericSignals, 8)}개`);
  }

  return reasons.join(", ") || "최고 점수 chunk 보장 선택";
}

function cleanUnitText(value) {
  return compactWhitespace(value)
    .replace(/\b(?:https?:\/\/|www\.)\S+/g, " ")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoisyUnit(text) {
  const value = cleanUnitText(text);
  if (!value || value.length < 25) return true;
  if (isBoilerplateParagraph(value)) return true;
  if (NOISE_PATTERN.test(value)) return true;

  const numberTokenCount = (value.match(/\d+(?:[.,/%-]\d+)*/g) ?? []).length;
  const alphaCount = (value.match(/[가-힣A-Za-z]/g) ?? []).length;
  const percentCount = (value.match(/%/g) ?? []).length;
  const targetTokenCount = (value.match(/목표주가|TP|투자의견|BUY|Buy|매수|중립|매도/g) ?? []).length;
  const currencyCount = (value.match(/\d[\d,]*(?:\.\d+)?\s*원/g) ?? []).length;

  if (percentCount >= 6 && value.length < 260) return true;
  if (numberTokenCount >= 18 && alphaCount < numberTokenCount * 3) return true;
  if (targetTokenCount >= 3) return true;
  if (currencyCount >= 3) return true;

  return false;
}

function isNarrativeUnit(text) {
  const value = cleanUnitText(text);
  if (isNoisyUnit(value)) return false;

  const alphaCount = (value.match(/[가-힣A-Za-z]/g) ?? []).length;
  const digitCount = (value.match(/\d/g) ?? []).length;
  const targetTokenCount = (value.match(/목표주가|TP|투자의견|BUY|Buy|매수|중립|매도/g) ?? []).length;

  if (alphaCount < 30) return false;
  if (digitCount > alphaCount * 0.9) return false;
  if (targetTokenCount >= 2) return false;

  return true;
}

function countPattern(text, pattern) {
  return (cleanUnitText(text).match(pattern) ?? []).length;
}

function hasDenseRatings(text) {
  return (
    countPattern(text, /목표주가|TP|투자의견|BUY|Buy|매수|중립|매도/g) >= 2 ||
    countPattern(text, /\d[\d,]*(?:\.\d+)?\s*원/g) >= 2
  );
}

function isSnapshotMetricNoise(text) {
  return /52\s*주\s*최고가|외국인\s*지분율|발행주식수|일평균\s*거래대금|시가총액|상위\s*업종|하위\s*업종/i.test(
    cleanUnitText(text),
  );
}

function splitSentences(text) {
  return cleanUnitText(text)
    .split(/(?<=[.!?])\s+|(?<=다)\s+(?=[가-힣A-Z\[])/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 20);
}

function buildChunkUnits(chunk) {
  const paragraphs = splitParagraphs(chunk?.core_text ?? "");
  const baseParagraphs = paragraphs.length > 0 ? paragraphs : [chunk?.core_text ?? ""];
  const units = [];

  for (const paragraph of baseParagraphs) {
    const cleanedParagraph = cleanUnitText(paragraph);
    if (cleanedParagraph.length >= 20) {
      units.push({
        text: cleanedParagraph,
        kind: "paragraph",
      });
    }

    for (const sentence of splitSentences(paragraph)) {
      units.push({
        text: sentence,
        kind: "sentence",
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const unit of units) {
    const key = unit.text;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(unit);
  }

  return deduped;
}

function scoreClaimUnit(unit, chunk) {
  const text = unit.text;
  let score = chunk.priority_score * 3;

  if (chunk?.chunk_flags?.has_target_price) score += 8;
  if (chunk?.chunk_flags?.has_condition) score += 5;
  if (chunk?.chunk_flags?.has_counterpoint) score += 2;
  if (TARGET_PATTERN.test(text)) score += 4;
  if (POSITIVE_PATTERN.test(text)) score += 4;
  if (NEGATIVE_PATTERN.test(text)) score += 1;
  if (countNumericSignals(text) >= 2) score += 3;
  if (text.length >= 60 && text.length <= 240) score += 4;
  if (unit.kind === "sentence") score += 2;
  if (isNarrativeUnit(text)) score += 8;
  if (isNoisyUnit(text)) score -= 18;

  return score;
}

function scoreConditionUnit(unit, chunk, mode) {
  const text = unit.text;
  const isBreak = mode === "break";
  let score = chunk.priority_score * 2;

  if (CONDITION_PATTERN.test(text)) score += 8;
  if (TARGET_PATTERN.test(text)) score += 2;
  if (countNumericSignals(text) >= 1) score += 2;
  if (unit.kind === "sentence") score += 1;
  if (text.length >= 40 && text.length <= 220) score += 2;

  if (isBreak) {
    if (chunk?.chunk_flags?.has_counterpoint) score += 6;
    if (COUNTERPOINT_PATTERN.test(text)) score += 8;
    if (NEGATIVE_PATTERN.test(text)) score += 6;
    if (POSITIVE_PATTERN.test(text)) score -= 2;
  } else {
    if (chunk?.chunk_flags?.has_condition) score += 5;
    if (POSITIVE_PATTERN.test(text)) score += 5;
    if (NEGATIVE_PATTERN.test(text)) score -= 2;
  }

  if (isNoisyUnit(text)) score -= 18;

  return score;
}

function scoreBullChunk(chunk) {
  let score = chunk.priority_score * 2;
  if (chunk?.chunk_flags?.has_target_price) score += 8;
  if (chunk?.chunk_flags?.has_condition) score += 4;
  if (chunk?.chunk_flags?.has_counterpoint) score -= 1;
  score += (cleanUnitText(chunk?.core_text ?? "").match(POSITIVE_PATTERN)?.length ?? 0) * 2;
  score -= isNoisyUnit(chunk?.core_text ?? "") ? 10 : 0;
  return score;
}

function scoreRiskChunk(chunk) {
  let score = chunk.priority_score * 2;
  if (chunk?.chunk_flags?.has_counterpoint) score += 8;
  if (chunk?.chunk_flags?.has_condition) score += 2;
  score += (cleanUnitText(chunk?.core_text ?? "").match(COUNTERPOINT_PATTERN)?.length ?? 0) * 3;
  score += (cleanUnitText(chunk?.core_text ?? "").match(NEGATIVE_PATTERN)?.length ?? 0) * 2;
  score -= isNoisyUnit(chunk?.core_text ?? "") ? 10 : 0;
  return score;
}

function pickBestUnit(chunks, scorer, filter = () => true) {
  let best = null;

  for (const chunk of chunks) {
    for (const unit of buildChunkUnits(chunk)) {
      if (!filter(unit, chunk)) continue;
      const score = scorer(unit, chunk);
      if (!best || score > best.score) {
        best = { score, chunk, unit };
      }
    }
  }

  return best;
}

function pickClaim(chunks, reportMeta) {
  const best =
    pickBestUnit(
      chunks,
      scoreClaimUnit,
      (unit) =>
        isNarrativeUnit(unit.text) &&
        !hasDenseRatings(unit.text) &&
        !isSnapshotMetricNoise(unit.text) &&
        (TARGET_PATTERN.test(unit.text) || POSITIVE_PATTERN.test(unit.text) || NEGATIVE_PATTERN.test(unit.text) || unit.text.length >= 60),
    ) ??
    pickBestUnit(
      chunks,
      scoreClaimUnit,
      (unit) => isNarrativeUnit(unit.text) && !hasDenseRatings(unit.text) && !isSnapshotMetricNoise(unit.text),
    );

  if (!best) {
    return {
      text: truncate(reportMeta?.title ?? "", 220),
      chunkId: null,
    };
  }

  return {
    text: truncate(best.unit.text, 220),
    chunkId: best.chunk.chunk_id,
  };
}

function pickCondition(chunks, mode) {
  const isBreak = mode === "break";
  const best =
    pickBestUnit(
      chunks,
      (unit, chunk) => scoreConditionUnit(unit, chunk, mode),
      (unit, chunk) =>
        isNarrativeUnit(unit.text) &&
        (CONDITION_PATTERN.test(unit.text) ||
          (isBreak ? COUNTERPOINT_PATTERN.test(unit.text) || NEGATIVE_PATTERN.test(unit.text) : false) ||
          (isBreak ? chunk?.chunk_flags?.has_counterpoint && /경우|시|된다면|되면|장기화|지연/.test(unit.text) : chunk?.chunk_flags?.has_condition && /경우|시|된다면|되면/.test(unit.text))),
    ) ??
    pickBestUnit(
      chunks,
      (unit, chunk) => scoreConditionUnit(unit, chunk, mode),
      (unit) =>
        isNarrativeUnit(unit.text) &&
        (isBreak ? COUNTERPOINT_PATTERN.test(unit.text) || NEGATIVE_PATTERN.test(unit.text) : CONDITION_PATTERN.test(unit.text)),
    );

  if (!best) {
    return {
      text: null,
      chunkId: null,
    };
  }

  if (mode === "keep" && !CONDITION_PATTERN.test(best.unit.text)) {
    return {
      text: null,
      chunkId: null,
    };
  }

  return {
    text: truncate(best.unit.text, 200),
    chunkId: best.chunk.chunk_id,
  };
}

function pickExcerptFromChunk(chunk, mode) {
  const unit =
    pickBestUnit(
      [chunk],
      (candidate) =>
        mode === "risk"
          ? scoreConditionUnit(candidate, chunk, "break")
          : scoreClaimUnit(candidate, chunk) + (POSITIVE_PATTERN.test(candidate.text) ? 4 : 0),
      (candidate) => isNarrativeUnit(candidate.text),
    ) ?? null;

  return truncate(unit?.unit?.text ?? cleanUnitText(chunk?.core_text ?? ""), 320);
}

function pickBullChunk(chunks) {
  const best = pickBestUnit(
    chunks,
    (unit, chunk) => scoreClaimUnit(unit, chunk) + (POSITIVE_PATTERN.test(unit.text) ? 8 : 0),
    (unit) =>
      isNarrativeUnit(unit.text) &&
      !hasDenseRatings(unit.text) &&
      !isSnapshotMetricNoise(unit.text) &&
      (POSITIVE_PATTERN.test(unit.text) || CONDITION_PATTERN.test(unit.text)),
  );
  if (!best) return { text: null, chunkId: null };
  return {
    text: truncate(best.unit.text, 320),
    chunkId: best.chunk.chunk_id,
  };
}

function pickRiskChunk(chunks) {
  const best = pickBestUnit(
    chunks,
    (unit, chunk) => scoreConditionUnit(unit, chunk, "break") + 4,
    (unit) =>
      isNarrativeUnit(unit.text) &&
      !hasDenseRatings(unit.text) &&
      !isSnapshotMetricNoise(unit.text) &&
      (COUNTERPOINT_PATTERN.test(unit.text) || NEGATIVE_PATTERN.test(unit.text)),
  );

  if (!best) return { text: null, chunkId: null };
  return {
    text: truncate(best.unit.text, 320),
    chunkId: best.chunk.chunk_id,
  };
}

function extractKeyNumbers(chunks, reportMeta) {
  const ordered = [];
  const push = (value) => {
    const token = String(value ?? "").trim();
    if (!token || ordered.includes(token)) return;
    ordered.push(token);
  };

  if (reportMeta?.target_price) {
    push(String(reportMeta.target_price));
  }

  for (const chunk of chunks) {
    for (const entity of chunk?.entities ?? []) {
      if (/\d/.test(entity)) push(entity);
    }
  }

  for (const chunk of chunks) {
    for (const number of extractNumericPhrases(chunk?.core_text ?? "", 12)) {
      push(number);
    }
  }

  return ordered.slice(0, 8);
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const chunksPath = path.join(ROOT_DIR, "data", "analysis-state", args.date, "chunk-index", "chunks.jsonl");
  const indexPath = path.join(ROOT_DIR, "data", "reports", args.date, "index.json");
  const outputPath =
    args.output ?? path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage1-shadow", "stage1-shadow-extracts.json");

  const [chunkText, rawIndex] = await Promise.all([readText(chunksPath, ""), readJson(indexPath, [])]);

  if (!chunkText.trim()) {
    throw new Error(`chunk-index 입력이 없습니다: ${chunksPath}`);
  }

  const chunks = chunkText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const indexEntries = normalizeIndexEntries(rawIndex);
  const metaByReportId = new Map(indexEntries.map((entry) => [entry.reportId, entry]));
  const chunksByReport = new Map();

  for (const chunk of chunks) {
    if (!chunksByReport.has(chunk.report_id)) {
      chunksByReport.set(chunk.report_id, []);
    }
    chunksByReport.get(chunk.report_id).push(chunk);
  }

  const reportIds = new Set([...metaByReportId.keys(), ...chunksByReport.keys()]);
  const extracts = [];
  let totalSelectedChunks = 0;
  let reportsWithCondition = 0;
  let reportsWithCounterpoint = 0;

  for (const reportId of [...reportIds].sort()) {
    const reportChunks = chunksByReport.get(reportId) ?? [];
    if (reportChunks.length === 0) continue;

    const reportMeta = metaByReportId.get(reportId) ?? {
      reportId,
      id: reportId,
      title: reportChunks[0]?.title ?? null,
      broker: reportChunks[0]?.broker ?? null,
      source: null,
      date: reportChunks[0]?.report_date ?? args.date,
      category: null,
      ticker: null,
      ticker_name: null,
      opinion: null,
      target_price: null,
      full_text_path: null,
      text_length: null,
    };

    const selectedChunks = pickStage1Chunks(reportChunks);
    if (selectedChunks.length === 0) continue;

    totalSelectedChunks += selectedChunks.length;
    if (selectedChunks.some((chunk) => chunk?.chunk_flags?.has_condition)) reportsWithCondition += 1;
    if (selectedChunks.some((chunk) => chunk?.chunk_flags?.has_counterpoint)) reportsWithCounterpoint += 1;

    const combinedText = selectedChunks.map((chunk) => chunk.core_text).join("\n\n");
    const reportType = reportTypeFromMeta(reportMeta, combinedText);
    const sector = sectorFromText(reportMeta.title ?? "", combinedText);
    const themes = themesFromText(reportMeta.title ?? "", combinedText);

    const claim = pickClaim(selectedChunks, reportMeta);
    const keepCondition = pickCondition(selectedChunks, "keep");
    const breakCondition = pickCondition(selectedChunks, "break");
    const bullChunk = pickBullChunk(selectedChunks);
    const riskChunk = pickRiskChunk(selectedChunks);
    const keyNumbers = extractKeyNumbers(selectedChunks, reportMeta);

    extracts.push({
      id: reportId,
      report_id: reportId,
      schemaVersion: 1,
      title: reportMeta.title,
      broker: reportMeta.broker,
      source: reportMeta.source,
      date: reportMeta.date,
      category: reportMeta.category,
      report_type: reportType,
      sector,
      themes,
      ticker: reportMeta.ticker,
      ticker_name: reportMeta.ticker_name,
      opinion: reportMeta.opinion,
      target_price: reportMeta.target_price,
      selected_chunks: selectedChunks.map((chunk) => ({
        chunk_id: chunk.chunk_id,
        chunk_seq: chunk.chunk_seq,
        priority_score: chunk.priority_score,
        section_title: chunk.section_title,
        chunk_flags: chunk.chunk_flags,
        selection_reason: buildSelectionReason(chunk),
        core_text: chunk.core_text,
      })),
      claim: claim.text,
      claim_chunk_id: claim.chunkId,
      key_numbers: keyNumbers,
      keep_condition: keepCondition.text,
      keep_condition_chunk_id: keepCondition.chunkId,
      break_condition: breakCondition.text,
      break_condition_chunk_id: breakCondition.chunkId,
      bull_chunk: bullChunk.text,
      bull_chunk_id: bullChunk.chunkId,
      risk_chunk: riskChunk.text,
      risk_chunk_id: riskChunk.chunkId,
      quality: {
        selected_chunk_count: selectedChunks.length,
        condition_chunk_count: selectedChunks.filter((chunk) => chunk?.chunk_flags?.has_condition).length,
        counterpoint_chunk_count: selectedChunks.filter((chunk) => chunk?.chunk_flags?.has_counterpoint).length,
        target_price_chunk_count: selectedChunks.filter((chunk) => chunk?.chunk_flags?.has_target_price).length,
      },
    });
  }

  const runMeta = buildRunMetadata(args);
  const payload = {
    ...runMeta,
    reportCount: extracts.length,
    selection: {
      min_chunks_per_report: MIN_STAGE1_CHUNKS_PER_REPORT,
      max_chunks_per_report: MAX_STAGE1_CHUNKS_PER_REPORT,
      rule: "priority_score >= 5 or has_holding_match == true, excluding disclaimer chunks",
    },
    quality: {
      selectedChunkCount: totalSelectedChunks,
      avgSelectedChunksPerReport:
        extracts.length > 0 ? Number.parseFloat((totalSelectedChunks / extracts.length).toFixed(2)) : 0,
      reportsWithCondition,
      reportsWithCounterpoint,
      reportsWithBoth: extracts.filter(
        (extract) => extract.keep_condition && extract.break_condition,
      ).length,
    },
    extracts,
  };

  await writeJson(outputPath, payload);

  console.log(
    `[stage1-shadow] reports=${payload.reportCount} selected_chunks=${payload.quality.selectedChunkCount} avg_selected=${payload.quality.avgSelectedChunksPerReport}`,
  );
  console.log(
    `[stage1-shadow] reports_with_condition=${payload.quality.reportsWithCondition} reports_with_counterpoint=${payload.quality.reportsWithCounterpoint} reports_with_both=${payload.quality.reportsWithBoth}`,
  );
  console.log(`[stage1-shadow] output=${path.relative(ROOT_DIR, outputPath)}`);
}

main().catch((error) => {
  console.error(`stage1 shadow extracts 생성 실패: ${error.message}`);
  process.exit(1);
});
