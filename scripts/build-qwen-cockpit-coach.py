#!/usr/bin/env python3
"""Build a Qwen-powered cockpit coach overlay.

Reads the deterministic Cockpit JSON and asks Qwen to challenge the buy/sell
actions. Web search can be enabled for current-news checks, but the output is
stored as a separate advisory overlay so deterministic gates remain intact.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from openai import OpenAI

from lib.env_loader import load_simple_dotenv


ROOT = Path(os.getenv("ECOREPORT_ROOT") or Path(__file__).resolve().parent.parent)
DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
DEFAULT_MODEL = "qwen3.5-plus"
DEFAULT_FALLBACK_MODELS = [
    "qwen3.5-plus",
    "qwen3.5-plus-2026-02-15",
    "qwen3.5-flash",
    "qwen3.5-flash-2026-02-23",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Qwen Cockpit coach overlay")
    parser.add_argument("--date", required=True)
    parser.add_argument("--run-date", default=None)
    parser.add_argument("--effective-market-date", default=None)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--model", default=os.getenv("QWEN_COCKPIT_MODEL") or DEFAULT_MODEL)
    parser.add_argument("--base-url", default=os.getenv("QWEN_BASE_URL") or DEFAULT_BASE_URL)
    parser.add_argument("--web-search", action="store_true")
    parser.add_argument("--search-strategy", default="turbo", choices=["turbo", "max", "agent", "agent_max"])
    parser.add_argument("--forced-search", action="store_true")
    parser.add_argument(
        "--no-fallback",
        action="store_true",
        help="모델 오류가 나도 Qwen fallback 모델을 시도하지 않습니다.",
    )
    parser.add_argument("--output", default=None)
    return parser.parse_args()


def read_json(path: Path, fallback: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_api_key() -> str:
    env_path = ROOT / ".env"
    if env_path.exists():
        load_simple_dotenv(env_path)
    api_key = (os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("QWEN_API_KEY 또는 DASHSCOPE_API_KEY가 설정되어 있지 않습니다.")
    return api_key


def compact_dashboard(view: dict[str, Any]) -> dict[str, Any]:
    decision = view.get("decisionBrief") or {}
    sell = view.get("sellBrief") or {}
    layers = view.get("analysisLayers") or {}

    def slim_action(item: dict[str, Any]) -> dict[str, Any]:
        return {
            "code": item.get("code"),
            "name": item.get("name"),
            "accountLabel": item.get("accountLabel"),
            "action": item.get("action"),
            "decisionLabel": item.get("decisionLabel"),
            "score": item.get("score"),
            "attractiveness": item.get("attractiveness"),
            "instruction": item.get("instruction"),
            "because": item.get("because"),
            "trigger": item.get("trigger"),
            "avoid": item.get("avoid"),
        }

    def slim_sell(item: dict[str, Any]) -> dict[str, Any]:
        return {
            "code": item.get("code"),
            "name": item.get("name"),
            "accountLabel": item.get("accountLabel"),
            "action": item.get("action"),
            "profitRate": item.get("profitRate"),
            "marketValue": item.get("marketValue"),
            "size": item.get("size"),
            "decision": item.get("decision"),
            "trigger": item.get("trigger"),
            "reason": item.get("reason"),
        }

    return {
        "meta": view.get("meta"),
        "health": view.get("health", {}).get("overallStatus"),
        "portfolio": view.get("portfolio"),
        "decisionBrief": {
            "stance": decision.get("stance"),
            "headline": decision.get("headline"),
            "counts": decision.get("counts"),
            "do": [slim_action(x) for x in (decision.get("lanes", {}).get("do") or [])[:4]],
            "wait": [slim_action(x) for x in (decision.get("lanes", {}).get("wait") or [])[:4]],
            "avoid": [slim_action(x) for x in (decision.get("lanes", {}).get("avoid") or [])[:4]],
        },
        "sellBrief": {
            "headline": sell.get("headline"),
            "counts": sell.get("counts"),
            "sellNow": [slim_sell(x) for x in (sell.get("lanes", {}).get("sellNow") or [])[:4]],
            "trim": [slim_sell(x) for x in (sell.get("lanes", {}).get("trim") or [])[:6]],
            "stop": [slim_sell(x) for x in (sell.get("lanes", {}).get("stop") or [])[:4]],
        },
        "layers": {
            "market": layers.get("market"),
            "themes": (layers.get("themes") or [])[:6],
            "sectors": (layers.get("sectors") or [])[:6],
            "etfs": (layers.get("etfs") or [])[:8],
            "stocks": (layers.get("stocks") or [])[:8],
        },
    }


def extract_json(text: str) -> dict[str, Any]:
    candidates = re.findall(r"```(?:json)?\s*(.*?)```", text, flags=re.S)
    candidates.append(text)
    bracket = re.search(r"(\{.*\})", text, flags=re.S)
    if bracket:
        candidates.insert(0, bracket.group(1))
    for candidate in candidates:
        try:
            parsed = json.loads(candidate.strip())
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    raise RuntimeError("Qwen 응답에서 JSON object를 파싱하지 못했습니다.")


def specific_urls(urls: Any) -> list[str]:
    result: list[str] = []
    iterable = urls if isinstance(urls, list) else []
    for raw in iterable:
        url = str(raw or "").strip()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            continue
        if parsed.path in {"", "/"}:
            continue
        if url not in result:
            result.append(url)
    return result[:3]


def known_numbers_from(value: Any) -> set[str]:
    known: set[str] = set()

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            for child in node.values():
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)
        elif isinstance(node, (int, float)) and not isinstance(node, bool):
            known.add(str(node))
            known.add(str(round(float(node), 1)))
            known.add(str(round(float(node), 2)))
            known.add(str(int(float(node))))
        elif isinstance(node, str):
            for match in re.findall(r"\d+(?:\.\d+)?", node):
                known.add(match)

    visit(value)
    return known


def has_unseen_material_number(text: str, known_numbers: set[str]) -> bool:
    for match in re.findall(r"\d+(?:\.\d+)?", text):
        number = float(match)
        if 1900 <= number <= 2100:
            continue
        if number <= 31:
            continue
        if match not in known_numbers and str(int(number)) not in known_numbers:
            return True
    return False


def sanitize_payload(payload: dict[str, Any], *, web_search: bool, compact: dict[str, Any]) -> dict[str, Any]:
    known_numbers = known_numbers_from(compact)
    for item in payload.get("sellCoach") or []:
        if not isinstance(item, dict):
            continue
        urls = specific_urls(item.get("sourceUrls"))
        item["sourceUrls"] = urls
        if web_search and item.get("webCheck") == "확인" and not urls:
            item["webCheck"] = "미확인"
    if web_search:
        cleaned_warnings: list[str] = []
        for warning in payload.get("riskWarnings") or []:
            text = str(warning or "").strip()
            if not text:
                continue
            if has_unseen_material_number(text, known_numbers) and not text.startswith("미확인"):
                text = f"미확인: {text}"
            cleaned_warnings.append(text)
        payload["riskWarnings"] = cleaned_warnings
    return payload


def build_prompt(compact: dict[str, Any], *, web_search: bool) -> str:
    web_rule = (
        "웹검색을 사용할 수 있으면 최신 뉴스/공시/시장 기사로 핵심 리스크를 교차검증하라. "
        "검색으로 확인한 내용은 반드시 개별 기사/공시/데이터 페이지의 URL을 sourceUrls에 넣어라. "
        "홈페이지 도메인만 있거나 출처 URL이 없으면 확인된 사실로 쓰지 말고 '미확인' 또는 '자료보강'으로 내려라."
        if web_search
        else "외부 웹검색 없이 제공된 Cockpit 데이터만 사용하라."
    )
    return f"""
