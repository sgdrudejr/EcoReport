#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

import { ROOT_DIR, parseDateArgs, writeJson, writeText } from "./lib/pipeline-utils.js";

const BASE_URL = "https://stockeasy.intellio.kr";

const DESKTOP_VIEWPORT = { width: 1440, height: 1400 };
const MOBILE_VIEWPORT = { width: 390, height: 1200, isMobile: true };

const REFERENCE_ROUTES = [
  { id: "home", label: "홈", path: "/" },
  { id: "about", label: "About/사용매뉴얼", path: "/about" },
  { id: "ai", label: "스탁이지 AI", path: "/ai" },
  { id: "market-signal", label: "시장분석 / 시장신호", path: "/market-analysis" },
  { id: "market-briefing", label: "시장분석 / 브리핑", path: "/market-analysis?tab=briefing" },
  { id: "market-sector", label: "시장분석 / 섹터", path: "/market-analysis?tab=etfSector" },
  { id: "market-leading-sector", label: "시장분석 / 추세유지", path: "/market-analysis?tab=leadingSector" },
  { id: "market-theme-board", label: "시장분석 / 테마보드", path: "/market-analysis?tab=themeBoard" },
  { id: "stock-integrated-rs", label: "종목분석 / 종합 RS", path: "/stock-analysis?tab=integrated_rs" },
  { id: "stock-high52", label: "종목분석 / 52주 신고가", path: "/stock-analysis?tab=high52" },
  { id: "stock-valuation", label: "종목분석 / 밸류에이션", path: "/stock-analysis?tab=valuation" },
  { id: "stock-report", label: "종목분석 / 리포트", path: "/stock-analysis?tab=report" },
  { id: "stock-info-hanwha", label: "종목분석 / 종목정보 / 한화에어로스페이스", path: "/stock-analysis?tab=stock_info&code=012450" },
  { id: "strategy-home", label: "전략실 / 메인", path: "/strategy-room" },
  { id: "strategy-momentum", label: "전략실 / 모멘텀 Easy", path: "/strategy-room/momentum" },
  { id: "strategy-peak", label: "전략실 / 피크 Easy", path: "/strategy-room/peak" },
  { id: "strategy-value", label: "전략실 / 밸류 Easy", path: "/strategy-room/value" },
  { id: "chart-game", label: "차트게임", path: "/chart-game" },
  { id: "chart-game-share", label: "차트게임 / 공유 예시", path: "/chart-game/share/S9hg3RpiSyMSK1Z7LflRAA" },
];

function safeName(value) {
  return String(value).replace(/[^0-9A-Za-z_-]/g, "-");
}

function compact(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSearchParams(url) {
  try {
    const parsed = new URL(url);
    return Object.fromEntries(parsed.searchParams.entries());
  } catch {
    return {};
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function capturePage({ browser, route, viewportName, viewport, outputDir }) {
  const context = await browser.newContext({
    viewport,
    locale: "ko-KR",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
  });
  const page = await context.newPage();
  const network = [];

  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("stockeasy.intellio.kr")) return;
    network.push({
      status: response.status(),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      url,
    });
  });

  const url = new URL(route.path, BASE_URL).toString();
  let error = null;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1800);
  } catch (captureError) {
    error = captureError instanceof Error ? captureError.message : String(captureError);
  }

  const screenshotPath = path.join(outputDir, "screenshots", `${safeName(route.id)}-${viewportName}.png`);
  const htmlPath = path.join(outputDir, "html", `${safeName(route.id)}-${viewportName}.html`);
  await ensureDir(path.dirname(screenshotPath));
  await ensureDir(path.dirname(htmlPath));

  let extracted = {
    title: null,
    href: url,
    bodyText: "",
    headings: [],
    navTexts: [],
    buttons: [],
    links: [],
    tables: [],
    forms: [],
  };

  try {
    extracted = await page.evaluate(() => {
      const textOf = (node) => String(node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
      const rowsFromTable = (table) =>
        Array.from(table.querySelectorAll("tr"))
          .slice(0, 40)
          .map((row) =>
            Array.from(row.querySelectorAll("th,td"))
              .slice(0, 12)
              .map((cell) => textOf(cell))
              .filter(Boolean),
          )
          .filter((cells) => cells.length > 0);
      return {
        title: document.title,
        href: location.href,
        bodyText: textOf(document.body).slice(0, 12000),
        headings: Array.from(document.querySelectorAll("h1,h2,h3"))
          .map((node) => textOf(node))
          .filter(Boolean)
          .slice(0, 80),
        navTexts: Array.from(document.querySelectorAll("nav, aside, [role='navigation']"))
          .flatMap((node) => textOf(node).split(/\s{2,}|\n/))
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 80),
        buttons: Array.from(document.querySelectorAll("button,[role='tab'],[role='button']"))
          .map((node) => textOf(node))
          .filter(Boolean)
          .slice(0, 120),
        links: Array.from(document.querySelectorAll("a[href]"))
          .map((node) => ({ text: textOf(node), href: node.getAttribute("href") }))
          .filter((item) => item.text || item.href)
          .slice(0, 120),
        tables: Array.from(document.querySelectorAll("table"))
          .slice(0, 8)
          .map((table, tableIndex) => ({ tableIndex, rows: rowsFromTable(table) }))
          .filter((table) => table.rows.length > 0),
        forms: Array.from(document.querySelectorAll("input,textarea,select"))
          .map((node) => ({
            tag: node.tagName.toLowerCase(),
            type: node.getAttribute("type"),
            placeholder: node.getAttribute("placeholder"),
            value: node.getAttribute("value"),
            ariaLabel: node.getAttribute("aria-label"),
          }))
          .slice(0, 40),
      };
    });
  } catch (extractError) {
    error = [error, extractError instanceof Error ? extractError.message : String(extractError)].filter(Boolean).join(" | ");
  }

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 30000 });
  } catch (screenshotError) {
    error = [error, screenshotError instanceof Error ? screenshotError.message : String(screenshotError)].filter(Boolean).join(" | ");
  }

  try {
    await fs.writeFile(htmlPath, await page.content(), "utf8");
  } catch {
    // HTML is a helpful artifact, not a hard requirement.
  }

  await context.close();

  const apiCalls = network.filter((item) => new URL(item.url).pathname.startsWith("/api/"));
  const nextDataCalls = network.filter((item) => item.url.includes("/_next/"));

  return {
    id: route.id,
    label: route.label,
    path: route.path,
    url,
    viewport: viewportName,
    query: extractSearchParams(url),
    error,
    screenshot: path.relative(ROOT_DIR, screenshotPath),
    html: path.relative(ROOT_DIR, htmlPath),
    title: extracted.title,
    href: extracted.href,
    headings: extracted.headings,
    navTexts: extracted.navTexts,
    buttons: extracted.buttons,
    links: extracted.links,
    forms: extracted.forms,
    tableCount: extracted.tables.length,
    tables: extracted.tables,
    bodyTextPreview: compact(extracted.bodyText).slice(0, 4000),
    apiCalls,
    nextDataCalls: nextDataCalls.slice(0, 20),
  };
}

