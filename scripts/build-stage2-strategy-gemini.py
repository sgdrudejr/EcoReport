#!/usr/bin/env python3
"""
Stage 2 전략 탐색을 Gemini 무료 Flash 모델로 실행해 JSON 결과를 저장한다.

예시:
  python3 scripts/build-stage2-strategy-gemini.py --date 2026-04-03
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai


ROOT = Path(os.getenv("ECOREPORT_ROOT") or Path(__file__).resolve().parent.parent)
DEFAULT_PRIORITY_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
]
DEFAULT_MAX_RETRIES = 5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Gemini로 Stage 2 전략 JSON 생성")
    parser.add_argument("--date", required=True, help="대상 날짜 (YYYY-MM-DD)")
    parser.add_argument("--run-date", default=None, help="실행일 (YYYY-MM-DD)")
    parser.add_argument("--effective-market-date", default=None, help="기준 거래일 (YYYY-MM-DD)")
    parser.add_argument(
        "--prompt",
        help="입력 프롬프트 경로. 생략 시 manual-kit의 08-stage2-strategy-prompt.md 사용",
    )
    parser.add_argument(
        "--output",
        help="출력 JSON 경로. 생략 시 data/analysis-state/<date>/stage2-strategy-options.json 사용",
    )
    parser.add_argument(
        "--model",
        default=None,
        help="강제 사용할 Gemini 모델명. 기본은 사용 가능한 무료 Flash 중 우선순위 선택",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.2,
        help="생성 온도",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=DEFAULT_MAX_RETRIES,
        help="quota/429 발생 시 전체 호출 재시도 횟수",
    )
    return parser.parse_args()


def load_api_key() -> str:
    env_path = ROOT / ".env"
    if env_path.exists():
        load_dotenv(env_path)
    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY가 설정되어 있지 않습니다.")
    return api_key


def create_client(api_key: str) -> genai.Client:
    return genai.Client(api_key=api_key)


def get_available_models(client: genai.Client) -> list[str]:
    available = set()
    for model in client.models.list():
        name = model.name.replace("models/", "")
        actions = set(getattr(model, "supported_actions", []) or [])
        methods = set(getattr(model, "supported_generation_methods", []) or [])
        if "generateContent" in actions or "generateContent" in methods:
            available.add(name)

    return sorted(available)


def choose_models(client: genai.Client, preferred: str | None) -> list[str]:
    if preferred:
        return [preferred]

    available = set(get_available_models(client))
    candidates: list[str] = []

    for candidate in DEFAULT_PRIORITY_MODELS:
        if candidate in available:
            candidates.append(candidate)

    for name in sorted(available):
        if "flash" in name and name not in candidates:
            candidates.append(name)

    if not candidates:
        raise RuntimeError("사용 가능한 Gemini Flash 모델을 찾지 못했습니다.")

    return candidates


def extract_json_block(text: str) -> Any:
    fenced = re.findall(r"```(?:json)?\s*(.*?)```", text, flags=re.S)
    candidates = [*fenced, text]

    bracket_match = re.search(r"(\{.*\}|\[.*\])", text, flags=re.S)
    if bracket_match:
        candidates.insert(0, bracket_match.group(1))

    for candidate in candidates:
        snippet = candidate.strip()
        if not snippet:
            continue
        try:
            return json.loads(snippet)
        except json.JSONDecodeError:
            continue
    raise RuntimeError("Gemini 응답에서 유효한 JSON을 찾지 못했습니다.")


def read_prompt(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"프롬프트 파일이 없습니다: {path}")
    return path.read_text(encoding="utf-8")


def validate_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise RuntimeError("Stage 2 응답은 JSON object 여야 합니다.")

    required = [
        "macro_view",
        "strategy_changes",
        "account_actions",
        "candidate_scores",
        "portfolio_risks",
    ]
    for key in required:
        if key not in payload:
            raise RuntimeError(f"Stage 2 응답에 필수 키가 없습니다: {key}")

    return payload


def extract_exception_message(exc: Exception) -> str:
    return str(exc).strip()


def parse_retry_delay_seconds(message: str) -> int | None:
    match = re.search(r"Please retry in ([0-9.]+)s", message)
    if match:
        return max(1, int(float(match.group(1))) + 1)

    seconds_match = re.search(r"retry_delay\s*\{\s*seconds:\s*(\d+)", message)
    if seconds_match:
        return max(1, int(seconds_match.group(1)) + 1)

    return None


def is_retryable_transient_error(message: str) -> bool:
    lowered = message.lower()
    return (
        "resourceexhausted" in lowered
        or "quota exceeded" in lowered
        or "please retry in" in lowered
        or "429" in lowered
        or "503" in lowered
        or "unavailable" in lowered
        or "high demand" in lowered
        or "temporarily unavailable" in lowered
        or "deadline exceeded" in lowered
        or "timed out" in lowered
    )


def generate_json_response(
    client: genai.Client,
    model_name: str,
    prompt: str,
    temperature: float,
) -> tuple[dict[str, Any], str]:
    retry_suffixes = [
        "",
        "\n\n중요: 반드시 마지막 `}`까지 닫힌 완전한 JSON object 한 개만 반환하세요. 코드펜스나 설명 문장은 절대 붙이지 마세요.",
        "\n\n이전 시도에서 JSON이 잘렸습니다. candidate_scores는 최대 6개, portfolio_risks는 최대 4개로 더 압축하고, 모든 필수 키를 유지한 완전한 JSON object 한 개만 반환하세요.",
    ]

    last_error: Exception | None = None
    last_raw = ""

    for suffix in retry_suffixes:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt + suffix,
            config={
                "temperature": temperature,
                "max_output_tokens": 8192,
                "response_mime_type": "application/json",
            },
        )
        raw_text = (getattr(response, "text", None) or "").strip()
        if not raw_text:
            last_error = RuntimeError("Gemini 응답이 비어 있습니다.")
            continue

        last_raw = raw_text
        try:
            payload = validate_payload(extract_json_block(raw_text))
            return payload, raw_text
        except Exception as exc:  # noqa: BLE001
            last_error = exc

    if last_error is None:
        last_error = RuntimeError("Gemini 응답에서 유효한 JSON을 찾지 못했습니다.")
    raise RuntimeError(f"{last_error} | raw_length={len(last_raw)}")


def generate_json_response_with_retry(
    client: genai.Client,
    model_names: list[str],
    prompt: str,
    temperature: float,
    max_retries: int,
) -> tuple[dict[str, Any], str, str]:
    last_error: Exception | None = None
    sleep_seconds = 0

    for attempt in range(1, max_retries + 1):
        for model_name in model_names:
            try:
                payload, raw_text = generate_json_response(client, model_name, prompt, temperature)
                return payload, raw_text, model_name
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                message = extract_exception_message(exc)
                delay = parse_retry_delay_seconds(message)
                if delay:
                    sleep_seconds = max(sleep_seconds, delay)

                if is_retryable_transient_error(message):
                    continue
                raise

        if attempt < max_retries:
            wait_for = sleep_seconds or min(180, 45 * attempt)
            print(
                f"[stage2-gemini] 일시적 외부 오류로 {wait_for}s 대기 후 재시도 "
                f"({attempt}/{max_retries})",
                flush=True,
            )
            time.sleep(wait_for)
            sleep_seconds = 0

    if last_error is None:
        raise RuntimeError("Gemini Stage 2 호출에 실패했습니다.")
    raise last_error


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main() -> None:
    args = parse_args()
    prompt_path = Path(args.prompt) if args.prompt else ROOT / "knowledge" / "daily" / "manual-kit" / args.date / "08-stage2-strategy-prompt.md"
    output_path = Path(args.output) if args.output else ROOT / "data" / "analysis-state" / args.date / "stage2-strategy-options.json"
    raw_output_path = output_path.with_suffix(".raw.txt")

    api_key = load_api_key()
    client = create_client(api_key)
    model_names = choose_models(client, args.model)
    prompt = read_prompt(prompt_path)

    payload, raw_text, model_name = generate_json_response_with_retry(
        client,
        model_names,
        prompt,
        args.temperature,
        max(1, args.max_retries),
    )
    write_text(raw_output_path, raw_text)
    payload["date"] = args.date
    payload["runDate"] = args.run_date or args.date
    payload["effectiveMarketDate"] = args.effective_market_date or args.date
    payload["runId"] = payload.get("runId") or (os.getenv("ECOREPORT_RUN_ID") or "").strip() or None
    payload["generatedAt"] = (
        payload.get("generatedAt")
        or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    )
    payload["source"] = "gemini"
    payload["model"] = model_name

    write_json(output_path, payload)
    print(output_path)


if __name__ == "__main__":
    main()