너는 내 포트폴리오 매매 코치다. 아래 deterministic Cockpit 판단을 뒤집으려 하지 말고,
매수/매도 액션이 과감하거나 부족한지 2차 검증하라.

원칙:
- 투자 조언을 장황하게 쓰지 말고, 실제 다음 행동만 말한다.
- 특히 매도는 전량매도/부분익절/손절감시/유지로 나눈다.
- 숫자가 좋아도 과열/차단이면 매수 권고를 낮춰라.
- 근거가 부족하면 '자료보강'으로 보내라.
- {web_rule}
- 입력 Cockpit JSON에 없는 거시 숫자, 매도 규모, 목표가, 지수 레벨을 새로 단정하지 마라.
- riskWarnings는 Cockpit 입력값이거나 sourceUrls로 확인된 내용만 써라. 출처가 약하면 researchBacklog로 보내라.
- 한국 종목/ETF, 보유계좌, 실제 매수/매도 조건에 직접 연결되는 내용만 남겨라.

반드시 JSON object 하나만 반환:
{{
  "status": "ok",
  "headline": "한 문장 결론",
  "sellCoach": [
    {{
      "code": "string",
      "name": "string",
      "accountLabel": "string",
      "action": "전량검토|부분익절|손절감시|유지",
      "confidence": 0-100,
      "reason": "짧은 이유",
      "trigger": "실행 조건",
      "webCheck": "확인|미확인|불필요",
      "sourceUrls": ["url"]
    }}
  ],
  "buyCoach": [
    {{
      "code": "string",
      "name": "string",
      "action": "분할매수|조건대기|매수금지|관찰",
      "confidence": 0-100,
      "reason": "짧은 이유",
      "trigger": "실행 조건"
    }}
  ],
  "riskWarnings": ["string"],
  "researchBacklog": [
    {{
      "question": "확인해야 할 질문",
      "why": "왜 필요한지",
      "priority": "높음|중간|낮음"
    }}
  ],
  "searchedQueries": ["string"]
}}

