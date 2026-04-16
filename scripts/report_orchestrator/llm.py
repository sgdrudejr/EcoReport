from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI, RateLimitError

from .config import PipelineConfig


@dataclass(slots=True)
class LlmResult:
    payload: dict[str, Any]
    raw_text: str
    attempts: int
    finish_reason: str | None = None


class LlmClient:
    def __init__(self, config: PipelineConfig):
        self.config = config
        self.client = OpenAI(
            base_url=self.config.base_url,
            api_key=self.config.api_key,
            timeout=self.config.timeout_seconds,
        )

    @property
    def _is_gemini(self) -> bool:
        return self.config.provider == "gemini"

    @property
    def _is_qwen(self) -> bool:
        return self.config.provider == "qwen"

    @property
    def _is_cloud(self) -> bool:
        """Gemini 또는 Qwen API처럼 extra_body 없이 표준 OpenAI 호환 방식을 쓰는 provider."""
        return self._is_gemini or self._is_qwen

    # ── Qwen CoT 시스템 프롬프트 ──────────────────────────────────────────────
    QWEN_COT_SYSTEM = (
        "너는 전문 금융 리서처이자 시장 분석가야. "
        "답변을 내놓기 전에 반드시 다음 추론 과정을 거쳐라:\n"
        "1. 질문/데이터의 핵심 키워드를 3개로 분해한다\n"
        "2. 각 키워드에 대해 상반된 두 관점(Bullish/Bearish)을 검토한다\n"
        "3. 수집된 정보 사이의 모순점을 찾아내고 논리적으로 해결한다\n"
        "4. 최종적으로 실행 가능한(actionable) 인사이트를 제공한다\n"
        "깊이 있는 분석을 위해 단순 요약이 아닌 '왜', '어떻게', '다음에 무슨 일이 일어날지'에 집중하라."
    )

    # ── Qwen web_search 툴 정의 ───────────────────────────────────────────────
    QWEN_WEB_SEARCH_TOOL: list[dict[str, Any]] = [
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "실시간 웹 검색으로 최신 뉴스, 시장 데이터, 경제 지표를 가져온다",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "검색 쿼리"}
                    },
                    "required": ["query"],
                },
            },
        }
    ]

    def _base_extra_body(self) -> dict[str, Any]:
        if self._is_cloud:
            return {}
        return {"chat_template_kwargs": {"enable_thinking": False}}

    def _inject_qwen_cot(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Qwen 사용 시 CoT 시스템 프롬프트를 첫 번째 system 메시지에 주입한다."""
        if not self._is_qwen:
            return messages
        result = list(messages)
        if result and result[0].get("role") == "system":
            result[0] = {
                **result[0],
                "content": self.QWEN_COT_SYSTEM + "\n\n" + result[0]["content"],
            }
        else:
            result.insert(0, {"role": "system", "content": self.QWEN_COT_SYSTEM})
        return result

    def _create_chat_completion(
        self,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        *,
        json_mode: bool = False,
        use_web_search: bool = False,
    ) -> dict[str, Any]:
        messages = self._inject_qwen_cot(messages)
        extra_body = self._base_extra_body()
        kwargs: dict[str, Any] = dict(
            model=self.config.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        if json_mode:
            if self._is_cloud:
                kwargs["response_format"] = {"type": "json_object"}
            else:
                extra_body["response_format"] = {"type": "json_object"}
        # Qwen web_search: JSON 모드와는 함께 쓸 수 없으므로 non-json 호출에만 적용
        if use_web_search and self._is_qwen and not json_mode:
            kwargs["tools"] = self.QWEN_WEB_SEARCH_TOOL
        if extra_body:
            kwargs["extra_body"] = extra_body
        response = self.client.chat.completions.create(**kwargs)
        return response.model_dump()

    def test_connection(self) -> dict[str, Any]:
        attempts: list[dict[str, Any]] = []
        for attempt in range(1, self.config.connection_retries + 1):
            started_at = time.time()
            try:
                test_client = OpenAI(
                    base_url=self.config.base_url,
                    api_key=self.config.api_key,
                    timeout=min(self.config.timeout_seconds, 10),
                )
                extra_body = self._base_extra_body()
                create_kwargs: dict[str, Any] = dict(
                    model=self.config.model,
                    messages=[{"role": "user", "content": "안녕"}],
                    temperature=0.1,
                    max_tokens=16,
                )
                if extra_body:
                    create_kwargs["extra_body"] = extra_body
                response = test_client.chat.completions.create(**create_kwargs)
                content = self.extract_message_text(response.model_dump())
                attempts.append(
                    {
                        "attempt": attempt,
                        "ok": True,
                        "duration_seconds": round(time.time() - started_at, 3),
                        "model": self.config.model,
                        "response_excerpt": content[:120],
                    }
                )
                return {"ok": True, "attempts": attempts}
            except (APIConnectionError, APITimeoutError, TimeoutError, Exception) as error:  # noqa: BLE001
                attempts.append(
                    {
                        "attempt": attempt,
                        "ok": False,
                        "duration_seconds": round(time.time() - started_at, 3),
                        "model": self.config.model,
                        "error": str(error),
                    }
                )
                time.sleep(min(attempt, 3))
        return {"ok": False, "attempts": attempts}

    @staticmethod
    def extract_message_text(response: dict[str, Any]) -> str:
        choices = response.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(
                part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text"
            )
        return str(content)

    @staticmethod
    def extract_first_json_object(text: str) -> dict[str, Any]:
        text = text.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if "\n" in text:
                text = text.split("\n", 1)[1]
        start = text.find("{")
        if start == -1:
            raise ValueError("No JSON object found in response")

        depth = 0
        in_string = False
        escape = False
        for index in range(start, len(text)):
            char = text[index]
            if in_string:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(text[start : index + 1])
        raise ValueError("Unbalanced JSON object in response")

    def complete_json(
        self,
        *,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        retry_attempts: int,
    ) -> LlmResult:
        last_error: Exception | None = None
        raw_text = ""
        current_max_tokens = max_tokens
        for attempt in range(1, retry_attempts + 1):
            try:
                response = self._create_chat_completion(
                    messages=messages,
                    temperature=temperature,
                    max_tokens=current_max_tokens,
                    json_mode=True,
                )
                raw_text = self.extract_message_text(response)
                choices = response.get("choices") or []
                finish_reason = choices[0].get("finish_reason") if choices else None
                payload = self.extract_first_json_object(raw_text)
                return LlmResult(
                    payload=payload,
                    raw_text=raw_text,
                    attempts=attempt,
                    finish_reason=finish_reason,
                )
            except (APIConnectionError, APITimeoutError, TimeoutError, json.JSONDecodeError, ValueError, RateLimitError) as error:
                last_error = error
                if "{" in raw_text:
                    current_max_tokens = min(max(current_max_tokens + 1200, int(current_max_tokens * 1.5)), 10000)
                time.sleep(min(attempt * 5, 30))
            except APIStatusError as error:
                last_error = error
                if getattr(error, "status_code", None) in {429, 503}:
                    if "{" in raw_text:
                        current_max_tokens = min(max(current_max_tokens + 1200, int(current_max_tokens * 1.5)), 10000)
                    time.sleep(min(attempt * 5, 30))
                    continue
                break
        detail = raw_text[:1000] if raw_text else ""
        raise RuntimeError(f"{last_error or 'LLM request failed'} | raw_excerpt={detail}")
