/**
 * Claude API 공통 호출 래퍼
 * - 재시도 (rate limit / transient error)
 * - JSON 블록 추출
 * - 타임아웃
 */

import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_RETRIES = 3;

let _client = null;

export function getClient(apiKey) {
  if (!_client) {
    _client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/**
 * JSON 블록 추출 — ```json 펜스, 또는 bare JSON object
 */
export function extractJsonBlock(text) {
  // 1) fenced ```json ... ```
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch { /* fall through */ }
  }

  // 2) first { ... last }
  const bracketMatch = text.match(/(\{[\s\S]*\})/);
  if (bracketMatch) {
    try {
      return JSON.parse(bracketMatch[1].trim());
    } catch { /* fall through */ }
  }

  throw new Error("Claude 응답에서 유효한 JSON을 찾지 못했습니다.");
}

function isRetryableError(err) {
  const msg = String(err?.message ?? err).toLowerCase();
  return (
    msg.includes("rate_limit") ||
    msg.includes("overloaded") ||
    msg.includes("529") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("timeout")
  );
}

/**
 * Claude API 호출 후 JSON 파싱까지 수행
 *
 * @param {object} options
 * @param {string} options.prompt - 사용자 프롬프트 (text)
 * @param {string} [options.systemPrompt] - 시스템 프롬프트
 * @param {string} [options.model]
 * @param {number} [options.maxTokens]
 * @param {number} [options.temperature]
 * @param {number} [options.maxRetries]
 * @param {string} [options.apiKey]
 * @returns {Promise<{payload: object, rawText: string, model: string}>}
 */
export async function callClaudeJson({
  prompt,
  systemPrompt,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
  maxRetries = DEFAULT_MAX_RETRIES,
  apiKey,
}) {
  const client = getClient(apiKey);

  const messages = [{ role: "user", content: prompt }];
  const requestBase = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages,
  };
  if (systemPrompt) {
    requestBase.system = systemPrompt;
  }

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.messages.create(requestBase);
      const rawText = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      if (!rawText.trim()) {
        throw new Error("Claude 응답이 비어 있습니다.");
      }

      const payload = extractJsonBlock(rawText);
      return { payload, rawText, model };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isRetryableError(err)) {
        const delay = Math.min(120_000, 15_000 * attempt);
        console.error(
          `[llm-call] 일시적 오류, ${delay / 1000}s 대기 후 재시도 (${attempt}/${maxRetries}): ${err.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}
