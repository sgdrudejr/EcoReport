#!/usr/bin/env python3
"""Ask Qwen for a final account strategy from the deterministic Cockpit view."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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
    parser = argparse.ArgumentParser(description="Qwen final account strategy test")
    parser.add_argument("--date", required=True)
    parser.add_argument("--run-date", default=None)
    parser.add_argument("--effective-market-date", default=None)
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--model", default=os.getenv("QWEN_ACCOUNT_STRATEGY_MODEL") or DEFAULT_MODEL)
    parser.add_argument("--base-url", default=os.getenv("QWEN_BASE_URL") or DEFAULT_BASE_URL)
    parser.add_argument("--web-search", action="store_true")
    parser.add_argument("--search-strategy", default="turbo", choices=["turbo", "max", "agent", "agent_max"])
    parser.add_argument("--forced-search", action="store_true")
    parser.add_argument("--no-fallback", action="store_true")
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


def compact_text(value: Any, limit: int = 160) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def take(items: Any, limit: int) -> list[Any]:
    return items[:limit] if isinstance(items, list) else []


def slim_holding(holding: dict[str, Any]) -> dict[str, Any]:
    position = holding.get("position") or {}
    attractiveness = holding.get("attractiveness") or {}
    fundamental = holding.get("fundamental") or {}
    metrics = fundamental.get("metrics") or {}
    market = fundamental.get("market") or {}
    return {
        "accountLabel": holding.get("accountLabel"),
        "code": holding.get("code"),
        "name": holding.get("name"),
        "category": holding.get("category"),
        "decision": holding.get("decision"),
        "profitRate": position.get("profitRate"),
        "weight": position.get("weight"),
        "marketValue": position.get("marketValue"),
        "attractiveness": {
            "overall": attractiveness.get("overall"),
            "label": attractiveness.get("label"),
            "drivers": take(attractiveness.get("drivers"), 3),
            "gaps": take((attractiveness.get("dataQuality") or {}).get("gaps"), 3),
        },
        "metrics": {
            "per": metrics.get("estimatedPer") or metrics.get("per"),
            "pbr": metrics.get("pbr"),
            "roe": metrics.get("roeEstimate") or metrics.get("roe"),
            "epsGrowthPct": metrics.get("estimatedEpsGrowthPct") or metrics.get("epsGrowthPct"),
        },
        "market": {
            "changePct": market.get("changePct"),
            "rank": market.get("rank"),
            "navGapPct": market.get("navGapPct"),
        },
        "addConditions": take(holding.get("addConditions"), 2),
        "trimConditions": take(holding.get("trimConditions"), 2),
        "invalidationConditions": take(holding.get("invalidationConditions"), 2),
        "riskFlags": take(holding.get("riskFlags"), 5),
    }


def slim_action(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "accountLabel": item.get("accountLabel"),
        "code": item.get("code"),
        "name": item.get("name"),
        "action": item.get("action"),
        "decisionLabel": item.get("decisionLabel"),
        "score": item.get("score"),
        "attractiveness": item.get("attractiveness"),
        "instruction": compact_text(item.get("instruction"), 130),
        "trigger": compact_text(item.get("trigger"), 130),
        "avoid": compact_text(item.get("avoid"), 100),
    }


def slim_sell(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "accountLabel": item.get("accountLabel"),
        "code": item.get("code"),
        "name": item.get("name"),
        "action": item.get("action"),
        "profitRate": item.get("profitRate"),
        "attractiveness": item.get("attractiveness"),
        "decision": compact_text(item.get("decision"), 140),
        "trigger": compact_text(item.get("trigger"), 140),
        "reason": compact_text(item.get("reason"), 140),
    }


def slim_sector(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "sector": item.get("sector"),
        "score": item.get("score"),
        "label": item.get("label"),
        "action": item.get("action"),
        "trend": item.get("trend"),
        "changePct": item.get("changePct"),
        "leaders": take(item.get("leaders"), 5),
        "matchedStocks": [
            {
                "name": stock.get("name"),
                "code": stock.get("code"),
                "stockeasyScore": stock.get("stockeasyScore"),
                "score": stock.get("score"),
                "dataNeeds": take(stock.get("dataNeeds"), 3),
            }
            for stock in take(item.get("matchedStocks"), 5)
        ],
        "matchedEtfs": [
            {
                "name": etf.get("name"),
                "code": etf.get("code"),
                "held": etf.get("held"),
                "score": etf.get("score"),
                "matchScore": etf.get("matchScore"),
                "changePct": etf.get("changePct"),
                "dataNeeds": take(etf.get("dataNeeds"), 3),
                "reasons": take(etf.get("reasons"), 4),
            }
            for etf in take(item.get("matchedEtfs"), 4)
        ],
        "implication": compact_text(item.get("implication"), 130),
        "buyQuestion": compact_text(item.get("buyQuestion"), 130),
    }


def compact_dashboard(view: dict[str, Any]) -> dict[str, Any]:
    decision = view.get("decisionBrief") or {}
    sell = view.get("sellBrief") or {}
    stockeasy = view.get("stockeasyPulse") or {}
    action_lanes = decision.get("lanes") or {}
    sell_lanes = sell.get("lanes") or {}
    holdings = view.get("holdings") or []
    priority_holdings = sorted(
        holdings,
        key=lambda item: (
            "BLOCKED" in str((item.get("decision") or {}).get("bucket") or ""),
            -float((item.get("position") or {}).get("profitRate") or 0),
            -float(((item.get("attractiveness") or {}).get("overall") or 0)),
        ),
    )
    return {
        "meta": view.get("meta"),
        "health": view.get("health"),
        "sourceCoverage": view.get("sourceCoverage"),
        "portfolio": view.get("portfolio"),
        "decisionBrief": {
            "stance": decision.get("stance"),
            "headline": decision.get("headline"),
            "counts": decision.get("counts"),
            "do": [slim_action(x) for x in take(action_lanes.get("do"), 6)],
            "wait": [slim_action(x) for x in take(action_lanes.get("wait"), 8)],
            "avoid": [slim_action(x) for x in take(action_lanes.get("avoid"), 10)],
            "layerImplications": take(decision.get("layerImplications"), 6),
        },
        "sellBrief": {
            "headline": sell.get("headline"),
            "counts": sell.get("counts"),
            "trim": [slim_sell(x) for x in take(sell_lanes.get("trim"), 8)],
            "stop": [slim_sell(x) for x in take(sell_lanes.get("stop"), 4)],
            "watch": [slim_sell(x) for x in take(sell_lanes.get("watch"), 6)],
        },
        "holdings": [slim_holding(x) for x in priority_holdings[:24]],
        "stockeasyPulse": {
            "marketSignal": stockeasy.get("marketSignal"),
            "counts": stockeasy.get("counts"),
            "etfRadar": [slim_sector(x) for x in take(stockeasy.get("etfRadar"), 18)],
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


def known_numbers_from(value: Any) -> set[str]:
    known: set[str] = {"0", "1", "2", "3", "4", "5", "20", "65", "70", "75", "100"}

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            for child in node.values():
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)
        elif isinstance(node, (int, float)) and not isinstance(node, bool):
            number = float(node)
            known.add(str(node))
            known.add(str(round(number, 1)))
            known.add(str(round(number, 2)))
            known.add(str(int(number)))
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
        if match not in known_numbers and str(round(number, 1)) not in known_numbers and str(int(number)) not in known_numbers:
            return True
    return False


def sanitize_numbers(value: Any, known_numbers: set[str], warnings: list[str], path: str = "$") -> Any:
    if isinstance(value, dict):
        return {key: sanitize_numbers(child, known_numbers, warnings, f"{path}.{key}") for key, child in value.items()}
    if isinstance(value, list):
        return [sanitize_numbers(child, known_numbers, warnings, f"{path}[{index}]") for index, child in enumerate(value)]
    if isinstance(value, str) and has_unseen_material_number(value, known_numbers):
        warnings.append(f"{path}: {compact_text(value, 120)}")
        if value.startswith("미확인수치:"):
            return value
        return f"미확인수치: {value}"
    return value


def sanitize_payload(payload: dict[str, Any], compact: dict[str, Any]) -> dict[str, Any]:
    warnings: list[str] = []
    sanitized = sanitize_numbers(payload, known_numbers_from(compact), warnings)
    if isinstance(sanitized, dict):
        for item in sanitized.get("todayDo") or []:
            if not isinstance(item, dict):
                continue
            text = " ".join(str(item.get(key) or "") for key in ("action", "reason", "condition", "doNot"))
            if item.get("action") == "조건매수" and re.search(r"이익실현|익절|감량|하락 반전|이탈|추격매수.*금지", text):
                item["action"] = "감량검토" if re.search(r"이익실현|익절|감량|이탈", text) else "추격금지"
        sanitized["validationWarnings"] = warnings[:12]
    return sanitized if isinstance(sanitized, dict) else payload


def build_prompt(compact: dict[str, Any], *, web_search: bool) -> str:
    web_rule = (
        "웹검색은 보조 검증에만 사용하라. Cockpit 데이터와 충돌하면 Cockpit의 차단/위험 플래그를 우선하라."
        if web_search
        else "외부 웹검색 없이 제공된 Cockpit 데이터만 사용하라."
    )
    return f"""
