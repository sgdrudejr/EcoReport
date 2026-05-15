#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  parseDateArgs,
  readJson,
  readText,
  writeText,
} from "./lib/pipeline-utils.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compact(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value, limit = 220) {
  const text = compact(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function formatAmount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function inlineMarkdownToHtml(value) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:-]+\|[\s|:-]*\s*$/.test(line);
}

function renderMarkdownTable(lines, startIndex) {
  const tableLines = [];
  let index = startIndex;
  while (index < lines.length && lines[index].trim().startsWith("|")) {
    tableLines.push(lines[index].trim());
    index += 1;
  }
  if (tableLines.length < 2 || !isTableSeparator(tableLines[1])) {
    return null;
  }

  const rows = tableLines
    .filter((line, rowIndex) => rowIndex !== 1)
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => inlineMarkdownToHtml(cell.trim())),
    );
  const [head, ...body] = rows;
  const headerHtml = `<thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>`;
  const bodyHtml = `<tbody>${body
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("")}</tbody>`;
  return {
    html: `<div class="table-wrap"><table>${headerHtml}${bodyHtml}</table></div>`,
    nextIndex: index,
  };
}

function markdownToHtml(markdown, { skipH1 = false } = {}) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let inUl = false;
  let inOl = false;

  function closeLists() {
    if (inUl) {
      output.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      output.push("</ol>");
      inOl = false;
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    if (line.trim().startsWith("|")) {
      const table = renderMarkdownTable(lines, index);
      if (table) {
        closeLists();
        output.push(table.html);
        index = table.nextIndex - 1;
        continue;
      }
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      if (skipH1 && level === 1) continue;
      output.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^- (.+)$/);
    if (unordered) {
      if (inOl) {
        output.push("</ol>");
        inOl = false;
      }
      if (!inUl) {
        output.push("<ul>");
        inUl = true;
      }
      output.push(`<li>${inlineMarkdownToHtml(unordered[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (inUl) {
        output.push("</ul>");
        inUl = false;
      }
      if (!inOl) {
        output.push("<ol>");
        inOl = true;
      }
      output.push(`<li>${inlineMarkdownToHtml(ordered[1])}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeLists();
      continue;
    }

    closeLists();
    output.push(`<p>${inlineMarkdownToHtml(line)}</p>`);
  }

  closeLists();
  return output.join("\n");
}

function splitH2Sections(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = { title: "개요", lines: [] };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      if (current.lines.join("\n").trim()) sections.push(current);
      current = { title: h2[1].trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.join("\n").trim()) sections.push(current);
  return sections;
}

function atomScore(atom) {
  const novelty = typeof atom?.novelty_score === "number" ? atom.novelty_score : 0;
  const conviction = typeof atom?.conviction_score === "number" ? atom.conviction_score : 0;
  return novelty * 0.55 + conviction * 0.45;
}

function renderInsightItem(item) {
  const entity = escapeHtml(item?.entity ?? item?.title ?? "insight");
  const claim = escapeHtml(truncate(item?.claim, 240));
  const score = atomScore(item);
  const evidence = Array.isArray(item?.evidence) ? item.evidence.slice(0, 3).join(", ") : item?.report_id;
  return [
    '<article class="insight-item">',
    `  <div class="insight-head"><strong>${entity}</strong>${score ? `<span>${score.toFixed(2)}</span>` : ""}</div>`,
    `  <p>${claim}</p>`,
    evidence ? `  <small>근거: ${escapeHtml(evidence)}</small>` : "",
    "</article>",
  ].join("\n");
}

function cardLookupKey(accountKey, item, sourceAction = null) {
  const id = item?.code ?? item?.name ?? "-";
  return `${accountKey}:${id}${sourceAction ? `:${sourceAction}` : ""}`;
}

const DECISION_LABELS = {
  BUY_NOW: "즉시매수",
  CONDITIONAL_BUY: "조건매수",
  BLOCKED_BUY: "매수제외",
  HOLD_KEEP: "보유유지",
  HOLD_PROTECT: "수익보호",
  TRIM_REVIEW: "감량검토",
  WATCH_ADD: "추가관찰",
  WATCH_OFF_REPORT: "리포트밖",
  WATCH_TRIM: "감량관찰",
  WATCH_RISK: "위험관찰",
  WATCH_DATA: "자료보강",
  BUY: "매수후보",
  TRIM: "감량검토",
  HOLD: "보유",
  WATCH: "관찰",
  NO_ACTION: "실행없음",
};

function decisionLabel(card, fallback) {
  if (card?.decisionBucket === "WATCH_OFF_REPORT" && card?.externalCoverage?.available) {
    return card.decisionLabel ?? "외부관찰";
  }
  return DECISION_LABELS[card?.decisionBucket] ?? DECISION_LABELS[fallback] ?? card?.decisionLabel ?? fallback ?? "-";
}

function buildHoldingCardIndex(holdingCards) {
  const index = new Map();
  for (const card of holdingCards?.cards ?? []) {
    const item = { code: card.code, name: card.name };
    index.set(cardLookupKey(card.accountKey, item, card.sourceAction), card);
    if (!index.has(cardLookupKey(card.accountKey, item))) {
      index.set(cardLookupKey(card.accountKey, item), card);
    }
  }
  return index;
}

function findHoldingCard(cardIndex, plan, item, sourceAction) {
  return cardIndex.get(cardLookupKey(plan.key, item, sourceAction)) ?? cardIndex.get(cardLookupKey(plan.key, item)) ?? null;
}

function cardPrimaryReason(card, fallback) {
  if (card?.decisionBucket === "HOLD_KEEP") {
    return card.thesis ?? card?.holdingRole?.keepRule ?? fallback ?? "-";
  }
  return (
    card?.addConditions?.[0] ??
    card?.trimConditions?.[0] ??
    card?.holdingRole?.keepRule ??
    card?.blockedBuyReason ??
    card?.thesis ??
    fallback ??
    "-"
  );
}

function renderActionRows(plan, cardIndex = new Map()) {
  const rows = [];
  for (const item of plan.stagedBuys ?? []) {
    const card = findHoldingCard(cardIndex, plan, item, "BUY");
    const action = card?.decisionBucket ?? "BUY";
    rows.push({
      action,
      actionLabel: decisionLabel(card, "BUY"),
      tone: decisionTone(action),
      name: item.name,
      amount: item.suggestedAmount,
      urgency: card?.reportCoverage?.statusLabel ?? item.urgency,
      reason: cardPrimaryReason(card, item.reason),
    });
  }
  for (const item of plan.trims ?? []) {
    const card = findHoldingCard(cardIndex, plan, item, "TRIM");
    const action = card?.decisionBucket ?? "TRIM";
    rows.push({
      action,
      actionLabel: decisionLabel(card, "TRIM"),
      tone: decisionTone(action),
      name: item.name,
      amount: null,
      urgency: card?.reportCoverage?.statusLabel ?? "trim",
      reason: cardPrimaryReason(card, item.reason),
    });
  }
  for (const item of plan.holds ?? []) {
    const card = findHoldingCard(cardIndex, plan, item, "HOLD");
    const action = card?.decisionBucket ?? "HOLD";
    rows.push({
      action,
      actionLabel: decisionLabel(card, "HOLD"),
      tone: decisionTone(action),
      name: item.name,
      amount: null,
      urgency: card?.reportCoverage?.statusLabel ?? "hold",
      reason: cardPrimaryReason(card, item.reason),
    });
  }
  for (const item of plan.watches ?? []) {
    const card = findHoldingCard(cardIndex, plan, item, "WATCH");
    const action = card?.decisionBucket ?? "WATCH";
    rows.push({
      action,
      actionLabel: decisionLabel(card, "WATCH"),
      tone: decisionTone(action),
      name: item.name,
      amount: null,
      urgency: card?.reportCoverage?.statusLabel ?? "watch",
      reason: cardPrimaryReason(card, item.reason),
    });
  }
  if (!rows.length) {
    rows.push({ action: "NO_ACTION", actionLabel: DECISION_LABELS.NO_ACTION, tone: "none", name: "-", amount: null, urgency: "-", reason: plan.noActionReason ?? "실행 계획 없음" });
  }
  return rows;
}

function renderAccountPlan(plan, cardIndex = new Map()) {
  const actionRows = renderActionRows(plan, cardIndex);
  const topBuy = (plan.stagedBuys ?? [])[0];
  const flags = plan.validatorFlags?.length ? plan.validatorFlags.join(", ") : "없음";
  return [
    '<section class="account-card">',
    '  <div class="account-head">',
    `    <div><h3>${escapeHtml(plan.label)} <span>${escapeHtml(plan.key)}</span></h3><p>${escapeHtml(plan.macroCommentary?.actionLine ?? "")}</p></div>`,
    `    <strong>${escapeHtml(String(plan.totalScore ?? "-"))}점</strong>`,
    "  </div>",
    '  <div class="account-metrics">',
    `    <div><span>투입 가능</span><strong>${formatAmount(plan.deployBudget ?? plan.plannedDeployBudget)}</strong></div>`,
    `    <div><span>남길 예수금</span><strong>${formatAmount(plan.reserveCash)}</strong></div>`,
    `    <div><span>부족 자산군</span><strong>${escapeHtml(plan.topGap?.category ?? "없음")}</strong></div>`,
    `    <div><span>우선 후보</span><strong>${escapeHtml(topBuy?.name ?? plan.candidateFromGap ?? "no_action")}</strong></div>`,
    "  </div>",
    '  <div class="table-wrap">',
    "    <table>",
    "      <thead><tr><th>판정</th><th>종목</th><th>금액</th><th>상태</th><th>핵심 근거</th></tr></thead>",
    "      <tbody>",
    ...actionRows.map((row) =>
      `        <tr><td><span class="badge ${row.tone}">${escapeHtml(row.actionLabel ?? row.action)}</span></td><td>${escapeHtml(row.name ?? "-")}</td><td>${formatAmount(row.amount)}</td><td>${escapeHtml(row.urgency ?? "-")}</td><td>${escapeHtml(row.reason ?? "-")}</td></tr>`,
    ),
    "      </tbody>",
    "    </table>",
    "  </div>",
    '  <details class="detail-box">',
    "    <summary>검증 플래그와 제외 후보</summary>",
    `    <p><strong>validator:</strong> ${escapeHtml(flags)}</p>`,
    plan.rejectedAlternatives?.length
      ? `    <ul>${plan.rejectedAlternatives.map((item) => `<li>${escapeHtml(item.name ?? "-")} - ${escapeHtml(item.rejectionReason ?? "")}</li>`).join("")}</ul>`
      : "    <p>제외된 대안 없음</p>",
    "  </details>",
    "</section>",
  ].join("\n");
}

function renderReportSections(markdown) {
  const sections = splitH2Sections(markdown)
    .filter((section) => !/^개요$/.test(section.title));
  return sections
    .map((section, index) => {
      const open = index <= 2 ? " open" : "";
      return [
        `<details class="report-section"${open}>`,
        `  <summary>${escapeHtml(section.title)}</summary>`,
        '  <div class="markdown-body">',
        markdownToHtml(section.lines.join("\n"), { skipH1: true })
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n"),
        "  </div>",
        "</details>",
      ].join("\n");
    })
    .join("\n");
}

function renderSystemHealth(systemHealth) {
  const warnings = (systemHealth?.checks ?? []).filter((item) => item.status !== "ok");
  if (!warnings.length) {
    return '<span class="health ok">OK</span><p>검증 경고 없음</p>';
  }
  return [
    '<span class="health warn">WARN</span>',
    "<ul>",
    ...warnings.map((item) => `<li><strong>${escapeHtml(item.key)}</strong>: ${escapeHtml(item.detail ?? item.status)}</li>`),
    "</ul>",
  ].join("\n");
}

function renderDataQuality(dataQuality) {
  if (!dataQuality) {
    return '<span class="health warn">WARN</span><p>data-quality-audit.json을 찾을 수 없습니다. 최종 실행 전 `npm run audit:data`를 실행하세요.</p>';
  }
  const status = dataQuality.overallStatus ?? "warn";
  const checks = (dataQuality.checks ?? []).filter((item) => item.status !== "ok");
  const benchmarkCheck = (dataQuality.checks ?? []).find((item) => item.key === "benchmark_pattern_alignment");
  const riskyClaims = dataQuality.riskyClaims ?? [];
  return [
    `<span class="health ${escapeHtml(status === "ok" ? "ok" : status === "error" ? "error" : "warn")}">${escapeHtml(status.toUpperCase())}</span>`,
    `<p>실행 후보 노출 정책: <strong>${escapeHtml(dataQuality.guardrails?.executionBuyPolicy ?? "validated_only")}</strong>. 위험 claim은 전체 재요약 없이 작은 프롬프트로만 재검토합니다.</p>`,
    benchmarkCheck
      ? [
          '<h3>AI 리서치 벤치마크 적용</h3>',
          `<div class="quality-grid"><div class="quality-item ${escapeHtml(benchmarkCheck.status)}"><strong>${escapeHtml(benchmarkCheck.key)}</strong><span>${escapeHtml(benchmarkCheck.detail ?? benchmarkCheck.status)}</span></div></div>`,
        ].join("\n")
      : "",
    checks.length
      ? `<div class="quality-grid">${checks
          .map(
            (item) =>
              `<div class="quality-item ${escapeHtml(item.status)}"><strong>${escapeHtml(item.key)}</strong><span>${escapeHtml(item.detail ?? item.status)}</span></div>`,
          )
          .join("")}</div>`
      : '<p>품질 게이트 경고 없음</p>',
    riskyClaims.length
      ? [
          '<h3>경고/보류/근거 약함 Claim</h3>',
          '<div class="risk-list">',
          ...riskyClaims.slice(0, 8).map(
            (item) =>
              `<div class="risk-item"><strong>[${escapeHtml(item.severity ?? "warn")}] ${escapeHtml(item.id ?? "")}</strong><p>${escapeHtml(item.claim ?? "")}</p><small>${escapeHtml((item.reasons ?? []).join(", "))}</small></div>`,
          ),
          "</div>",
          `<p class="muted">Mini review prompt: ${escapeHtml(dataQuality.aiReviewPromptPath ?? "-")}</p>`,
        ].join("\n")
      : '<p>위험 claim 없음</p>',
  ].join("\n");
}

function decisionTone(bucket) {
  if (["BUY_NOW", "CONDITIONAL_BUY", "WATCH_ADD"].includes(bucket)) return "buy";
  if (["TRIM_REVIEW", "WATCH_TRIM", "WATCH_RISK", "HOLD_PROTECT"].includes(bucket)) return "trim";
  if (["BLOCKED_BUY", "WATCH_DATA", "WATCH_OFF_REPORT"].includes(bucket)) return "watch";
  if (bucket === "HOLD_KEEP") return "hold";
  return "none";
}

function renderHoldingDecisionCards(holdingCards) {
  if (!holdingCards?.cards?.length) {
    return '<p class="muted">보유종목 판단 카드가 아직 생성되지 않았습니다. `npm run stage4.5:holding-cards -- --date <date>`를 실행하면 이 섹션이 채워집니다.</p>';
  }
  const summary = holdingCards.summary ?? {};
  const counts = summary.counts ?? {};
  const cards = holdingCards.cards ?? [];
  const priorityCards = [
    ...cards.filter((card) => ["BUY_NOW", "CONDITIONAL_BUY", "WATCH_ADD"].includes(card.decisionBucket)),
    ...cards.filter((card) => ["TRIM_REVIEW", "HOLD_PROTECT", "WATCH_TRIM", "WATCH_RISK"].includes(card.decisionBucket)),
    ...cards.filter((card) => card.decisionBucket === "WATCH_OFF_REPORT"),
    ...cards.filter((card) => card.decisionBucket === "BLOCKED_BUY"),
    ...cards.filter((card) => card.decisionBucket === "WATCH_DATA"),
    ...cards.filter((card) => card.decisionBucket === "HOLD_KEEP"),
  ].slice(0, 18);
  const blocked = cards.filter((card) => card.decisionBucket === "BLOCKED_BUY").slice(0, 6);
  const offReport = cards.filter((card) => card.decisionBucket === "WATCH_OFF_REPORT").slice(0, 8);

  return [
    '<div class="decision-summary">',
    `  <div><span>즉시 실행</span><strong>${escapeHtml(String(counts.immediateBuy ?? 0))}</strong></div>`,
    `  <div><span>조건부 매수</span><strong>${escapeHtml(String(counts.conditionalBuy ?? 0))}</strong></div>`,
    `  <div><span>차단된 매수</span><strong>${escapeHtml(String(counts.blockedBuy ?? 0))}</strong></div>`,
    `  <div><span>감량/보호</span><strong>${escapeHtml(String(counts.trimOrProtect ?? 0))}</strong></div>`,
    `  <div><span>리포트 밖 보유</span><strong>${escapeHtml(String(counts.offReportHoldings ?? 0))}</strong></div>`,
    `  <div><span>데이터 보강</span><strong>${escapeHtml(String(counts.dataNeeds ?? 0))}</strong></div>`,
    "</div>",
    '<div class="table-wrap">',
    "  <table>",
    "    <thead><tr><th>계좌</th><th>판정</th><th>종목</th><th>점수</th><th>조건</th><th>다음 점검</th></tr></thead>",
    "    <tbody>",
    ...priorityCards.map((card) => {
      const condition =
        card.addConditions?.[0] ??
        card.trimConditions?.[0] ??
        card.holdingRole?.keepRule ??
        card.blockedBuyReason ??
        card.thesis ??
        "-";
      return `      <tr><td>${escapeHtml(card.accountLabel)}</td><td><span class="badge ${decisionTone(card.decisionBucket)}">${escapeHtml(decisionLabel(card, card.decisionBucket))}</span></td><td>${escapeHtml(card.name)}</td><td>${escapeHtml(card.score ?? "-")}</td><td>${escapeHtml(truncate(condition, 120))}</td><td>${escapeHtml(card.nextReview ?? "-")}</td></tr>`;
    }),
    "    </tbody>",
    "  </table>",
    "</div>",
    offReport.length
      ? [
          '<details class="detail-box" open>',
          "  <summary>리포트 밖 보유종목의 계좌 역할</summary>",
          "  <ul>",
          ...offReport.map((card) => {
            const notes = card.holdingRole?.evidenceNotes?.slice(0, 3).join(" / ") || card.thesis || "-";
            return `<li><strong>${escapeHtml(card.accountLabel)} / ${escapeHtml(card.name)}</strong>: ${escapeHtml(card.holdingRole?.role ?? "보유 역할 미정")}<br><small>${escapeHtml(truncate(notes, 180))}</small></li>`;
          }),
          "  </ul>",
          "</details>",
        ].join("\n")
      : "",
    blocked.length
      ? [
          '<details class="detail-box" open>',
          "  <summary>차단된 매수 후보와 해제 조건</summary>",
          "  <ul>",
          ...blocked.map(
            (card) =>
              `<li><strong>${escapeHtml(card.accountLabel)} / ${escapeHtml(card.name)}</strong>: ${escapeHtml(card.blockedBuyReason ?? "차단 사유 없음")}</li>`,
          ),
          "  </ul>",
          "</details>",
        ].join("\n")
      : "",
  ].join("\n");
}

function renderRotationWatch(rotationWatch) {
  if (!rotationWatch) {
    return '<p class="muted">3주 로테이션 감지판이 아직 생성되지 않았습니다. `npm run features:rotation-watch -- --date <date>`를 실행하면 이 섹션이 채워집니다.</p>';
  }
  const marketTrend = rotationWatch.marketTrend ?? {};
  const implications = rotationWatch.portfolioImplications ?? {};
  const rotationTargets = rotationWatch.rotationTargets ?? {};
  const transitionTriggerBoard = rotationWatch.transitionTriggerBoard ?? {};
  const sectorRotation = rotationWatch.sectorRotation ?? [];
  const sectorDeliberations = rotationWatch.sectorDeliberations ?? [];
  const sectorUniverse = rotationWatch.stockeasySectorUniverse ?? [];
  const topThemes = rotationWatch.themeRotation ?? [];
  const reduceFirst = implications.reduceFirst ?? [];
  const scenarios = rotationWatch.scenarioPlaybook ?? [];
  return [
    '<div class="decision-summary">',
    `  <div><span>시장 모드</span><strong>${escapeHtml(rotationWatch.summary?.mode ?? marketTrend.mode ?? "-")}</strong></div>`,
    `  <div><span>대응</span><strong>${escapeHtml(rotationWatch.summary?.stance ?? implications.stance ?? "-")}</strong></div>`,
    `  <div><span>관측일</span><strong>${escapeHtml(String(rotationWatch.includedDates?.length ?? 0))}</strong></div>`,
    `  <div><span>현재 RSI</span><strong>${escapeHtml(String(marketTrend.currentRsi ?? "-"))}</strong></div>`,
    "</div>",
    `<p>${escapeHtml(rotationWatch.summary?.headline ?? "로테이션 감지판 요약 없음")}</p>`,
    rotationTargets.watch?.length
      ? [
          '<h3>앞으로 유심히 볼 섹터</h3>',
          `<p><strong>${escapeHtml(rotationTargets.summary?.answer ?? "-")}</strong></p>`,
          `<p>${escapeHtml(rotationTargets.summary?.switchRule ?? "-")}</p>`,
          '<div class="table-wrap">',
          "  <table>",
          "    <thead><tr><th>우선</th><th>섹터</th><th>지금 행동</th><th>현재판정</th><th>교차검증</th><th>전환 조건</th><th>무효 조건</th></tr></thead>",
          "    <tbody>",
          ...rotationTargets.watch.slice(0, 6).map(
            (item) =>
              `      <tr><td>${escapeHtml(item.priority ?? "-")}</td><td>${escapeHtml(item.sector ?? "-")}</td><td><span class="badge ${item.tone === "green" ? "buy" : item.tone === "red" ? "trim" : item.tone === "amber" ? "watch" : "none"}">${escapeHtml(item.action ?? "-")}</span></td><td>${escapeHtml(item.verdict ?? "-")}</td><td>${escapeHtml(`${item.sourceConsensus?.label ?? "-"} / ${truncate(item.sourceConsensus?.supportSummary ?? item.sourceConsensus?.detail ?? "-", 80)}`)}</td><td>${escapeHtml(truncate(item.switchWhen ?? "-", 150))}</td><td>${escapeHtml(truncate(item.invalidation ?? "-", 120))}</td></tr>`,
          ),
          "    </tbody>",
          "  </table>",
          "</div>",
        ].join("\n")
      : "",
    transitionTriggerBoard.rows?.length
      ? [
          '<h3>전환 트리거 보드</h3>',
          `<p>${escapeHtml(transitionTriggerBoard.summary ?? "차트/뉴스/교차소스 트리거를 확인합니다.")}</p>`,
          '<div class="table-wrap">',
          "  <table>",
          "    <thead><tr><th>트리거</th><th>섹터</th><th>현재판정</th><th>차트</th><th>뉴스</th><th>들어갈 조건</th><th>막는 조건</th></tr></thead>",
          "    <tbody>",
          ...transitionTriggerBoard.rows.slice(0, 8).map(
            (item) =>
              `      <tr><td><span class="badge ${item.tone === "green" ? "buy" : item.tone === "red" ? "trim" : item.tone === "amber" ? "watch" : "none"}">${escapeHtml(item.label ?? "-")}</span></td><td>${escapeHtml(item.sector ?? "-")}</td><td>${escapeHtml(item.verdict ?? "-")}</td><td>${escapeHtml(`${item.chart?.label ?? "-"} / ${truncate(item.chart?.detail ?? "-", 80)}`)}</td><td>${escapeHtml(`${item.news?.label ?? "-"} / ${truncate(item.news?.headlines?.[0]?.title ?? item.news?.detail ?? "-", 80)}`)}</td><td>${escapeHtml(truncate((item.entryChecklist ?? []).slice(0, 3).join(" / ") || "-", 130))}</td><td>${escapeHtml(truncate((item.exitChecklist ?? []).slice(0, 3).join(" / ") || "-", 130))}</td></tr>`,
          ),
          "    </tbody>",
          "  </table>",
          "</div>",
        ].join("\n")
      : "",
    rotationTargets.excluded?.length
      ? [
          '<details class="detail-box" open>',
          "  <summary>지금 전환 제외</summary>",
          "  <ul>",
          ...rotationTargets.excluded.slice(0, 6).map(
            (item) => `<li><strong>${escapeHtml(item.sector ?? "-")}</strong>: ${escapeHtml(item.verdict ?? "-")} / ${escapeHtml(item.invalidation ?? "-")}</li>`,
          ),
          "  </ul>",
          "</details>",
        ].join("\n")
      : "",
    sectorRotation.length
      ? [
          '<h3>신규·강화 섹터 후보</h3>',
          '<div class="table-wrap">',
          "  <table>",
          "    <thead><tr><th>상태</th><th>섹터</th><th>하위테마</th><th>변화</th><th>판단</th></tr></thead>",
          "    <tbody>",
          ...sectorRotation.slice(0, 7).map(
            (item) =>
              `      <tr><td><span class="badge ${item.tone === "red" ? "trim" : item.tone === "green" ? "buy" : item.tone === "amber" ? "watch" : "none"}">${escapeHtml(item.status ?? "-")}</span></td><td>${escapeHtml(item.sector ?? "-")}</td><td>${escapeHtml((item.themes ?? []).map((theme) => theme.theme).slice(0, 3).join(", ") || "-")}</td><td>${escapeHtml(String(item.momentum ?? "-"))}</td><td>${escapeHtml(truncate(item.note ?? "-", 120))}</td></tr>`,
          ),
          "    </tbody>",
          "  </table>",
          "</div>",
        ].join("\n")
      : "",
    sectorDeliberations.length
      ? [
          '<h3>섹터 자기질문</h3>',
          '<div class="table-wrap">',
          "  <table>",
          "    <thead><tr><th>판정</th><th>섹터</th><th>질문</th><th>교차검증</th><th>상승 근거</th><th>하방 의심</th><th>결론</th></tr></thead>",
          "    <tbody>",
          ...sectorDeliberations.slice(0, 8).map(
            (item) =>
              `      <tr><td><span class="badge ${item.tone === "red" ? "trim" : item.tone === "green" ? "buy" : item.tone === "amber" ? "watch" : "none"}">${escapeHtml(item.verdict ?? "-")}</span></td><td>${escapeHtml(item.sector ?? "-")}</td><td>${escapeHtml(truncate(item.question ?? "-", 90))}</td><td>${escapeHtml(`${item.sourceConsensus?.label ?? "-"} / ${truncate(item.sourceConsensus?.supportSummary ?? item.sourceConsensus?.detail ?? "-", 80)}`)}</td><td>${escapeHtml(truncate(item.bullCase?.[0] ?? "-", 120))}</td><td>${escapeHtml(truncate(item.bearCase?.[0] ?? "-", 120))}</td><td>${escapeHtml(truncate(item.finalAnswer ?? "-", 130))}</td></tr>`,
          ),
          "    </tbody>",
          "  </table>",
          "</div>",
        ].join("\n")
      : "",
    sectorUniverse.length
        ? [
          '<details class="detail-box" open>',
          "  <summary>StockEasy 베이스 레이더</summary>",
          "  <ul>",
          ...sectorUniverse.slice(0, 12).map(
            (item) =>
              `<li><strong>${escapeHtml(item.sector ?? "-")}</strong>: 등락 ${escapeHtml(String(item.changePct ?? "-"))}% / 신호 ${escapeHtml(String(item.signal ?? "-"))} / RS ${escapeHtml(String(item.rsScore ?? "-"))}<br><small>${escapeHtml((item.leaders ?? []).map((leader) => leader.name).slice(0, 3).join(" · ") || "대표 종목 확인 필요")}</small></li>`,
          ),
          "  </ul>",
          "</details>",
        ].join("\n")
      : "",
    '<div class="table-wrap">',
    "  <table>",
    "    <thead><tr><th>상태</th><th>섹터</th><th>테마</th><th>최근점수</th><th>변화</th><th>액션</th><th>이유</th></tr></thead>",
    "    <tbody>",
    ...topThemes.slice(0, 8).map(
      (item) =>
        `      <tr><td><span class="badge ${item.tone === "red" ? "trim" : item.tone === "green" ? "buy" : item.tone === "amber" ? "watch" : "none"}">${escapeHtml(item.status ?? "-")}</span></td><td>${escapeHtml(item.sector ?? "-")}</td><td>${escapeHtml(item.theme ?? "-")}</td><td>${escapeHtml(String(item.recentScore ?? "-"))}</td><td>${escapeHtml(String(item.momentum ?? "-"))}</td><td>${escapeHtml(item.action ?? "-")}</td><td>${escapeHtml(truncate(item.reason ?? "-", 120))}</td></tr>`,
    ),
    "    </tbody>",
    "  </table>",
    "</div>",
    reduceFirst.length
      ? [
          '<details class="detail-box" open>',
          "  <summary>먼저 보호/감량 감시할 보유</summary>",
          "  <ul>",
          ...reduceFirst.slice(0, 8).map(
            (item) =>
              `<li><strong>${escapeHtml(item.name ?? "-")}</strong>: ${escapeHtml(item.verdict ?? "-")} / RSI ${escapeHtml(String(item.rsi ?? "-"))} / 손익 ${escapeHtml(String(item.profitRate ?? "-"))}%<br><small>${escapeHtml(truncate(item.trigger ?? "-", 160))}</small></li>`,
          ),
          "  </ul>",
          "</details>",
        ].join("\n")
      : "",
    scenarios.length
      ? [
          '<details class="detail-box" open>',
          "  <summary>시나리오별 행동</summary>",
          "  <ul>",
          ...scenarios.slice(0, 4).map(
            (item) =>
              `<li><strong>${escapeHtml(item.scenario ?? "-")}</strong>: ${escapeHtml(truncate(item.action ?? "-", 160))}<br><small>트리거: ${escapeHtml(truncate(item.trigger ?? "-", 160))}</small></li>`,
          ),
          "  </ul>",
          "</details>",
        ].join("\n")
      : "",
  ].join("\n");
}

function buildHtml({ date, dailyMarkdown, fullReport, stage4, systemHealth, dataQuality, holdingCards, rotationWatch }) {
  const finalReport = fullReport?.final_report ?? {};
  const presentationSections = finalReport.presentation?.sections ?? {};
  const insightRadar = presentationSections.insight_radar ?? {};
  const topAtoms = [...(insightRadar.signals ?? finalReport.top_insight_atoms ?? [])]
    .filter((item) => ["positive", "mixed", "neutral"].includes(item?.direction ?? "neutral"))
    .sort((left, right) => atomScore(right) - atomScore(left))
    .slice(0, 4);
  const riskAtoms = [...(insightRadar.risks ?? finalReport.risk_atoms ?? [])].sort((left, right) => atomScore(right) - atomScore(left)).slice(0, 3);
  const accountPlans = stage4?.accountPlans ?? [];
  const buyCount = accountPlans.reduce((sum, plan) => sum + (plan.stagedBuys?.length ?? 0), 0);
  const holdingCardIndex = buildHoldingCardIndex(holdingCards);
  const reportCount = finalReport.report_count ?? fullReport?.source_report_count ?? "-";
  const generatedAt = new Date().toISOString();

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EcoReport ${escapeHtml(date)} Final</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --surface: #ffffff;
      --line: #d9e0e8;
      --ink: #111827;
      --muted: #5b6778;
      --teal: #0f766e;
      --blue: #2563eb;
      --amber: #b45309;
      --rose: #be123c;
      --green-bg: #e9f7f3;
      --blue-bg: #eef4ff;
      --amber-bg: #fff7e8;
      --rose-bg: #fff1f2;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.62; }
    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .hero { background: var(--surface); border-bottom: 1px solid var(--line); }
    .hero-inner { max-width: 1180px; margin: 0 auto; padding: 34px 24px 22px; }
    .kicker { color: var(--teal); font-size: 0.82rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { margin: 8px 0 10px; font-size: clamp(2rem, 4vw, 3.4rem); line-height: 1.08; letter-spacing: 0; }
    .lead { max-width: 860px; color: var(--muted); font-size: 1.04rem; margin: 0; }
    .layout { max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 22px; padding: 22px 24px 44px; }
    nav { position: sticky; top: 16px; align-self: start; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
    nav a { display: block; padding: 9px 10px; border-radius: 6px; color: var(--ink); font-size: 0.94rem; }
    nav a:hover { background: #eef2f6; text-decoration: none; }
    main { min-width: 0; }
    .band { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 22px; margin-bottom: 18px; }
    h2 { margin: 0 0 14px; font-size: 1.45rem; line-height: 1.2; letter-spacing: 0; }
    h3 { margin: 0 0 8px; font-size: 1.08rem; line-height: 1.25; letter-spacing: 0; }
    .metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
    .metric { border: 1px solid var(--line); border-radius: 8px; padding: 14px; min-width: 0; }
    .metric span, .account-metrics span { display: block; color: var(--muted); font-size: 0.78rem; margin-bottom: 4px; }
    .metric strong, .account-metrics strong { display: block; font-size: 1.08rem; line-height: 1.2; overflow-wrap: anywhere; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .insight-list { display: grid; gap: 10px; }
    .insight-item { border-left: 4px solid var(--teal); background: #fbfcfd; padding: 12px 13px; border-radius: 0 8px 8px 0; }
    .insight-item p { margin: 6px 0; color: #263241; font-size: 0.94rem; }
    .insight-item small { color: var(--muted); }
    .insight-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .insight-head span { color: var(--teal); font-weight: 800; font-size: 0.86rem; }
    .account-card { border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 12px 0; background: #fff; }
    .account-head { display: flex; justify-content: space-between; gap: 18px; align-items: start; margin-bottom: 12px; }
    .account-head p { margin: 0; color: var(--muted); font-size: 0.94rem; }
    .account-head h3 span { color: var(--muted); font-size: 0.82rem; font-weight: 600; }
    .account-head > strong { font-size: 1.35rem; color: var(--teal); white-space: nowrap; }
    .account-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 12px 0 14px; }
    .account-metrics div { border: 1px solid var(--line); border-radius: 8px; padding: 10px; min-width: 0; }
    .table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; background: #fff; }
    th, td { text-align: left; vertical-align: top; padding: 10px 11px; border-bottom: 1px solid var(--line); }
    th { background: #f1f4f7; color: #334155; font-size: 0.78rem; text-transform: uppercase; }
    tr:last-child td { border-bottom: 0; }
    .badge { display: inline-block; min-width: 58px; text-align: center; border-radius: 999px; padding: 3px 8px; font-size: 0.75rem; font-weight: 800; }
    .buy { color: var(--teal); background: var(--green-bg); }
    .hold { color: var(--blue); background: var(--blue-bg); }
    .watch { color: var(--amber); background: var(--amber-bg); }
    .trim { color: var(--rose); background: var(--rose-bg); }
    .none { color: var(--muted); background: #eef2f6; }
    .detail-box, .report-section { border: 1px solid var(--line); border-radius: 8px; padding: 0; margin-top: 12px; background: #fff; }
    summary { cursor: pointer; font-weight: 800; padding: 13px 14px; }
    .detail-box > p, .detail-box > ul { margin: 0 14px 14px; }
    .markdown-body { padding: 0 16px 16px; }
    .markdown-body h1 { font-size: 1.7rem; }
    .markdown-body h2 { margin-top: 1.2em; }
    .markdown-body h3 { margin-top: 1em; color: #1f2937; }
    .markdown-body p, .markdown-body li { overflow-wrap: anywhere; }
    .markdown-body ul { padding-left: 1.1rem; }
    .health { display: inline-block; border-radius: 999px; padding: 4px 10px; font-size: 0.82rem; font-weight: 800; margin-bottom: 8px; }
    .health.ok { color: var(--teal); background: var(--green-bg); }
    .health.warn { color: var(--amber); background: var(--amber-bg); }
    .health.error { color: var(--rose); background: var(--rose-bg); }
    .quality-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 12px 0 18px; }
    .quality-item { border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-width: 0; }
    .quality-item strong { display: block; margin-bottom: 4px; }
    .quality-item span, .muted { color: var(--muted); font-size: 0.92rem; }
    .quality-item.warn { background: var(--amber-bg); }
    .quality-item.error { background: var(--rose-bg); }
    .quality-item.ok { background: var(--green-bg); }
    .decision-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 14px; }
    .decision-summary div { border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-width: 0; }
    .decision-summary span { display: block; color: var(--muted); font-size: 0.78rem; margin-bottom: 4px; }
    .decision-summary strong { display: block; font-size: 1.25rem; color: var(--ink); }
    .risk-list { display: grid; gap: 10px; }
    .risk-item { border-left: 4px solid var(--amber); background: #fffaf0; padding: 10px 12px; border-radius: 0 8px 8px 0; }
    .risk-item p { margin: 5px 0; }
    .risk-item small { color: var(--muted); }
    .file-list { display: grid; gap: 6px; color: var(--muted); font-size: 0.92rem; }
    footer { color: var(--muted); font-size: 0.86rem; margin-top: 22px; }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; padding: 16px; }
      nav { position: static; display: flex; flex-wrap: wrap; gap: 4px; }
      nav a { padding: 7px 9px; }
      .metrics, .account-metrics, .split, .quality-grid, .decision-summary { grid-template-columns: 1fr; }
      .hero-inner { padding: 28px 16px 18px; }
      .band { padding: 16px; }
    }
    @media print {
      body { background: #fff; }
      nav { display: none; }
      .layout { display: block; padding: 0; max-width: none; }
      .band, .account-card, .hero { border-color: #cbd5e1; break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header class="hero">
    <div class="hero-inner">
      <div class="kicker">EcoReport Final Web View</div>
      <h1>${escapeHtml(date)} 최종 경제 리포트 & 실행 전략</h1>
      <p class="lead">${escapeHtml(truncate(finalReport.one_line ?? "일간 경제 리포트와 계좌별 실행 전략을 하나의 HTML로 통합했습니다.", 360))}</p>
      <div class="metrics">
        <div class="metric"><span>분석 리포트</span><strong>${escapeHtml(reportCount)}건</strong></div>
        <div class="metric"><span>시장 분위기</span><strong>${escapeHtml(finalReport.overall_sentiment ?? "-")}</strong></div>
        <div class="metric"><span>포트폴리오 점수</span><strong>${escapeHtml(String(stage4?.portfolioScore ?? "-"))}점</strong></div>
        <div class="metric"><span>레짐</span><strong>${escapeHtml(stage4?.regime?.name ?? "-")}</strong></div>
      </div>
    </div>
  </header>
  <div class="layout">
    <nav aria-label="페이지 이동">
      <a href="#summary">요약</a>
      <a href="#rotation">로테이션</a>
      <a href="#decision-cards">판단 카드</a>
      <a href="#execution">실행 전략</a>
      <a href="#economy">경제 리포트</a>
      <a href="#quality">품질 경고</a>
      <a href="#health">검증 상태</a>
      <a href="#files">원본 파일</a>
    </nav>
    <main>
      <section id="summary" class="band">
        <h2>요약</h2>
        <div class="split">
          <div>
            <h3>새롭고 강한 신호</h3>
            <div class="insight-list">
              ${topAtoms.map(renderInsightItem).join("\n")}
            </div>
          </div>
          <div>
            <h3>평균에 묻히면 안 되는 리스크</h3>
            <div class="insight-list">
              ${riskAtoms.map(renderInsightItem).join("\n")}
            </div>
          </div>
        </div>
      </section>
      <section id="rotation" class="band">
        <h2>3주 로테이션 감지판</h2>
        <p>최근 2~3주 동안 시장 국면, 주도 테마, 과열·감량 후보가 어떻게 바뀌었는지 별도로 추적합니다.</p>
        ${renderRotationWatch(rotationWatch)}
      </section>
      <section id="decision-cards" class="band">
        <h2>오늘의 판단 카드</h2>
        <p>AI 스택 병목, 과열 신호, 차단 사유, 추가매수/감량 조건을 종목별로 다시 압축한 주문 전 체크리스트입니다.</p>
        ${renderHoldingDecisionCards(holdingCards)}
      </section>
      <section id="execution" class="band">
        <h2>실행 전략</h2>
        <p>계좌별 투입 가능 금액, 부족 자산군, 판정 후보와 검증 플래그를 한 번에 볼 수 있게 정리했습니다. 매수 후보, 보유 유지, 관찰, 매수 제외를 한국어 판정으로 표시합니다.</p>
        ${accountPlans.map((plan) => renderAccountPlan(plan, holdingCardIndex)).join("\n")}
      </section>
      <section id="economy" class="band">
        <h2>읽을 수 있는 경제 리포트</h2>
        <p>아래 섹션은 70개 리포트를 통합한 본문입니다. 처음 세 섹션은 펼쳐두고, 나머지는 필요할 때 열어볼 수 있게 접었습니다.</p>
        ${renderReportSections(dailyMarkdown)}
      </section>
      <section id="quality" class="band">
        <h2>품질 경고</h2>
        ${renderDataQuality(dataQuality)}
      </section>
      <section id="health" class="band">
        <h2>검증 상태</h2>
        ${renderSystemHealth(systemHealth)}
      </section>
      <section id="files" class="band">
        <h2>원본 파일</h2>
        <div class="file-list">
          <div>경제 리포트: knowledge/daily/${escapeHtml(date)}-full-daily-report.md</div>
          <div>AI 교환 JSON: data/analysis-state/${escapeHtml(date)}/stage1-4-ai-exchange.json</div>
          <div>AI 교환 패킷: data/analysis-state/${escapeHtml(date)}/llm-exchange/manifest.json</div>
          <div>품질 감사: data/analysis-state/${escapeHtml(date)}/data-quality-audit.json</div>
          <div>실행 전략: reports/daily/${escapeHtml(date)}-stage4-execution-plan.md</div>
          <div>실행 전략 표: reports/daily/${escapeHtml(date)}-stage4-execution-plan-table.md</div>
          <div>보유 판단 카드: reports/daily/${escapeHtml(date)}-holding-decision-cards.md</div>
          <div>HTML 생성 시각: ${escapeHtml(generatedAt)}</div>
        </div>
      </section>
      <footer>EcoReport static HTML. No external assets, no API calls.</footer>
    </main>
  </div>
</body>
</html>
`;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const dailyMarkdownPath = path.join(ROOT_DIR, "knowledge", "daily", `${args.date}-full-daily-report.md`);
  const fullReportPath = path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage1-4-full-daily-report.json");
  const stage4Path = path.join(ROOT_DIR, "data", "analysis-state", args.date, "stage4-execution-plan.json");
  const holdingCardsPath = path.join(ROOT_DIR, "data", "analysis-state", args.date, "holding-decision-cards.json");
  const systemHealthPath = path.join(ROOT_DIR, "data", "analysis-state", args.date, "system-health.json");
  const dataQualityPath = path.join(ROOT_DIR, "data", "analysis-state", args.date, "data-quality-audit.json");
  const rotationWatchPath = path.join(ROOT_DIR, "data", "analysis-state", args.date, "rotation-watch.json");
  const outputPath = args.output ?? path.join(ROOT_DIR, "reports", "daily", `${args.date}-final.html`);

  const [dailyMarkdown, fullReport, stage4, holdingCards, systemHealth, dataQuality, rotationWatch] = await Promise.all([
    readText(dailyMarkdownPath, ""),
    readJson(fullReportPath, null),
    readJson(stage4Path, null),
    readJson(holdingCardsPath, null),
    readJson(systemHealthPath, null),
    readJson(dataQualityPath, null),
    readJson(rotationWatchPath, null),
  ]);

  if (!dailyMarkdown.trim()) {
    throw new Error(`경제 리포트 Markdown을 찾을 수 없거나 비어 있습니다: ${dailyMarkdownPath}`);
  }
  if (!stage4) {
    throw new Error(`Stage 4 실행 전략 JSON을 찾을 수 없습니다: ${stage4Path}`);
  }

  await writeText(outputPath, buildHtml({ date: args.date, dailyMarkdown, fullReport, stage4, holdingCards, systemHealth, dataQuality, rotationWatch }));
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  console.error(`[export-final-report-html] 실패: ${error.message}`);
  process.exit(1);
});
