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

function renderActionRows(plan) {
  const rows = [];
  for (const item of plan.stagedBuys ?? []) {
    rows.push({ action: "BUY", tone: "buy", name: item.name, amount: item.suggestedAmount, urgency: item.urgency, reason: item.reason });
  }
  for (const item of plan.trims ?? []) {
    rows.push({ action: "TRIM", tone: "trim", name: item.name, amount: null, urgency: "trim", reason: item.reason });
  }
  for (const item of plan.holds ?? []) {
    rows.push({ action: "HOLD", tone: "hold", name: item.name, amount: null, urgency: "hold", reason: item.reason });
  }
  for (const item of plan.watches ?? []) {
    rows.push({ action: "WATCH", tone: "watch", name: item.name, amount: null, urgency: "watch", reason: item.reason });
  }
  if (!rows.length) {
    rows.push({ action: "NO_ACTION", tone: "none", name: "-", amount: null, urgency: "-", reason: plan.noActionReason ?? "실행 계획 없음" });
  }
  return rows;
}

function renderAccountPlan(plan) {
  const actionRows = renderActionRows(plan);
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
    "      <thead><tr><th>액션</th><th>종목</th><th>금액</th><th>긴급도</th><th>핵심 근거</th></tr></thead>",
    "      <tbody>",
    ...actionRows.map((row) =>
      `        <tr><td><span class="badge ${row.tone}">${escapeHtml(row.action)}</span></td><td>${escapeHtml(row.name ?? "-")}</td><td>${formatAmount(row.amount)}</td><td>${escapeHtml(row.urgency ?? "-")}</td><td>${escapeHtml(row.reason ?? "-")}</td></tr>`,
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

function buildHtml({ date, dailyMarkdown, fullReport, stage4, systemHealth }) {
  const finalReport = fullReport?.final_report ?? {};
  const topAtoms = [...(finalReport.top_insight_atoms ?? [])]
    .filter((item) => ["positive", "mixed", "neutral"].includes(item?.direction ?? "neutral"))
    .sort((left, right) => atomScore(right) - atomScore(left))
    .slice(0, 4);
  const riskAtoms = [...(finalReport.risk_atoms ?? [])].sort((left, right) => atomScore(right) - atomScore(left)).slice(0, 3);
  const accountPlans = stage4?.accountPlans ?? [];
  const buyCount = accountPlans.reduce((sum, plan) => sum + (plan.stagedBuys?.length ?? 0), 0);
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
    .file-list { display: grid; gap: 6px; color: var(--muted); font-size: 0.92rem; }
    footer { color: var(--muted); font-size: 0.86rem; margin-top: 22px; }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; padding: 16px; }
      nav { position: static; display: flex; flex-wrap: wrap; gap: 4px; }
      nav a { padding: 7px 9px; }
      .metrics, .account-metrics, .split { grid-template-columns: 1fr; }
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
      <a href="#execution">실행 전략</a>
      <a href="#economy">경제 리포트</a>
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
      <section id="execution" class="band">
        <h2>실행 전략</h2>
        <p>계좌별 투입 가능 금액, 부족 자산군, 액션 후보와 검증 플래그를 한 번에 볼 수 있게 정리했습니다. BUY는 실행 후보, HOLD는 유지, WATCH는 추가 확인이 필요한 관찰 후보입니다.</p>
        ${accountPlans.map(renderAccountPlan).join("\n")}
      </section>
      <section id="economy" class="band">
        <h2>읽을 수 있는 경제 리포트</h2>
        <p>아래 섹션은 70개 리포트를 통합한 본문입니다. 처음 세 섹션은 펼쳐두고, 나머지는 필요할 때 열어볼 수 있게 접었습니다.</p>
        ${renderReportSections(dailyMarkdown)}
      </section>
      <section id="health" class="band">
        <h2>검증 상태</h2>
        ${renderSystemHealth(systemHealth)}
      </section>
      <section id="files" class="band">
        <h2>원본 파일</h2>
        <div class="file-list">
          <div>경제 리포트: knowledge/daily/${escapeHtml(date)}-full-daily-report.md</div>
          <div>실행 전략: reports/daily/${escapeHtml(date)}-stage4-execution-plan.md</div>
          <div>실행 전략 표: reports/daily/${escapeHtml(date)}-stage4-execution-plan-table.md</div>
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
  const systemHealthPath = path.join(ROOT_DIR, "data", "analysis-state", args.date, "system-health.json");
  const outputPath = args.output ?? path.join(ROOT_DIR, "reports", "daily", `${args.date}-final.html`);

  const [dailyMarkdown, fullReport, stage4, systemHealth] = await Promise.all([
    readText(dailyMarkdownPath, ""),
    readJson(fullReportPath, null),
    readJson(stage4Path, null),
    readJson(systemHealthPath, null),
  ]);

  if (!dailyMarkdown.trim()) {
    throw new Error(`경제 리포트 Markdown을 찾을 수 없거나 비어 있습니다: ${dailyMarkdownPath}`);
  }
  if (!stage4) {
    throw new Error(`Stage 4 실행 전략 JSON을 찾을 수 없습니다: ${stage4Path}`);
  }

  await writeText(outputPath, buildHtml({ date: args.date, dailyMarkdown, fullReport, stage4, systemHealth }));
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  console.error(`[export-final-report-html] 실패: ${error.message}`);
  process.exit(1);
});