너는 EcoReport의 최종 계좌전략 코치다.
목표는 '그래서 내 계좌를 오늘 어떻게 해야 하는가'에 답하는 것이다.

절대 원칙:
- 투자 권유처럼 단정하지 말고 실행조건/보류조건을 분리한다.
- Cockpit이 BLOCKED_BUY 또는 매수금지로 둔 항목을 매수 추천하지 않는다.
- 과열, RSI, 상단돌파, 당일급등, 섹터 약화중/하락중이면 추격매수를 금지한다.
- 현금이 부족한 계좌에는 신규매수보다 보유/감량/대기 판단을 우선한다.
- 데이터가 없으면 '자료보강'으로 보낸다.
- 익절/감량/이탈/하락반전 조건은 절대로 '조건매수'가 아니다. 이런 경우 action은 '감량검토' 또는 '보유유지'다.
- {web_rule}
- 입력 JSON에 없는 목표가, 매도수량, 신규 종목을 만들지 않는다.
- 한국어로 짧고 실전적으로 쓴다.

반드시 JSON object 하나만 반환:
{{
  "status": "ok",
  "headline": "오늘 계좌 한 줄 결론",
  "stance": "방어|중립|선별공격|공격",
  "todayDo": [
    {{
      "priority": "높음|중간|낮음",
      "action": "보유유지|감량검토|조건매수|추격금지|자료보강|손절감시",
      "accountLabel": "계좌명 또는 전체",
      "name": "종목/ETF/섹터",
      "reason": "왜",
      "condition": "언제 실행",
      "doNot": "하지 말 것"
    }}
  ],
  "todayDoNot": ["하지 말아야 할 행동"],
  "sellWatch": [
    {{
      "accountLabel": "계좌명",
      "name": "종목/ETF",
      "action": "부분익절|손절감시|보유유지",
      "reason": "왜",
      "trigger": "실행 조건"
    }}
  ],
  "buyWatch": [
    {{
      "name": "종목/ETF/섹터",
      "action": "조건대기|관찰|자료보강|매수금지",
      "reason": "왜",
      "trigger": "조건"
    }}
  ],
  "sectorView": [
    {{
      "sector": "섹터",
      "view": "상승중|회복중|횡보|약화중|하락중",
      "action": "ETF탐색|후보검토|눌림관찰|보류|자료보강",
      "reason": "왜"
    }}
  ],
  "weeklyChecklist": ["이번 주 확인할 조건"],
  "missingData": ["보강해야 할 데이터"],
  "riskWarnings": ["주의사항"],
  "confidence": 0
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


def call_qwen(args: argparse.Namespace, prompt: str) -> tuple[dict[str, Any], str, str]:
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
                        "content": "You are a Korean portfolio strategy coach. Return only valid JSON.",
                    },
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.15,
                "max_tokens": 3600,
                "response_format": {"type": "json_object"},
            }
            if extra_body:
                kwargs["extra_body"] = extra_body
            response = client.chat.completions.create(**kwargs)
            raw = response.choices[0].message.content if response.choices else ""
            if not raw:
                raise RuntimeError("Qwen 응답이 비어 있습니다.")
            return extract_json(raw), raw, model
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            continue
    raise RuntimeError(f"Qwen 호출 실패: {last_error}") from last_error