Cockpit JSON:
{json.dumps(compact, ensure_ascii=False)}
""".strip()


def model_candidates(args: argparse.Namespace) -> list[str]:
    if args.no_fallback:
        return [args.model]
    candidates = [args.model, *DEFAULT_FALLBACK_MODELS]
    unique: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in unique:
            unique.append(candidate)
    return unique


def call_qwen(args: argparse.Namespace, prompt: str, compact: dict[str, Any]) -> tuple[dict[str, Any], str, str]:
    client = OpenAI(api_key=load_api_key(), base_url=args.base_url)
    extra_body: dict[str, Any] = {}
    if args.web_search:
        extra_body = {
            "enable_search": True,
            "search_options": {
                "forced_search": bool(args.forced_search),
                "search_strategy": args.search_strategy,
            },
        }
    last_error: Exception | None = None
    for model in model_candidates(args):
        try:
            kwargs: dict[str, Any] = {
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a Korean buy-side portfolio coach. Return only valid JSON.",
                    },
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                "max_tokens": 3200,
                "response_format": {"type": "json_object"},
            }
            if extra_body:
                kwargs["extra_body"] = extra_body
            response = client.chat.completions.create(**kwargs)
            raw = response.choices[0].message.content if response.choices else ""
            if not raw:
                raise RuntimeError("Qwen 응답이 비어 있습니다.")
            return sanitize_payload(extract_json(raw), web_search=args.web_search, compact=compact), raw, model
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            continue
    raise RuntimeError(f"Qwen 호출 실패: {last_error}") from last_error


def main() -> None:
    args = parse_args()
    dashboard_path = ROOT / "data" / "dashboard" / f"{args.date}-dashboard-view.json"
    output_path = Path(args.output) if args.output else ROOT / "data" / "analysis-state" / args.date / "qwen-cockpit-coach.json"
    view = read_json(dashboard_path, None)
    if not view:
        raise RuntimeError(f"Dashboard view를 읽을 수 없습니다: {dashboard_path}")

    compact = compact_dashboard(view)
    prompt = build_prompt(compact, web_search=args.web_search)
    meta = {
        "date": args.date,
        "runDate": args.run_date,
        "effectiveMarketDate": args.effective_market_date or args.date,
        "runId": args.run_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "provider": "qwen",
        "model": args.model,
        "baseUrl": args.base_url,
        "webSearch": bool(args.web_search),
        "searchStrategy": args.search_strategy if args.web_search else None,
        "forcedSearch": bool(args.forced_search),
    }

    try:
        payload, raw, used_model = call_qwen(args, prompt, compact)
        output = {
            **meta,
            "model": used_model,
            "requestedModel": args.model,
            "status": payload.get("status") or "ok",
            "headline": payload.get("headline") or "",
            "sellCoach": payload.get("sellCoach") or [],
            "buyCoach": payload.get("buyCoach") or [],
            "riskWarnings": payload.get("riskWarnings") or [],
            "researchBacklog": payload.get("researchBacklog") or [],
            "searchedQueries": payload.get("searchedQueries") or [],
            "rawExcerpt": raw[:1200],
        }
    except Exception as exc:  # noqa: BLE001
        output = {
            **meta,
            "status": "failed",
            "error": str(exc),
            "headline": "Qwen 코치 생성 실패",
            "sellCoach": [],
            "buyCoach": [],
            "riskWarnings": [],
            "researchBacklog": [],
            "searchedQueries": [],
        }

    write_json(output_path, output)
    print(f"Wrote Qwen cockpit coach to {output_path}")
    print(f"status={output.get('status')} webSearch={output.get('webSearch')} model={output.get('model')}")
    if output.get("status") == "failed":
        print(output.get("error"), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
