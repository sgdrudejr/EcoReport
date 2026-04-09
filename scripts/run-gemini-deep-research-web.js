#!/usr/bin/env node
// Gemini 웹에서 Deep Research를 자동으로 시작하고, 완료 시 응답을 저장/클립보드 복사합니다.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ROOT_DIR, parseDateArgs, writeJson, writeText } from "./lib/pipeline-utils.js";

const GEMINI_URL = "https://gemini.google.com/app";
const DEFAULT_OUTPUT_NAME = "09-stage1-5-gemini-deep-research-response.md";
const DEFAULT_DEBUG_NAME = "09-stage1-5-gemini-deep-research-debug.json";
const PLAN_PREFIXES = [
  "그 주제를 다루기 위한 제 계획이에요.",
  "연구 계획을 짜봤어요.",
];
const UI_NOISE_PATTERNS = [
  /^gemini$/i,
  /^gemini와의 대화$/i,
  /^업그레이드$/i,
  /^포트폴리오 전략 업데이트 리서치 요청$/i,
  /^기본 메뉴$/i,
  /^검색$/i,
];
const TRANSIENT_ERROR_PATTERNS = [
  /문제가 발생했습니다\.\s*페이지를 새로고침해 보세요\./i,
  /문제가 발생했습니다/i,
  /something went wrong/i,
];
const MAX_PAGE_REFRESHES = 3;

function parseRunnerArgs(argv) {
  const base = parseDateArgs(argv);
  const args = {
    ...base,
    prompt: null,
    output: null,
    timeoutSec: 1800,
    pollSec: 30,
    openOnly: false,
    reuseFrontDocument: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--prompt" && argv[index + 1]) {
      args.prompt = argv[index + 1];
      index += 1;
    } else if (token === "--output" && argv[index + 1]) {
      args.output = argv[index + 1];
      index += 1;
    } else if (token === "--timeout-sec" && argv[index + 1]) {
      args.timeoutSec = Number.parseInt(argv[index + 1], 10) || args.timeoutSec;
      index += 1;
    } else if (token === "--poll-sec" && argv[index + 1]) {
      args.pollSec = Number.parseInt(argv[index + 1], 10) || args.pollSec;
      index += 1;
    } else if (token === "--open-only") {
      args.openOnly = true;
    } else if (token === "--reuse-front-document") {
      args.reuseFrontDocument = true;
    }
  }

  return args;
}

function resolvePromptPath(args) {
  if (args.prompt) {
    return path.isAbsolute(args.prompt) ? args.prompt : path.join(ROOT_DIR, args.prompt);
  }

  return path.join(
    ROOT_DIR,
    "knowledge",
    "daily",
    "manual-kit",
    args.date,
    "07-stage1-5-gemini-deep-research-prompt.md",
  );
}

function resolveOutputPath(args) {
  if (args.output) {
    return path.isAbsolute(args.output) ? args.output : path.join(ROOT_DIR, args.output);
  }

  return path.join(
    ROOT_DIR,
    "knowledge",
    "daily",
    "manual-kit",
    args.date,
    DEFAULT_OUTPUT_NAME,
  );
}