function summarize(captures) {
  const apiEndpoints = [...new Set(captures.flatMap((item) => item.apiCalls.map((call) => new URL(call.url).pathname)))].sort();
  const labelsBySection = Object.fromEntries(
    captures.map((item) => [
      item.id,
      {
        label: item.label,
        title: item.title,
        headings: item.headings.slice(0, 8),
        buttons: item.buttons.slice(0, 20),
        tableCount: item.tableCount,
        error: item.error,
      },
    ]),
  );

  const observedFeatureMap = {
    ai: "질문 입력, 최근 채팅, PDF/공유, 분석 진행 중 기술적 분석 팝업",
    market: "시장 신호, KOSPI/KOSDAQ 상태, ADR/52주 신고가, 섹터 테이블, 추세 유지 섹터, 테마보드",
    stock: "종합 RS, 52주 신고가, 밸류에이션, 리포트, 종목정보 검색",
    strategy: "모멘텀/피크/밸류 전략 카드, 보유 종목, 오늘 매수/이탈, 누적수익률",
    chartGame: "랜덤 차트 기반 매매 게임, 매매 분석 공유",
  };

  return {
    capturedRoutes: captures.length,
    routeIds: captures.map((item) => item.id),
    apiEndpoints,
    labelsBySection,
    observedFeatureMap,
    improvementTargets: [
      "메인 화면에서 오늘의 시장 상태, 계좌 액션, 종목 긴급도를 한 번에 요약",
      "종목 피드백에 RS/52주/밸류/리포트 근거를 탭처럼 나눠 붙이기",
      "계좌·종목 화면에 전략실식 보유/매수/이탈/수익률 카운터 추가",
      "시장분석식 신호등과 섹터/테마 리더보드를 내부 데이터로 재구성",
      "AI 리서치식 질문 프롬프트 템플릿과 PDF/텔레그램 공유 산출물 강화",
    ],
  };
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const date = args.date;
  const outputDir = path.join(ROOT_DIR, "data", "external", "stockeasy-reference", date);
  await ensureDir(outputDir);

  const browser = await chromium.launch({ headless: true });
  const captures = [];
  try {
    for (const route of REFERENCE_ROUTES) {
      for (const [viewportName, viewport] of [
        ["desktop", DESKTOP_VIEWPORT],
        ["mobile", MOBILE_VIEWPORT],
      ]) {
        console.log(`capture ${route.id} ${viewportName}`);
        captures.push(await capturePage({ browser, route, viewportName, viewport, outputDir }));
      }
    }
  } finally {
    await browser.close();
  }

  const payload = {
    date,
    capturedAt: new Date().toISOString(),
    source: BASE_URL,
    routes: REFERENCE_ROUTES,
    captures,
    summary: summarize(captures),
    compliance: {
      note: "공개 페이지의 정보 구조와 UX 패턴을 분석하기 위한 캡처입니다. 브랜드, 비공개 API, 보호 콘텐츠, 원문 리포트 복제 용도가 아닙니다.",
    },
  };

  const jsonPath = path.join(outputDir, "reference-capture.json");
  const latestPath = path.join(ROOT_DIR, "data", "external", "stockeasy-reference", "latest-reference-capture.json");
  const markdownPath = path.join(outputDir, "reference-capture.md");
  await writeJson(jsonPath, payload);
  await writeJson(latestPath, payload);
  await writeText(
    markdownPath,
    [
      `# StockEasy Reference Capture ${date}`,
      "",
      `- captured routes: ${payload.summary.capturedRoutes}`,
      `- api endpoints: ${payload.summary.apiEndpoints.length}`,
      "",
      "## Feature Map",
      ...Object.entries(payload.summary.observedFeatureMap).map(([key, value]) => `- ${key}: ${value}`),
      "",
      "## Improvement Targets",
      ...payload.summary.improvementTargets.map((item) => `- ${item}`),
      "",
      "## Routes",
      ...payload.captures.map(
        (item) =>
          `- ${item.id} (${item.viewport}): ${item.label} / tables ${item.tableCount} / screenshot ${item.screenshot}`,
      ),
      "",
    ].join("\n"),
  );

  console.log(JSON.stringify({ output: path.relative(ROOT_DIR, jsonPath), captures: captures.length }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
