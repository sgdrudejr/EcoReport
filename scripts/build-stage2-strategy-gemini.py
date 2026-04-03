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
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
import google.generativeai as genai


ROOT = Path("/Users/seo/stock-pilot")
DEFAULT_PRIORITY_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Gemini로 Stage 2 전략 JSON 생성")
    parser.add_argument("--date", required=True, help="대상 날짜 (YYYY-MM-DD)")
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
    return parser.parse_args()


def load_api_key() -> str:
    env_path = ROOT / ".env"
    if env_path.exists():
        load_dotenv(env_path)
    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY가 설정되어 있지 않습니다.")
    return api_key


def choose_model(preferred: str | None) -> str:
    if preferred:
        return preferred

    available = set()
    for model in genai.list_models():
        name = model.name.replace("models/", "")
        methods = set(getattr(model, "supported_generation_methods", []) or [])
        if "generateContent" in methods:
            available.add(name)

    for candidate in DEFAULT_PRIORITY_MODELS:
        if candidate in available:
            return candidate

    for name in sorted(available):
        if "flash" in name:
            return name

    raise RuntimeError("사용 가능한 Gemini Flash 모델을 찾지 못했습니다.")


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
    genai.configure(api_key=api_key)
    model_name = choose_model(args.model)
    prompt = read_prompt(prompt_path)

    model = genai.GenerativeModel(model_name)
    response = model.generate_content(
        prompt,
        generation_config={
            "temperature": args.temperature,
            "max_output_tokens": 8192,
        },
    )
    raw_text = (getattr(response, "text", None) or "").strip()
    if not raw_text:
        raise RuntimeError("Gemini 응답이 비어 있습니다.")

    write_text(raw_output_path, raw_text)
    payload = validate_payload(extract_json_block(raw_text))
    payload["date"] = args.date
    payload["generatedAt"] = payload.get("generatedAt") or datetime.utcnow().isoformat() + "Z"
    payload["source"] = "gemini"
    payload["model"] = model_name

    write_json(output_path, payload)
    print(output_path)


if __name__ == "__main__":
    main()
