#!/usr/bin/env node
// Gemini 웹에서 Deep Research를 자동으로 시작하고, 완료 시 응답을 저장/클립보드 복사합니다.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ROOT_DIR, parseDateArgs, writeText } from "./lib/pipeline-utils.js";

const GEMINI_URL = "https://gemini.google.com/app";
const DEFAULT_OUTPUT_NAME = "09-stage1-5-gemini-deep-research-response.md";
const PLAN_PREFIX = "그 주제를 다루기 위한 제 계획이에요.";

function parseRunnerArgs(argv) {
  const base = parseDateArgs(argv);
  const args = {
    ...base,
    prompt: null,
    output: null,
    timeoutSec: 1800,
    pollSec: 30,
    openOnly: false,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runOsascript(script) {
  return execFileSync("osascript", ["-e", script], { encoding: "utf8" }).trim();
}

function runSafariJs(js) {
  const appleScript = `
tell application "Safari"
  activate
  return do JavaScript ${JSON.stringify(js)} in front document
end tell
`;
  return runOsascript(appleScript);
}

function openGeminiPage() {
  const appleScript = `
tell application "Safari"
  activate
  if (count of documents) = 0 then
    make new document with properties {URL:${JSON.stringify(GEMINI_URL)}}
  else
    try
      set currentUrl to URL of front document
    on error
      set currentUrl to ""
    end try
    if currentUrl does not start with ${JSON.stringify(GEMINI_URL)} then
      set URL of front document to ${JSON.stringify(GEMINI_URL)}
    end if
  end if
end tell
`;
  runOsascript(appleScript);
}

function buildSnapshotJs() {
  return `(() => {
    const buttons = Array.from(document.querySelectorAll('button')).map((button, index) => ({
      index,
      text: (button.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 240),
      aria: button.getAttribute('aria-label') || '',
      disabled: Boolean(button.disabled),
    })).filter((item) => item.text || item.aria);

    const messageContents = Array.from(document.querySelectorAll('message-content')).map((node) =>
      (node.innerText || '').trim()
    ).filter(Boolean);

    const composer =
      document.querySelector('textarea') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('[contenteditable="true"]') ||
      document.querySelector('rich-textarea textarea');

    const body = document.body.innerText || '';
    const hasButton = (pattern) => buttons.some((item) => pattern.test(\`\${item.text} \${item.aria}\`));
    const latestMessage = messageContents.at(-1) || '';

    return JSON.stringify({
      title: document.title,
      url: location.href,
      bodyExcerpt: body.slice(0, 6000),
      buttons,
      messageCount: messageContents.length,
      messageContents,
      latestMessage,
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
    });
  })();`;
}

function snapshotState() {
  const raw = runSafariJs(buildSnapshotJs());
  return JSON.parse(raw);
}

function clickButtonByPattern(patternSource) {
  const js = `(() => {
    const pattern = new RegExp(${JSON.stringify(patternSource)}, 'i');
    const button = Array.from(document.querySelectorAll('button')).find((node) => {
      const label = \`\${(node.textContent || '').trim()} \${node.getAttribute('aria-label') || ''}\`.trim();
      return pattern.test(label) && !node.disabled;
    });
    if (!button) return 'not-found';
    button.click();
    return 'clicked';
  })();`;
  return runSafariJs(js);
}

function injectPrompt(prompt) {
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

  return runSafariJs(js);
}

function copyToClipboard(text) {
  const result = spawnSync("pbcopy", { input: text, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || "pbcopy failed");
  }
}

function extractFinalResponse(state, planMessage) {
  const messages = state.messageContents ?? [];
  if (messages.length === 0) return null;

  const filtered = messages
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !item.startsWith("말씀하신 내용"));

  if (filtered.length === 0) return null;

  const candidates = filtered.filter((item) => {
    if (item === planMessage) return false;
    if (item.startsWith(PLAN_PREFIX)) return false;
    if (/조사 계획 생성 중|보고서 생성|몇 분 후 완료/i.test(item)) return false;
    if (/^연구를 완료했어요\./.test(item) && item.length < 200) return false;
    return true;
  });

  const latest = candidates.at(-1);
  if (!latest) return null;
  if (state.hasStopButton) return null;

  return latest;
}

function hasPlanMessage(state) {
  return (state.messageContents ?? [])
    .map((item) => item.trim())
    .some((item) => item.startsWith(PLAN_PREFIX));
}

function hasCompletionMessage(state) {
  return (state.messageContents ?? [])
    .map((item) => item.trim())
    .some((item) => /^연구를 완료했어요\./.test(item));
}

async function ensurePromptFile(promptPath, date) {
  if (fs.existsSync(promptPath)) return;

  execFileSync("node", [path.join(ROOT_DIR, "scripts", "build-stage1-5-gemini-deep-research-prompt.js"), "--date", date], {
    cwd: ROOT_DIR,
    stdio: "ignore",
  });
}

async function main() {
  const args = parseRunnerArgs(process.argv.slice(2));
  const promptPath = resolvePromptPath(args);
  const outputPath = resolveOutputPath(args);

  await ensurePromptFile(promptPath, args.date);
  const prompt = fs.readFileSync(promptPath, "utf8");

  openGeminiPage();
  await sleep(4000);

  let state = snapshotState();
  if (!state.composerFound) {
    await sleep(3000);
    state = snapshotState();
  }

  if (!state.composerFound) {
    throw new Error("Gemini 입력창을 찾지 못했습니다.");
  }

  if ((state.textareaLength ?? 0) < prompt.length * 0.6 && (state.editableLength ?? 0) < prompt.length * 0.6) {
    injectPrompt(prompt);
    await sleep(1000);
    state = snapshotState();
  }

  if (args.openOnly) {
    console.log("Gemini page opened and prompt injected.");
    return;
  }

  let planMessage = null;
  let promptSubmitted = false;
  let researchStarted = false;
  const deadline = Date.now() + args.timeoutSec * 1000;
  let lastProgressKey = "";
  let lastProgressLoggedAt = 0;

  while (Date.now() < deadline) {
    state = snapshotState();

    if ((state.messageCount ?? 0) > 0) {
      promptSubmitted = true;
    }

    if (
      state.hasResearchStartedMessage ||
      state.hasStopButton ||
      state.hasPlanGenerating ||
      state.hasReportGenerating ||
      hasCompletionMessage(state)
    ) {
      researchStarted = true;
    }

    if (!promptSubmitted && !state.hasDeepResearchSelected) {
      if (!state.hasDeepResearchOption) {
        clickButtonByPattern("(^|\\\\s)도구(\\\\s|$)");
        await sleep(1000);
        state = snapshotState();
      }
      if (state.hasDeepResearchOption && !state.hasDeepResearchSelected) {
        clickButtonByPattern("Deep Research");
        await sleep(1000);
        state = snapshotState();
      }
    }

    if (!promptSubmitted && state.messageCount === 0 && state.hasSendButton && !state.hasStopButton) {
      clickButtonByPattern("메시지 보내기|send");
      promptSubmitted = true;
      await sleep(3000);
      state = snapshotState();
    }

    if (!planMessage) {
      const planCandidate = (state.messageContents ?? [])
        .map((item) => item.trim())
        .find((item) => item.startsWith(PLAN_PREFIX));
      if (planCandidate) {
        planMessage = planCandidate;
      }
    }

    if (
      promptSubmitted &&
      !researchStarted &&
      state.hasResearchStartButton &&
      !state.hasStopButton &&
      !state.hasResearchStartedMessage &&
      (planMessage || hasPlanMessage(state) || state.hasEditPlanButton)
    ) {
      clickButtonByPattern("연구 시작|조사 시작|Start research|Begin research");
      researchStarted = true;
      await sleep(3000);
      state = snapshotState();
    }

    const finalResponse = extractFinalResponse(state, planMessage);
    if (finalResponse) {
      await writeText(outputPath, `${finalResponse}\n`);
      copyToClipboard(finalResponse);
      console.log(`saved: ${outputPath}`);
      console.log(`copied_chars: ${finalResponse.length}`);
      return;
    }

    const progressPayload = {
      title: state.title,
      messageCount: state.messageCount,
      promptSubmitted,
      researchStarted,
      hasDeepResearchSelected: state.hasDeepResearchSelected,
      hasResearchStartButton: state.hasResearchStartButton,
      hasStopButton: state.hasStopButton,
      hasPlanGenerating: state.hasPlanGenerating,
      hasReportGenerating: state.hasReportGenerating,
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

  throw new Error(`Gemini Deep Research 응답 대기 타임아웃 (${args.timeoutSec}초)`);
}

main().catch((error) => {
  console.error(`run-gemini-deep-research-web 실패: ${error.message}`);
  process.exit(1);
});