def main() -> None:
    args = parse_args()
    dashboard_path = ROOT / "data" / "dashboard" / f"{args.date}-dashboard-view.json"
    output_path = (
        Path(args.output)
        if args.output
        else ROOT / "data" / "analysis-state" / args.date / "qwen-account-strategy.json"
    )
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
        payload, raw, used_model = call_qwen(args, prompt)
        payload = sanitize_payload(payload, compact)
        output = {
            **meta,
            "model": used_model,
            "requestedModel": args.model,
            "status": payload.get("status") or "ok",
            "headline": payload.get("headline") or "",
            "stance": payload.get("stance") or "",
            "todayDo": payload.get("todayDo") or [],
            "todayDoNot": payload.get("todayDoNot") or [],
            "sellWatch": payload.get("sellWatch") or [],
            "buyWatch": payload.get("buyWatch") or [],
            "sectorView": payload.get("sectorView") or [],
            "weeklyChecklist": payload.get("weeklyChecklist") or [],
            "missingData": payload.get("missingData") or [],
            "riskWarnings": payload.get("riskWarnings") or [],
            "confidence": payload.get("confidence"),
            "validationWarnings": payload.get("validationWarnings") or [],
            "rawExcerpt": raw[:1200],
        }
    except Exception as exc:  # noqa: BLE001
        output = {
            **meta,
            "status": "failed",
            "error": str(exc),
            "headline": "Qwen 계좌전략 생성 실패",
            "todayDo": [],
            "todayDoNot": [],
            "sellWatch": [],
            "buyWatch": [],
            "sectorView": [],
            "weeklyChecklist": [],
            "missingData": [],
            "riskWarnings": [],
        }

    write_json(output_path, output)
    print(f"Wrote Qwen account strategy to {output_path}")
    print(f"status={output.get('status')} webSearch={output.get('webSearch')} model={output.get('model')}")
    if output.get("status") == "failed":
        print(output.get("error"), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
