#!/usr/bin/env node

import path from "node:path";

import {
  ROOT_DIR,
  parseDateArgs,
  readText,
  writeText,
} from "./lib/pipeline-utils.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdownToHtml(value) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function markdownToHtml(markdown) {
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

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeLists();
      const level = heading[1].length;
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

function buildHtmlDocument({ date, bodyHtml }) {
  return [
    "<!doctype html>",
    '<html lang="ko">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>EcoReport ${date}</title>`,
    "  <style>",
    "    :root { color-scheme: light; }",
    "    body { margin: 0; background: #f3f5f8; color: #17212b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.65; }",
    "    main { max-width: 920px; margin: 32px auto; background: #fff; border: 1px solid #e6ebf2; border-radius: 16px; padding: 28px; box-shadow: 0 8px 30px rgba(16,24,40,0.08); }",
    "    h1,h2,h3,h4,h5,h6 { line-height: 1.3; margin: 1.1em 0 0.5em; }",
    "    h1 { margin-top: 0; font-size: 1.8rem; }",
    "    p { margin: 0.5em 0; white-space: pre-wrap; }",
    "    ul,ol { margin: 0.5em 0 0.8em 1.2em; }",
    "    li { margin: 0.2em 0; }",
    "    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #eef3f8; padding: 0.1em 0.35em; border-radius: 4px; }",
    "    .meta { color: #4a5a70; font-size: 0.9rem; margin-bottom: 18px; }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    `    <div class="meta">EcoReport Daily Briefing • ${escapeHtml(date)}</div>`,
    bodyHtml
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n"),
    "  </main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const markdownPath =
    args.briefing ||
    path.join(ROOT_DIR, "reports", "daily", `${args.date}-briefing.md`);
  const outputPath =
    args.output ||
    path.join(ROOT_DIR, "reports", "daily", `${args.date}-briefing.html`);

  const markdown = await readText(markdownPath, "");
  if (!markdown.trim()) {
    throw new Error(`브리핑 Markdown을 찾을 수 없거나 비어 있습니다: ${markdownPath}`);
  }

  const htmlBody = markdownToHtml(markdown);
  const html = buildHtmlDocument({
    date: args.date,
    bodyHtml: htmlBody,
  });

  await writeText(outputPath, html);
  process.stdout.write(`${outputPath}\n`);
}

main().catch((error) => {
  console.error(`[export-daily-briefing-html] 실패: ${error.message}`);
  process.exit(1);
});