function resolveDebugPath(args) {
  return path.join(
    ROOT_DIR,
    "knowledge",
    "daily",
    "manual-kit",
    args.date,
    DEFAULT_DEBUG_NAME,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runOsascript(script) {
  return execFileSync("osascript", ["-e", script], { encoding: "utf8" }).trim();
}

function findGeminiDocumentAppleScript(targetDocNumber = null, targetUrl = null) {
  if (targetDocNumber === "front") {
    return `
set targetDoc to front document
`;
  }

  if (targetDocNumber !== null) {
    return `
set targetDoc to missing value
try
  set targetDoc to document ${targetDocNumber}
end try
if targetDoc is missing value then
  ${findGeminiDocumentAppleScript(null, targetUrl)}
end if
`;
  }

  if (targetUrl) {
    return `
set targetDoc to missing value
try
  if URL of front document starts with ${JSON.stringify(targetUrl)} then set targetDoc to front document
end try
if targetDoc is missing value then
  repeat with currentDoc in documents
    try
      set currentUrl to URL of currentDoc
    on error
      set currentUrl to ""
    end try
    if currentUrl starts with ${JSON.stringify(targetUrl)} then
      set targetDoc to currentDoc
      exit repeat
    end if
  end repeat
end if
if targetDoc is missing value then
  repeat with currentDoc in documents
    try
      set currentUrl to URL of currentDoc
    on error
      set currentUrl to ""
    end try
    if currentUrl starts with ${JSON.stringify(GEMINI_URL)} then
      set targetDoc to currentDoc
      exit repeat
    end if
  end repeat
end if
`;
  }

  return `
set targetDoc to missing value
repeat with currentDoc in documents
  try
    set currentUrl to URL of currentDoc
  on error
    set currentUrl to ""
  end try
  if currentUrl starts with ${JSON.stringify(GEMINI_URL)} then
    set targetDoc to currentDoc
    exit repeat
  end if
end repeat
`;
}

function runSafariJs(js, targetDocNumber = null, targetUrl = null) {
  const appleScript = `
tell application "Safari"
  ${findGeminiDocumentAppleScript(targetDocNumber, targetUrl)}
  if targetDoc is missing value then error "gemini-document-not-found"
  return do JavaScript ${JSON.stringify(js)} in targetDoc
end tell
`;
  return runOsascript(appleScript);
}

function openGeminiPage() {
  const appleScript = `
tell application "Safari"
  activate
  if (count of windows) = 0 then
    make new document with properties {URL:${JSON.stringify(GEMINI_URL)}}
  else
    tell front window
      set current tab to (make new tab with properties {URL:${JSON.stringify(GEMINI_URL)}})
    end tell
  end if
  delay 1
  return URL of front document
end tell
`;
  return runOsascript(appleScript).trim() || GEMINI_URL;
}

function reloadGeminiPage(targetDocNumber = null, targetUrl = null) {
  const appleScript = `
tell application "Safari"
  ${findGeminiDocumentAppleScript(targetDocNumber, targetUrl)}
  if targetDoc is missing value then error "gemini-document-not-found"
  tell targetDoc to do JavaScript "window.location.reload()"
end tell
`;
  return runOsascript(appleScript);
}

function getFrontDocumentUrl() {
  const appleScript = `
tell application "Safari"
  return URL of front document
end tell
`;
  return runOsascript(appleScript).trim();
}

function closeFrontGeminiPage(targetUrl) {
  const appleScript = `
tell application "Safari"
  if (count of windows) = 0 then return "no-window"

  set currentUrl to ""
  try
    set currentUrl to URL of front document
  end try

  if currentUrl does not start with ${JSON.stringify(targetUrl)} and currentUrl does not start with ${JSON.stringify(GEMINI_URL)} then
    return "skip-non-gemini"
  end if

  tell front window
    if (count of tabs) > 1 then
      close current tab
      return "closed-tab"
    end if
  end tell

  close front document
  return "closed-document"
end tell
`;

  return runOsascript(appleScript);
}

function buildSnapshotJs({ profile = "full" } = {}) {
  const settings = {
    full: {
      bodyExcerptLimit: 6000,
      bodyBlockLimit: 80,
      mainHtmlLimit: 24000,
      textBlockLimit: 80,
      textBlockLengthLimit: 2200,
    },
    compact: {
      bodyExcerptLimit: 3000,
      bodyBlockLimit: 30,
      mainHtmlLimit: 8000,
      textBlockLimit: 30,
      textBlockLengthLimit: 900,
    },
    minimal: {
      bodyExcerptLimit: 1200,
      bodyBlockLimit: 10,
      mainHtmlLimit: 0,
      textBlockLimit: 10,
      textBlockLengthLimit: 320,
    },
  }[profile] ?? {
    bodyExcerptLimit: 6000,
    bodyBlockLimit: 80,
    mainHtmlLimit: 24000,
    textBlockLimit: 80,
    textBlockLengthLimit: 2200,
  };
  const {
    bodyExcerptLimit,
    bodyBlockLimit,
    mainHtmlLimit,
    textBlockLimit,
    textBlockLengthLimit,
  } = settings;
  return `(() => {
    const BODY_EXCERPT_LIMIT = ${bodyExcerptLimit};
    const BODY_BLOCK_LIMIT = ${bodyBlockLimit};
    const MAIN_HTML_LIMIT = ${mainHtmlLimit};
    const TEXT_BLOCK_LIMIT = ${textBlockLimit};
    const TEXT_BLOCK_LENGTH_LIMIT = ${textBlockLengthLimit};
    const normalizeText = (value) =>
      (value || '').trim().replace(/\\s+/g, ' ').trim();
    const shouldKeepBlock = (value) => {
      const text = normalizeText(value);
      if (!text || text.length < 20) return false;
      if ([${UI_NOISE_PATTERNS.map((pattern) => pattern.toString()).join(", ")}].some((pattern) => pattern.test(text))) {
        return false;
      }
      return true;
    };
    const uniqueTexts = (values) => {
      const kept = [];
      for (const value of values) {
        const text = normalizeText(value);
        if (!shouldKeepBlock(text)) continue;
        if (kept.some((item) => item === text || item.includes(text) || text.includes(item))) {
          continue;
        }
        kept.push(text);
      }
      return kept.map((item) => item.slice(0, TEXT_BLOCK_LENGTH_LIMIT));
    };
    const buttons = Array.from(document.querySelectorAll('button')).map((button, index) => ({
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      index,
      text: (button.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 240),
      aria: button.getAttribute('aria-label') || '',
      disabled: Boolean(button.disabled),
      visible: Boolean(rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'),
    })).filter((item) => item.text || item.aria);

    const selectorCandidates = [
      'message-content',
      'user-query',
      'model-response',
      '[data-message-id]',
      '[data-test-id*="message"]',
      'main article',
      'main [role="listitem"]',
      'main .markdown',
      'main .model-response-text',
    ];
    const messageContents = uniqueTexts(
      selectorCandidates.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)).map((node) => node.innerText || '')
      )
    );

    const body = document.body.innerText || '';
    const bodyBlocks = uniqueTexts(
      body
        .split(/\\n{2,}/)
        .map((item) => item.trim())
    );
    const mainHtml = document.querySelector('main')?.innerHTML || '';
    const mainTextBlocks = uniqueTexts(
      Array.from(document.querySelectorAll('main *'))
        .map((node) => node.innerText || '')
        .filter((value) => value && value.trim().length >= 20)
    );

    const composer =
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('rich-textarea textarea');

    const hasButton = (pattern) =>
      buttons.some((item) => item.visible && !item.disabled && pattern.test(\`\${item.text} \${item.aria}\`));
    const latestMessage = messageContents.at(-1) || '';

    return JSON.stringify({
      title: document.title,
      url: location.href,
      bodyExcerpt: body.slice(0, BODY_EXCERPT_LIMIT),
      bodyBlocks: bodyBlocks.slice(0, BODY_BLOCK_LIMIT),
      buttons,
      messageCount: messageContents.length,
      messageContents,
      latestMessage,
      mainTextBlocks: mainTextBlocks.slice(0, TEXT_BLOCK_LIMIT),
      mainHtmlExcerpt: mainHtml.slice(0, MAIN_HTML_LIMIT),
      composerFound: Boolean(composer),
      textareaLength: document.querySelector('textarea')?.value?.length || 0,
      editableLength: document.querySelector('[contenteditable="true"]')?.textContent?.length || 0,
      hasToolsButton: hasButton(/(^|\\s)도구(\\s|$)/),
      hasDeepResearchOption: hasButton(/Deep Research/),
      hasDeepResearchSelected: hasButton(/Deep Research.*선택 해제/),
      hasSendButton: hasButton(/메시지 보내기|send/i),
      hasStopButton: hasButton(/대답 생성 중지|stop generating/i),
      hasResearchStartButton: hasButton(/연구 시작|조사 시작|Start research|Begin research/i),
      hasEditPlanButton: hasButton(/계획 수정|연구 계획 수정|Edit plan/i),
      hasPlanGenerating: /조사 계획 생성 중|creating research plan/i.test(body),
      hasReportGenerating: /보고서 생성|몇 분 후 완료|research in progress|generating report/i.test(body),
      hasResearchStartedMessage: /말씀하신 내용\\s*연구 시작/i.test(body),
      hasCopyButton: hasButton(/복사|copy/i),
      hasTransientError: [${TRANSIENT_ERROR_PATTERNS.map((pattern) => pattern.toString()).join(", ")}].some((pattern) => pattern.test(body)),
    });
  })();`;
}

function snapshotState(targetDocNumber, targetUrl) {
  const profiles = ["full", "compact", "minimal"];
  let lastError = null;

  for (const profile of profiles) {
    try {
      const raw = runSafariJs(buildSnapshotJs({ profile }), targetDocNumber, targetUrl);
      return JSON.parse(raw);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function buildPromptPreview(prompt) {
  return prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 180);
}

function isUiNoise(text) {
  return UI_NOISE_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

function collectTextCandidates(state) {
  const candidates = [
    ...(state.messageContents ?? []),
    ...(state.mainTextBlocks ?? []),
    ...(state.bodyBlocks ?? []),
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !isUiNoise(item));

  const unique = [];
  for (const item of candidates) {
    if (unique.some((existing) => existing === item || existing.includes(item) || item.includes(existing))) {
      continue;
    }
    unique.push(item);
  }
  return unique;
}

function normalizeComparableText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPromptEcho(text, promptPreview) {
  const normalizedText = normalizeComparableText(text);
  const normalizedPrompt = normalizeComparableText(promptPreview);
  if (!normalizedText || !normalizedPrompt) return false;
  const promptSlice = normalizedPrompt.slice(0, 120);
  return normalizedText.includes(promptSlice) || promptSlice.includes(normalizedText.slice(0, 80));
}

function looksLikeInvalidSavedOutput(text, promptPreview) {
  const normalizedText = normalizeComparableText(text);
  if (!normalizedText) return true;
  if (isPromptEcho(normalizedText, promptPreview)) return true;
  if (
    normalizedText.startsWith("Gemini와의 대화") &&
    normalizedText.includes("무엇을 도와드릴까요?")
  ) {
    return true;
  }
  return false;
}

function clickButtonByPattern(patternSource, targetDocNumber, targetUrl) {
  const js = `(() => {
    const pattern = new RegExp(${JSON.stringify(patternSource)}, 'i');
    const button = Array.from(document.querySelectorAll('button')).find((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      const label = \`\${(node.textContent || '').trim()} \${node.getAttribute('aria-label') || ''}\`.trim();
      return visible && pattern.test(label) && !node.disabled;
    });
    if (!button) return 'not-found';
    button.click();
    return 'clicked';
  })();`;
  return runSafariJs(js, targetDocNumber, targetUrl);
}

function submitPrompt(targetDocNumber, targetUrl) {
  const buttonResult = clickButtonByPattern("메시지 보내기|send", targetDocNumber, targetUrl);
  if (buttonResult === "clicked") {
    return buttonResult;
  }

  const js = `(() => {
    const composer =
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('rich-textarea textarea');
    if (!composer) return 'composer-not-found';
    composer.focus();
    const enterDown = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
    });
    const enterUp = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
    });
    composer.dispatchEvent(enterDown);
    composer.dispatchEvent(enterUp);
    return 'enter-dispatched';
  })();`;

  return runSafariJs(js, targetDocNumber, targetUrl);
}

function injectPrompt(prompt, targetDocNumber, targetUrl) {
  const promptBase64 = Buffer.from(prompt, "utf8").toString("base64");
  const js = `(() => {
    const decodeBase64Utf8 = (value) => {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    };

    const text = decodeBase64Utf8(${JSON.stringify(promptBase64)});
    const composer =
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('rich-textarea textarea');

    if (!composer) return 'composer-not-found';
    composer.focus();

    if (composer.tagName === 'TEXTAREA') {
      composer.value = text;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      return 'textarea';
    }

    composer.textContent = text;
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    return 'editable';
  })();`;

  return runSafariJs(js, targetDocNumber, targetUrl);
}

function composerContainsPrompt(state, prompt) {
  if (!prompt) return false;
  const filledLength = Math.max(state?.textareaLength ?? 0, state?.editableLength ?? 0);
  const threshold = Math.max(80, Math.floor(prompt.length * 0.6));
  return filledLength >= threshold;
}

function copyToClipboard(text) {
  const result = spawnSync("pbcopy", { input: text, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "pbcopy failed");
  }
}

function isPlanMessage(text) {
  return PLAN_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function extractFinalResponse(state, planMessage, promptPreview) {
  const messages = (state.messageContents ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  if (messages.length === 0) return null;

  const filtered = messages
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !item.startsWith("말씀하신 내용"));

  if (filtered.length === 0) return null;

  const candidates = filtered.filter((item) => {
    if (item === planMessage) return false;
    if (isPlanMessage(item)) return false;
    if (/^말씀하신 내용\b/.test(item)) return false;
    if (isPromptEcho(item, promptPreview)) return false;
    if (/조사 계획 생성 중|보고서 생성|몇 분 후 완료/i.test(item)) return false;
    if (/연구 시작|계획 수정|Deep Research 사용하지 않고 다시 시도하기/i.test(item)) return false;
    if (/^연구를 완료했어요\./.test(item) && item.length < 200) return false;
    return true;
  });

  const latest = candidates.at(-1);
  if (!latest) return null;
  if (state.hasStopButton) return null;
  if (state.hasResearchStartButton) return null;
  if (latest.length < 200 && !hasCompletionMessage(state) && !state.hasCopyButton) return null;

  return latest;
}

function isLikelySourceList(text) {
  const normalized = normalizeComparableText(text);
  if (!normalized) return false;
  if (/^researching websites/i.test(normalized)) return true;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 4) return false;

  const urlLikeLines = lines.filter((line) => /[a-z0-9.-]+\.[a-z]{2,}/i.test(line)).length;
  return urlLikeLines >= Math.max(3, Math.floor(lines.length / 3));
}

function isLikelyResearchDraft(text, planMessage, promptPreview) {
  const normalized = normalizeComparableText(text);
  if (!normalized || normalized.length < 280) return false;
  if (text === planMessage) return false;
  if (isPlanMessage(text)) return false;
  if (isPromptEcho(text, promptPreview)) return false;
  if (/^말씀하신 내용\b/.test(text)) return false;
  if (/연구가 완료되면 알려 드릴게요|결과 분석 중|조사 계획 생성 중|보고서 생성/i.test(text)) {
    return false;
  }
  if (isLikelySourceList(text)) return false;
  return /[가-힣]/.test(text);
}

function extractBestEffortResponse(state, planMessage, promptPreview) {
  const drafts = collectTextCandidates(state)
    .map((item) => item.trim())
    .filter((item) => isLikelyResearchDraft(item, planMessage, promptPreview));

  if (drafts.length === 0) {
    return null;
  }

  const merged = [];
  for (let index = drafts.length - 1; index >= 0; index -= 1) {
    const candidate = drafts[index];
    if (
      merged.some((existing) => existing === candidate || existing.includes(candidate) || candidate.includes(existing))
    ) {
      continue;
    }
    merged.unshift(candidate);
    const mergedLength = merged.join("\n\n").length;
    if (mergedLength >= 2400 || merged.length >= 4) {
      break;
    }
  }

  const response = merged.join("\n\n").trim();
  return response.length >= 280 ? response : drafts.at(-1);
}

function hasPlanMessage(state) {
  return collectTextCandidates(state)
    .map((item) => item.trim())
    .some((item) => isPlanMessage(item));
}

function hasCompletionMessage(state) {
  return collectTextCandidates(state)
    .map((item) => item.trim())
    .some((item) => /^연구를 완료했어요\./.test(item));
}

function inferResearchStarted(state, promptSubmitted = false) {
  if (state.hasResearchStartedMessage || hasCompletionMessage(state)) {
    return true;
  }

  if (state.hasPlanGenerating) {
    return true;
  }

  if (state.hasReportGenerating && !state.hasResearchStartButton) {
    return true;
  }

  if (promptSubmitted && state.hasStopButton && !state.hasResearchStartButton) {
    return true;
  }

  return false;
}

async function writeDebugSnapshot(debugPath, payload) {
  await writeJson(debugPath, payload);
}

function purgeInvalidOutput(outputPath, promptPreview) {
  if (!fs.existsSync(outputPath)) return;
  try {
    const existing = fs.readFileSync(outputPath, "utf8");
    if (looksLikeInvalidSavedOutput(existing, promptPreview)) {
      fs.unlinkSync(outputPath);
    }
  } catch {
    // Ignore cleanup failures; the main run should still continue.
  }
}

async function refreshPromptFile(promptPath, date) {
  try {
    execFileSync(
      "node",
      [path.join(ROOT_DIR, "scripts", "build-stage1-5-gemini-deep-research-prompt.js"), "--date", date],
      {
        cwd: ROOT_DIR,
        stdio: "ignore",
      },
    );
  } catch (error) {
    if (fs.existsSync(promptPath)) {
      console.warn(
        `prompt-refresh-warning: ${error instanceof Error ? error.message : String(error)}; 기존 프롬프트를 사용합니다.`,
      );
      return;
    }
    throw error;
  }
}

async function main() {
  const args = parseRunnerArgs(process.argv.slice(2));
  const promptPath = resolvePromptPath(args);
  const outputPath = resolveOutputPath(args);
  const debugPath = resolveDebugPath(args);

  await refreshPromptFile(promptPath, args.date);
  const prompt = fs.readFileSync(promptPath, "utf8");
  const promptPreview = buildPromptPreview(prompt);
  purgeInvalidOutput(outputPath, promptPreview);

  const targetDocNumber = "front";
  const targetUrl = args.reuseFrontDocument ? getFrontDocumentUrl() : openGeminiPage();
  await sleep(4000);

  let state = snapshotState(targetDocNumber, targetUrl);
  if (!state.composerFound) {
    await sleep(3000);
    state = snapshotState(targetDocNumber, targetUrl);
  }

  if (!state.composerFound) {
    throw new Error("Gemini 입력창을 찾지 못했습니다.");
  }

  let promptInjected = composerContainsPrompt(state, prompt);
  if (
    (state.messageCount ?? 0) === 0 &&
    !promptInjected
  ) {
    injectPrompt(prompt, targetDocNumber, targetUrl);
    promptInjected = true;
    await sleep(1000);
    state = snapshotState(targetDocNumber, targetUrl);
  }

  if (args.openOnly) {
    console.log("Gemini page opened in a new tab and prompt injected.");
    console.log(`target_document: ${targetDocNumber}`);
    console.log(`target_url: ${targetUrl}`);
    return;
  }

  let planMessage = null;
  let promptSubmitted = false;
  let researchStarted = false;
  let pageRefreshCount = 0;
  const deadline = Date.now() + args.timeoutSec * 1000;
  let lastProgressKey = "";
  let lastProgressLoggedAt = 0;
  let lastState = state;

  while (Date.now() < deadline) {
    state = snapshotState(targetDocNumber, targetUrl);
    lastState = state;

    if (state.hasTransientError) {
      if (pageRefreshCount >= MAX_PAGE_REFRESHES) {
        await writeDebugSnapshot(debugPath, {
          savedAt: new Date().toISOString(),
          status: "page_error",
          date: args.date,
          promptPath,
          outputPath,
          promptPreview,
          promptInjected,
          promptSubmitted,
          researchStarted,
          pageRefreshCount,
          planMessage,
          lastState,
        });
        throw new Error(
          `Gemini 페이지 오류가 ${MAX_PAGE_REFRESHES}회 반복됐습니다. 새로고침 자동 복구에 실패했습니다. [debug: ${debugPath}]`,
        );
      }

      pageRefreshCount += 1;
      console.log(`recoverable_page_error: refresh ${pageRefreshCount}/${MAX_PAGE_REFRESHES}`);
      reloadGeminiPage(targetDocNumber, targetUrl);
      promptSubmitted = false;
      researchStarted = false;
      planMessage = null;
      promptInjected = false;
      await sleep(5000);
      state = snapshotState(targetDocNumber, targetUrl);
    }

    if ((state.messageCount ?? 0) > 0) {
      promptSubmitted = true;
    }

    if (!promptSubmitted && state.hasStopButton) {
      promptSubmitted = true;
    }

    if (
      inferResearchStarted(state, promptSubmitted)
    ) {
      researchStarted = true;
    }

    if (!promptSubmitted && !composerContainsPrompt(state, prompt)) {
      injectPrompt(prompt, targetDocNumber, targetUrl);
      promptInjected = true;
      await sleep(1000);
      state = snapshotState(targetDocNumber, targetUrl);
    }

    if (!promptSubmitted && !researchStarted && !state.hasDeepResearchSelected) {
      if (!state.hasDeepResearchOption) {
        clickButtonByPattern("(^|\\\\s)도구(\\\\s|$)", targetDocNumber, targetUrl);
        await sleep(1000);
        state = snapshotState(targetDocNumber, targetUrl);
      }
      if (state.hasDeepResearchOption && !state.hasDeepResearchSelected) {
        clickButtonByPattern("Deep Research", targetDocNumber, targetUrl);
        await sleep(1000);
        state = snapshotState(targetDocNumber, targetUrl);
      }
    }

    if (
      !promptSubmitted &&
      state.messageCount === 0 &&
      state.hasSendButton &&
      !state.hasStopButton &&
      composerContainsPrompt(state, prompt) &&
      (state.hasDeepResearchSelected || !state.hasToolsButton)
    ) {
      const submitResult = submitPrompt(targetDocNumber, targetUrl);
      if (submitResult === "clicked" || submitResult === "enter-dispatched") {
        promptSubmitted = true;
        await sleep(3000);
        state = snapshotState(targetDocNumber, targetUrl);
      }
    }

    if (!planMessage) {
      const planCandidate = (state.messageContents ?? [])
        .map((item) => item.trim())
        .find((item) => isPlanMessage(item));
      if (planCandidate) {
        planMessage = planCandidate;
      }
    }

    if (
      promptSubmitted &&
      state.hasResearchStartButton &&
      !state.hasResearchStartedMessage &&
      (planMessage || hasPlanMessage(state) || state.hasEditPlanButton)
    ) {
      clickButtonByPattern("연구 시작|조사 시작|Start research|Begin research", targetDocNumber, targetUrl);
      researchStarted = true;
      await sleep(3000);
      state = snapshotState(targetDocNumber, targetUrl);
    }

    const finalResponse = extractFinalResponse(state, planMessage, promptPreview);
    if (finalResponse) {
      await writeText(outputPath, `${finalResponse}\n`);
      await writeDebugSnapshot(debugPath, {
        savedAt: new Date().toISOString(),
        status: "success",
        date: args.date,
        outputPath,
        promptPath,
        promptSubmitted,
        researchStarted,
        promptInjected,
        pageRefreshCount,
        planMessage,
        finalResponsePreview: finalResponse.slice(0, 1200),
        state,
      });
      copyToClipboard(finalResponse);
      if (!args.reuseFrontDocument) {
        try {
          const closeResult = closeFrontGeminiPage(targetUrl);
          console.log(`closed: ${closeResult}`);
        } catch (error) {
          console.warn(`close-warning: ${error.message}`);
        }
      }
      console.log(`saved: ${outputPath}`);
      console.log(`copied_chars: ${finalResponse.length}`);
      return;
    }

    const progressPayload = {
      title: state.title,
      messageCount: state.messageCount,
      promptSubmitted,
      researchStarted,
      promptInjected,
      pageRefreshCount,
      hasDeepResearchSelected: state.hasDeepResearchSelected,
      hasResearchStartButton: state.hasResearchStartButton,
      hasStopButton: state.hasStopButton,
      hasPlanGenerating: state.hasPlanGenerating,
      hasReportGenerating: state.hasReportGenerating,
      hasTransientError: state.hasTransientError,
      composerContainsPrompt: composerContainsPrompt(state, prompt),
      bodyBlockCount: state.bodyBlocks?.length ?? 0,
      mainTextBlockCount: state.mainTextBlocks?.length ?? 0,
    };
    const progressKey = JSON.stringify(progressPayload);
    const now = Date.now();
    if (progressKey !== lastProgressKey || now - lastProgressLoggedAt >= 60_000) {
      console.log(progressKey);
      lastProgressKey = progressKey;
      lastProgressLoggedAt = now;
    }

    await sleep(args.pollSec * 1000);
  }

  const recoveredResponse = extractBestEffortResponse(lastState, planMessage, promptPreview);
  if (recoveredResponse) {
    await writeText(outputPath, `${recoveredResponse}\n`);
    await writeDebugSnapshot(debugPath, {
      savedAt: new Date().toISOString(),
      status: "timeout_recovered",
      date: args.date,
      promptPath,
      outputPath,
      promptPreview,
      promptSubmitted,
      researchStarted,
      promptInjected,
      pageRefreshCount,
      planMessage,
      recoveredResponsePreview: recoveredResponse.slice(0, 1200),
      lastState,
    });
    copyToClipboard(recoveredResponse);
    if (!args.reuseFrontDocument) {
      try {
        const closeResult = closeFrontGeminiPage(targetUrl);
        console.log(`closed: ${closeResult}`);
      } catch (error) {
        console.warn(`close-warning: ${error.message}`);
      }
    }
    console.warn(`recovered_timeout_response: ${outputPath}`);
    console.log(`copied_chars: ${recoveredResponse.length}`);
    return;
  }

  await writeDebugSnapshot(debugPath, {
    savedAt: new Date().toISOString(),
    status: "timeout",
    date: args.date,
    promptPath,
    outputPath,
    promptPreview,
    promptSubmitted,
    researchStarted,
    promptInjected,
    pageRefreshCount,
    planMessage,
    lastState,
  });

  throw new Error(`Gemini Deep Research 응답 대기 타임아웃 (${args.timeoutSec}초) [debug: ${debugPath}]`);
}

main().catch((error) => {
  console.error(`run-gemini-deep-research-web 실패: ${error.message}`);
  process.exit(1);
});
