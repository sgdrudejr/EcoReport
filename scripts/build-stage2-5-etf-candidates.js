#!/usr/bin/env node
// Stage 2.5: Stage 2 테마 논리를 ETF 후보로 매칭하고 enriched Stage 2 산출물을 만든다.

import path from "node:path";

import {
  CATEGORY_BY_CODE,
  ROOT_DIR,
  clamp,
  normalizeText,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

function parseStage2_5Args(argv) {
  const args = parseDateArgs(argv);
  args.output = null;
  args.stage2Input = null;
  args.rankingInput = null;
  args.mapInput = null;
  args.enrichedOutput = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    } else if (token === "--stage2-input" && argv[index + 1]) {
      args.stage2Input = argv[index + 1];
      index += 1;
    } else if (token === "--ranking-input" && argv[index + 1]) {
      args.rankingInput = argv[index + 1];
      index += 1;
    } else if (token === "--map-input" && argv[index + 1]) {
      args.mapInput = argv[index + 1];
      index += 1;
    } else if (token === "--enriched-output" && argv[index + 1]) {
      args.enrichedOutput = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function asPathOrDefault(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
}

function isSecurityCode(value) {
  return /^\d{6}$/.test(String(value ?? "").trim());
}

function isThemePlaceholder(value) {
  const token = String(value ?? "").trim();
  if (!token) return true;
  if (token.startsWith("THEME::")) return true;
  return !isSecurityCode(token);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeToken(value) {
  return normalizeText(String(value ?? "")).replace(/[^a-z0-9가-힣]+/g, "").trim();
}

function tokenizeThemeText(value) {
  const stopwords = new Set([
    "테마",
    "전략",
    "방향",
    "논리",
    "모멘텀",
    "리스크",
    "국면",
    "구간",
    "대응",
    "추천",
    "후보",
    "강화",
    "축소",
    "관찰",
    "매수",
    "매도",
    "보유",
    "through",
    "theme",
    "thesis",
  ]);

  return unique(
    String(value ?? "")
      .split(/[\s,|/()\-:+]+/)
      .map((item) => normalizeToken(item))
      .filter((item) => item.length >= 2)
      .filter((item) => !stopwords.has(item)),
  );
}

function extractSignals(stage2Data) {
  const signals = [];

  for (const item of toList(stage2Data?.strategy_changes)) {
    const theme = String(item?.theme ?? "").trim();
    const whyNow = String(item?.why_now ?? "").trim();
    const direction = String(item?.direction ?? "watch").toLowerCase();
    const tokens = tokenizeThemeText(`${theme} ${whyNow}`);
    if (!theme && tokens.length === 0) continue;

    signals.push({
      signalType: "strategy_change",
      theme,
      direction,
      text: `${theme} ${whyNow}`.trim(),
      tokens,
      confidence: String(item?.condition_probability ?? "MEDIUM").toUpperCase(),
    });
  }

  for (const candidate of toList(stage2Data?.candidate_scores)) {
    if (!isThemePlaceholder(candidate?.code)) continue;

    const name = String(candidate?.name ?? "").trim();
    const thesis = String(candidate?.thesis ?? "").trim();
    const stance = String(candidate?.stance ?? "watch").toLowerCase();
    const tokens = tokenizeThemeText(`${name} ${thesis}`);
    if (!name && tokens.length === 0) continue;

    signals.push({
      signalType: "theme_candidate",
      theme: name || candidate?.code,
      direction: stance === "trim" ? "reduce" : stance === "buy" ? "reinforce" : "watch",
      text: `${name} ${thesis}`.trim(),
      tokens,
      confidence: String(candidate?.confidence ?? "MEDIUM").toUpperCase(),
      targetAccounts: toList(candidate?.target_accounts),
    });
  }

  return signals;
}

function scoreSignalToEtf(signal, etf) {
  const etfName = normalizeText(etf?.name ?? "");
  const sectors = toList(etf?.sectors).map((item) => normalizeText(item));
  const keywords = toList(etf?.keywords).map((item) => normalizeText(item));
  const rationale = normalizeText(etf?.rationale ?? "");

  let score = 0;
  let hits = 0;

  for (const rawToken of signal.tokens ?? []) {
    const token = normalizeText(rawToken);
    if (!token || token.length < 2) continue;

    if (etfName.includes(token)) {
      score += 8;
      hits += 1;
      continue;
    }

    const sectorHit = sectors.some((entry) => entry.includes(token) || token.includes(entry));
    if (sectorHit) {
      score += 6;
      hits += 1;
      continue;
    }

    const keywordHit = keywords.some((entry) => entry.includes(token) || token.includes(entry));
    if (keywordHit) {
      score += 5;
      hits += 1;
      continue;
    }

    if (rationale.includes(token)) {
      score += 2;
      hits += 1;
    }
  }

  if (hits > 0 && signal.signalType === "strategy_change") {
    score += 5;
  }

  if (signal.confidence === "HIGH") score += 2;
  if (signal.confidence === "LOW") score -= 1;

  return {
    score,
    hits,
  };
}

function scoreDirection(direction, changePct) {
  const delta = typeof changePct === "number" ? changePct : 0;

  if (direction === "reinforce") {
    if (delta >= 1.5) return 8;
    if (delta > 0) return 5;
    return 1;
  }

  if (direction === "reduce") {
    if (delta <= -1.5) return 8;
    if (delta < 0) return 4;
    return -2;
  }

  if (Math.abs(delta) >= 2.5) return 3;
  return 1;
}

function toConfidenceLabel(score) {
  if (score >= 72) return "HIGH";
  if (score >= 52) return "MEDIUM";
  return "LOW";
}

function toDefaultStance(direction, score) {
  if (direction === "reduce") return "trim";
  if (direction === "watch") {
    if (score >= 64) return "hold";
    return "watch";
  }
  if (score >= 56) return "buy";
  if (score >= 44) return "hold";
  return "watch";
}

function buildThemeWhy(bestSignal, rankingRow) {
  const changeText =
    rankingRow && typeof rankingRow.changePct === "number"
      ? `당일 등락률 ${rankingRow.changePct >= 0 ? "+" : ""}${rankingRow.changePct.toFixed(2)}%`
      : "당일 모멘텀 확인";
  const theme = bestSignal?.theme || "테마";
  return `${theme} 신호와 ETF 키워드가 일치하며 ${changeText} 흐름이 동행합니다.`;
}

function buildInvalidation(bestSignal) {
  const theme = bestSignal?.theme || "테마";
  if (bestSignal?.direction === "reduce") {
    return `${theme} 약세 논리가 해소되거나 실적/수급 반전 신호가 확인되면 재평가`;
  }
  return `${theme} 논리가 약화되거나 정책/수급 역풍이 확인되면 판단 보류`;
}

function buildCandidates({ stage2Data, mapEtfs, rankingRows, portfolio }) {
  const signals = extractSignals(stage2Data);
  const rankingByCode = new Map(toList(rankingRows).map((item) => [String(item.code), item]));
  const maxVolume = Math.max(
    1,
    ...toList(rankingRows).map((item) => Number(item?.volume ?? 0)).filter((item) => Number.isFinite(item)),
  );

  const accountBiasByKey = new Map(
    toList(stage2Data?.account_actions)
      .filter((item) => item?.account_key)
      .map((item) => [String(item.account_key), String(item?.bias ?? "hold")]),
  );

  const aggressiveAccounts = [...accountBiasByKey.entries()]
    .filter(([, bias]) => ["aggressive_add", "selective_add"].includes(bias))
    .map(([accountKey]) => accountKey);

  const holdingsByAccount = new Map();
  for (const account of toList(portfolio?.accounts)) {
    const key = String(account?.key ?? "");
    if (!key) continue;
    const codes = new Set(
      toList(account?.holdings)
        .map((holding) => String(holding?.code ?? "").trim())
        .filter((code) => /^\d{6}$/.test(code)),
    );
    holdingsByAccount.set(key, codes);
  }

  const accountKeys = toList(portfolio?.accounts)
    .map((account) => String(account?.key ?? "").trim())
    .filter(Boolean);

  const scored = [];

  for (const etf of toList(mapEtfs)) {
    const code = String(etf?.code ?? "").trim();
    if (!isSecurityCode(code)) continue;

    const signalScores = signals
      .map((signal) => ({ signal, ...scoreSignalToEtf(signal, etf) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    const best = signalScores[0] ?? null;
    const rankingRow = rankingByCode.get(code) ?? null;

    // 신호 매칭이 전혀 없고 랭킹에도 없으면 후보 제외
    if (!best && !rankingRow) continue;

    const direction = best?.signal?.direction ?? "watch";
    const themeScore = best ? Math.min(55, best.score * 1.6) : 0;
    const volume = Number(rankingRow?.volume ?? 0);
    const volumeScore = Number.isFinite(volume)
      ? Math.round((Math.log1p(Math.max(0, volume)) / Math.log1p(maxVolume)) * 14)
      : 0;
    const changePct = Number(rankingRow?.changePct ?? 0);
    const changeScore = Number.isFinite(changePct) ? clamp(Math.round(changePct * 2.1), -12, 16) : 0;
    const directionScore = scoreDirection(direction, changePct);

    const watchBonus = aggressiveAccounts.length > 0 ? 2 : 0;
    const rankBonus = rankingRow?.rank ? Math.max(0, 10 - Math.floor((rankingRow.rank - 1) / 8)) : 0;

    const finalScore = clamp(
      Math.round(18 + themeScore + volumeScore + changeScore + directionScore + watchBonus + rankBonus),
      1,
      99,
    );

    const stance = toDefaultStance(direction, finalScore);
    const confidence = toConfidenceLabel(finalScore);

    const accountHintsFromSignal = unique(toList(best?.signal?.targetAccounts));
    const categoryHints = CATEGORY_BY_CODE[code] ?? {};
    const accountHintsFromCategory = accountKeys.filter((key) => categoryHints[key]);

    let targetAccounts = unique([
      ...accountHintsFromSignal,
      ...accountHintsFromCategory,
      ...(aggressiveAccounts.length > 0 ? aggressiveAccounts : accountKeys.slice(0, 1)),
    ]);

    if (stance === "trim") {
      const holdingAccounts = accountKeys.filter((key) => holdingsByAccount.get(key)?.has(code));
      if (holdingAccounts.length > 0) {
        targetAccounts = holdingAccounts;
      }
    }

    if (targetAccounts.length === 0 && accountKeys.length > 0) {
      targetAccounts = [accountKeys[0]];
    }

    scored.push({
      code,
      name: etf?.name ?? code,
      stance,
      target_accounts: targetAccounts,
      horizon: stance === "trim" ? "1m" : "3m",
      confidence,
      thesis: buildThemeWhy(best?.signal, rankingRow),
      risks: unique([
        "테마 모멘텀 둔화",
        "정책/매크로 방향 반전",
        stance === "trim" ? "반등 시 기회비용" : "단기 과열 변동성",
      ]).slice(0, 3),
      impact_chain: best?.signal?.signalType === "strategy_change" ? "thematic_2nd_order" : "direct",
      invalidation_trigger: buildInvalidation(best?.signal),
      _meta: {
        finalScore,
        themeScore: Math.round(themeScore),
        volumeScore,
        changeScore,
        direction,
        rankingRank: rankingRow?.rank ?? null,
      },
    });
  }

  return scored
    .sort((left, right) => (right._meta?.finalScore ?? 0) - (left._meta?.finalScore ?? 0))
    .slice(0, 12)
    .map((item) => {
      const { _meta, ...publicItem } = item;
      return publicItem;
    });
}

function mergeCandidateScores(stage2Data, generatedCandidates, mapByCode) {
  const generatedByCode = new Map(generatedCandidates.map((item) => [item.code, item]));

  const originalResolved = toList(stage2Data?.candidate_scores).filter((item) => isSecurityCode(item?.code));

  // 원본에서 이미 숫자 코드인 종목/ETF 중, 생성 ETF와 코드가 겹치지 않는 항목은 보존
  const keptOriginal = originalResolved.filter((item) => !generatedByCode.has(String(item.code).trim()));

  // 원본의 theme placeholder는 Stage 2.5에서 해소되므로 제외
  const merged = [...generatedCandidates, ...keptOriginal]
    .map((item) => ({
      ...item,
      code: String(item.code).trim(),
      name: String(item.name ?? item.code ?? "").trim(),
    }))
    .filter((item) => isSecurityCode(item.code) || !mapByCode.has(item.code))
    .slice(0, 14);

  return merged;
}

function resolveAccountActionOverrides(stage2Data, mergedCandidates, portfolio) {
  const accountKeys = toList(portfolio?.accounts)
    .map((account) => String(account?.key ?? "").trim())
    .filter(Boolean);

  const byAccount = new Map(accountKeys.map((key) => [key, []]));
  for (const candidate of mergedCandidates) {
    for (const key of toList(candidate?.target_accounts)) {
      if (!byAccount.has(key)) continue;
      byAccount.get(key).push(candidate);
    }
  }

  const mergedActions = toList(stage2Data?.account_actions).map((action) => {
    const key = String(action?.account_key ?? "").trim();
    const linked = byAccount.get(key) ?? [];

    const buyFromLinked = linked
      .filter((item) => item.stance === "buy")
      .map((item) => item.code)
      .slice(0, 3);

    const trimFromLinked = linked
      .filter((item) => item.stance === "trim")
      .map((item) => item.code)
      .slice(0, 3);

    const holdFromLinked = linked
      .filter((item) => ["hold", "watch"].includes(item.stance))
      .map((item) => item.code)
      .slice(0, 3);

    const buyFallback = toList(action?.buy_candidates).filter((item) => isSecurityCode(item));
    const trimFallback = toList(action?.trim_candidates).filter((item) => isSecurityCode(item));
    const holdFallback = toList(action?.hold_candidates).filter((item) => isSecurityCode(item));

    return {
      ...action,
      buy_candidates: unique([...buyFromLinked, ...buyFallback]).slice(0, 3),
      trim_candidates: unique([...trimFromLinked, ...trimFallback]).slice(0, 3),
      hold_candidates: unique([...holdFromLinked, ...holdFallback]).slice(0, 3),
    };
  });

  // stage2 account_actions가 비어 있으면 계좌별 기본 액션 생성
  if (mergedActions.length === 0) {
    return accountKeys.map((key) => {
      const linked = (byAccount.get(key) ?? []).slice(0, 6);
      return {
        account_key: key,
        bias: "selective_add",
        rationale: "Stage 2.5 ETF 매칭 결과를 기반으로 계좌별 후보를 재구성했습니다.",
        buy_candidates: linked.filter((item) => item.stance === "buy").map((item) => item.code).slice(0, 3),
        trim_candidates: linked.filter((item) => item.stance === "trim").map((item) => item.code).slice(0, 3),
        hold_candidates: linked.filter((item) => ["hold", "watch"].includes(item.stance)).map((item) => item.code).slice(0, 3),
        reserve_cash_note: "분할 진입과 리스크 한도 내 집행을 유지합니다.",
      };
    });
  }

  return mergedActions;
}

async function main() {
  const args = parseStage2_5Args(process.argv.slice(2));

  const stateDir = path.join(ROOT_DIR, "data", "analysis-state", args.date);
  const stage2InputPath = asPathOrDefault(args.stage2Input, path.join(stateDir, "stage2-strategy-options.json"));
  const rankingInputPath = asPathOrDefault(
    args.rankingInput,
    path.join(ROOT_DIR, "data", "external", "kis-etf", args.date, "etf-ranking.json"),
  );
  const mapInputPath = asPathOrDefault(
    args.mapInput,
    path.join(ROOT_DIR, "data", "reference", "stockeasy-theme-etf-map.json"),
  );
  const outputPath = asPathOrDefault(args.output, path.join(stateDir, "stage2-5-etf-candidates.json"));
  const enrichedOutputPath = asPathOrDefault(
    args.enrichedOutput,
    path.join(stateDir, "stage2-strategy-options.enriched.json"),
  );

  const [stage2DataRaw, rankingData, mapData, portfolio] = await Promise.all([
    readJson(stage2InputPath, null),
    readJson(rankingInputPath, { etfs: [] }),
    readJson(mapInputPath, { etfs: [] }),
    readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), { accounts: [] }),
  ]);

  if (!stage2DataRaw) {
    throw new Error(`stage2 입력 파일이 없습니다: ${stage2InputPath}`);
  }

  const mapEtfs = toList(mapData?.etfs);
  const mapByCode = new Map(mapEtfs.map((item) => [String(item?.code ?? ""), item]));

  const rankingRows = toList(rankingData?.etfs)
    .map((item) => ({
      ...item,
      code: String(item?.code ?? "").trim(),
      changePct: Number(item?.changePct ?? 0),
      volume: Number(item?.volume ?? 0),
      rank: Number(item?.rank ?? 0),
    }))
    .filter((item) => isSecurityCode(item.code));

  const generatedCandidates = buildCandidates({
    stage2Data: stage2DataRaw,
    mapEtfs,
    rankingRows,
    portfolio,
  });

  const mergedCandidateScores = mergeCandidateScores(stage2DataRaw, generatedCandidates, mapByCode);
  const mergedAccountActions = resolveAccountActionOverrides(stage2DataRaw, mergedCandidateScores, portfolio);

  const enrichedStage2 = {
    ...stage2DataRaw,
    candidate_scores: mergedCandidateScores,
    account_actions: mergedAccountActions,
    stage2_5: {
      enabled: true,
      source: "stage2-5-etf-candidates",
      generatedAt: new Date().toISOString(),
      input: {
        stage2: stage2InputPath,
        ranking: rankingInputPath,
        map: mapInputPath,
      },
      generatedCount: generatedCandidates.length,
      mergedCount: mergedCandidateScores.length,
    },
  };

  const outputPayload = {
    date: args.date,
    source: "stage2-5-etf-candidates",
    generatedAt: new Date().toISOString(),
    inputs: {
      stage2: stage2InputPath,
      ranking: rankingInputPath,
      map: mapInputPath,
    },
    stats: {
      mapEtfCount: mapEtfs.length,
      rankingCount: rankingRows.length,
      generatedCount: generatedCandidates.length,
      mergedCandidateCount: mergedCandidateScores.length,
    },
    generated_candidates: generatedCandidates,
    merged_candidate_scores: mergedCandidateScores,
    merged_account_actions: mergedAccountActions,
    enriched_stage2_path: enrichedOutputPath,
  };

  await Promise.all([
    writeJson(outputPath, outputPayload),
    writeJson(enrichedOutputPath, enrichedStage2),
  ]);

  console.log(outputPath);
  console.log(enrichedOutputPath);
}

main().catch((error) => {
  console.error(`stage2.5 ETF 후보 생성 실패: ${error.message}`);
  process.exit(1);
});
