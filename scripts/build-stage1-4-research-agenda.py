#!/usr/bin/env python3
"""Stage 1.4b: build research agenda topics from chunk summaries with Qwen API.

Example:
  .venv/bin/python scripts/build-stage1-4-research-agenda.py --date 2026-04-22
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

from openai import OpenAI

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from lib.env_loader import load_simple_dotenv


DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
DEFAULT_OUTPUT_NAME = "stage1-research-agenda.json"
DEFAULT_MODEL_CANDIDATES = [
    "qwen3.5-397b-a17b",
    "qwen3.5-122b-a10b",
    "qwen3.5-27b",
    "qwen3.5-35b-a3b",
    "qwen3.5-plus-2026-02-15",
    "qwen3.5-flash",
]
ALLOWED_TYPES = {"macro", "sector", "security", "new_candidate"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage 1.4b research agenda builder")
    parser.add_argument("--date", required=True, help="대상 날짜 (YYYY-MM-DD)")
    parser.add_argument("--run-date", default=None, help="실행일 (YYYY-MM-DD) - 호환용")
    parser.add_argument("--effective-market-date", default=None, help="기준 거래일 (YYYY-MM-DD) - 호환용")
    parser.add_argument("--run-id", default=None, help="run id - 호환용")
    parser.add_argument("--model", default=None, help="강제 모델명")
    parser.add_argument("--temperature", type=float, default=0.2, help="생성 온도")
    parser.add_argument("--max-retries", type=int, default=2, help="JSON 파싱 실패 재시도 횟수")
    parser.add_argument("--max-input-summaries", type=int, default=30, help="입력 요약 최대 개수")
    parser.add_argument("--min-topics", type=int, default=5, help="최소 토픽 개수")
    parser.add_argument("--max-topics", type=int, default=7, help="최대 토픽 개수")
    parser.add_argument("--output", default=None, help="출력 파일 경로")
    return parser.parse_args()


def load_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").replace("\n", " ").split()).strip()


def truncate_text(value: Any, limit: int) -> str:
    text = normalize_text(value)
    if len(text) <= limit:
        return text
    if limit <= 3:
        return text[:limit]
    return f"{text[: max(0, limit - 3)]}..."


def clamp_int(value: Any, lower: int, upper: int, default: int) -> int:
    try:
        parsed = int(round(float(value)))
    except Exception:
        return default
    return max(lower, min(upper, parsed))


def score_extract_priority(extract: dict[str, Any]) -> int:
    priority = extract.get("priority_score")
    if isinstance(priority, (int, float)):
        return int(round(priority))

    score = 0
    score += len(extract.get("related_holdings_in_my_portfolio") or []) * 12
    score += len(extract.get("portfolio_impacts_candidate") or []) * 10
    score += len(extract.get("related_accounts") or []) * 5

    report_type = str(extract.get("report_type") or "").lower()
    if report_type in {"macro", "strategy"}:
        score += 20
    elif report_type == "industry":
        score += 12
    elif report_type == "theme":
        score += 10

    confidence = str(extract.get("confidence") or "").upper()
    if confidence == "HIGH":
        score += 6
    elif confidence == "MEDIUM":
        score += 3

    sentiment = extract.get("sentiment_score")
    if isinstance(sentiment, (int, float)):
        score += int(round(abs(sentiment) * 10))

    return score


def infer_topic_type_from_extract(extract: dict[str, Any]) -> str:
    report_type = str(extract.get("report_type") or "").lower()
    if report_type in {"macro", "strategy"}:
        return "macro"

    if (extract.get("related_holdings_in_my_portfolio") or []) or (extract.get("portfolio_impacts_candidate") or []):
        return "security"

    if report_type in {"industry", "theme"}:
        return "sector"

    return "new_candidate"


def infer_label_from_extract(extract: dict[str, Any]) -> str:
    themes = extract.get("themes") or []
    if themes:
        return truncate_text(themes[0], 34)

    sector = normalize_text(extract.get("sector") or "")
    if sector and sector != "매크로":
        return truncate_text(sector, 34)

    return truncate_text(extract.get("title") or "리포트 토픽", 34)


def build_default_questions(label: str, topic_type: str) -> list[str]:
    if topic_type == "macro":
        return [
            f"{label} 관련 2026년 최신 매크로 지표 업데이트는?",
            f"{label} 시나리오가 깨지는 반박 신호와 임계치는?",
            f"국내 투자자 기준 계좌별 방어/공격 배치는 어떻게 조정해야 하나?",
        ]
    if topic_type in {"sector", "security"}:
        return [
            f"{label}의 수요/실적/밸류에이션 최신 변화는?",
            f"{label} 관련 핵심 이벤트 일정과 체크포인트는?",
            f"ISA·연금·일반 계좌별로 실행 가능한 대응은?",
        ]
    return [
        f"{label}를 신규 후보로 볼 근거와 촉매는?",
        f"기존 보유 대비 {label}의 상대 우위와 대체 관계는?",
        f"{label}의 No-Go 조건과 재검증 트리거는?",
    ]


def build_keywords_from_extract(extract: dict[str, Any], label: str) -> list[str]:
    values: list[str] = []
    values.extend(extract.get("themes") or [])
    if extract.get("sector"):
        values.append(extract["sector"])

    for holding in extract.get("related_holdings_in_my_portfolio") or []:
        name = normalize_text(holding.get("name") or "")
        if name:
            values.append(name)

    values.append(label)

    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        keyword = truncate_text(value, 24)
        key = keyword.lower()
        if not keyword or key in seen:
            continue
        seen.add(key)
        deduped.append(keyword)
        if len(deduped) >= 5:
            break

    while len(deduped) < 5:
        deduped.append(f"키워드{len(deduped) + 1}")

    return deduped


def build_fallback_summaries_from_extracts(
    extracts: list[dict[str, Any]],
    max_count: int,
) -> list[dict[str, Any]]:
    ranked = sorted(extracts, key=score_extract_priority, reverse=True)
    result: list[dict[str, Any]] = []
    for extract in ranked:
        report_id = normalize_text(extract.get("id") or "")
        if not report_id:
            continue

        summary = (
            normalize_text(extract.get("key_thesis") or "")
            or normalize_text((extract.get("key_points") or [""])[0])
            or normalize_text(extract.get("new_info") or "")
        )
        if not summary:
            continue

        result.append(
            {
                "report_id": report_id,
                "title": extract.get("title") or "",
                "broker": extract.get("broker") or "",
                "sector": extract.get("sector") or "",
                "summary": truncate_text(summary, 260),
                "priority_score": score_extract_priority(extract),
                "report_type": extract.get("report_type") or "",
                "themes": extract.get("themes") or [],
                "related_accounts": extract.get("related_accounts") or [],
                "inferred_type": infer_topic_type_from_extract(extract),
                "label_hint": infer_label_from_extract(extract),
            }
        )

        if len(result) >= max_count:
            break
    return result


def build_summary_inputs(
    state_dir: Path,
    extracts: list[dict[str, Any]],
    max_input: int,
) -> tuple[list[dict[str, Any]], str]:
    enriched_path = state_dir / "stage2-enriched-report-index.json"
    enriched_json = load_json(enriched_path, None)

    if isinstance(enriched_json, dict) and isinstance(enriched_json.get("items"), list) and enriched_json["items"]:
        rows: list[dict[str, Any]] = []
        for item in enriched_json["items"]:
            report_id = normalize_text(item.get("report_id") or "")
            summary = (
                item.get("summary_for_agenda")
                or item.get("summary_stage3_selected")
                or item.get("summary_local_compact")
                or item.get("summary_stage1")
                or ""
            )
            if not report_id or not normalize_text(summary):
                continue

            rows.append(
                {
                    "report_id": report_id,
                    "title": item.get("title") or "",
                    "broker": item.get("broker") or "",
                    "sector": item.get("sector") or "",
                    "summary": truncate_text(summary, 260),
                    "priority_score": clamp_int(item.get("priority_score"), 0, 100, 50),
                    "report_type": item.get("report_type") or "",
                    "themes": item.get("themes") or [],
                    "related_accounts": ((item.get("portfolio_relevance") or {}).get("relatedAccounts") or item.get("related_accounts") or []),
                    "inferred_type": item.get("inferred_type") or "",
                    "label_hint": item.get("label_hint") or truncate_text(item.get("title") or "토픽", 34),
                }
            )

        rows.sort(key=lambda row: row.get("priority_score", 0), reverse=True)
        if rows:
            return rows[:max(1, max_input)], "enriched_report_index"

    summary_path = state_dir / "stage1-chunk-summaries.json"
    summary_json = load_json(summary_path, None)

    if isinstance(summary_json, dict) and isinstance(summary_json.get("summaries"), list) and summary_json["summaries"]:
        by_report = {str(extract.get("id") or ""): extract for extract in extracts}
        rows: list[dict[str, Any]] = []
        for item in summary_json["summaries"]:
            report_id = normalize_text(item.get("report_id") or "")
            if not report_id:
                continue

            linked_extract = by_report.get(report_id, {})
            report_type = linked_extract.get("report_type") or ""
            inferred_type = infer_topic_type_from_extract(linked_extract) if linked_extract else "sector"

            rows.append(
                {
                    "report_id": report_id,
                    "title": item.get("title") or linked_extract.get("title") or "",
                    "broker": item.get("broker") or linked_extract.get("broker") or "",
                    "sector": item.get("sector") or linked_extract.get("sector") or "",
                    "summary": truncate_text(item.get("summary") or "", 260),
                    "priority_score": clamp_int(item.get("priority_score"), 0, 100, score_extract_priority(linked_extract) if linked_extract else 50),
                    "report_type": report_type,
                    "themes": linked_extract.get("themes") or [],
                    "related_accounts": linked_extract.get("related_accounts") or [],
                    "inferred_type": inferred_type,
                    "label_hint": infer_label_from_extract(linked_extract) if linked_extract else truncate_text(item.get("title") or "토픽", 34),
                }
            )

        rows.sort(key=lambda row: row.get("priority_score", 0), reverse=True)
        return rows[:max(1, max_input)], "chunk_summaries"

    fallback = build_fallback_summaries_from_extracts(extracts, max(1, max_input))
    return fallback, "stage1_extracts_fallback"


def extract_json_block(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise RuntimeError("JSON object를 찾지 못했습니다.")

    return json.loads(match.group(0))


def normalize_topic_type(raw_type: Any, label: str, summary: str, fallback: str) -> str:
    token = normalize_text(raw_type).lower().replace("-", "_").replace(" ", "_")

    mapping = {
        "macro": "macro",
        "sector": "sector",
        "security": "security",
        "stock": "security",
        "equity": "security",
        "new_candidate": "new_candidate",
        "newcandidate": "new_candidate",
        "candidate": "new_candidate",
    }
    if token in mapping:
        return mapping[token]

    signal = f"{label} {summary}".lower()
    if any(keyword in signal for keyword in ["금리", "환율", "유가", "연준", "경기", "매크로"]):
        return "macro"
    if any(keyword in signal for keyword in ["종목", "실적", "밸류", "주가", "ticker", "티커"]):
        return "security"
    if any(keyword in signal for keyword in ["신규", "후보", "대안", "미보유"]):
        return "new_candidate"

    return fallback if fallback in ALLOWED_TYPES else "sector"


def normalize_keywords(raw_keywords: Any, label: str, fallback_keywords: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()

    if isinstance(raw_keywords, list):
        for value in raw_keywords:
            keyword = truncate_text(value, 24)
            key = keyword.lower()
            if not keyword or key in seen:
                continue
            seen.add(key)
            result.append(keyword)
            if len(result) >= 5:
                break

    for value in fallback_keywords + [label]:
        if len(result) >= 5:
            break
        keyword = truncate_text(value, 24)
        key = keyword.lower()
        if not keyword or key in seen:
            continue
        seen.add(key)
        result.append(keyword)

    while len(result) < 5:
        result.append(f"키워드{len(result) + 1}")

    return result[:5]


def normalize_questions(raw_questions: Any, label: str, topic_type: str) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()

    if isinstance(raw_questions, list):
        for value in raw_questions:
            question = truncate_text(value, 120)
            key = question.lower()
            if not question or key in seen:
                continue
            seen.add(key)
            result.append(question)
            if len(result) >= 3:
                break

    for question in build_default_questions(label, topic_type):
        if len(result) >= 3:
            break
        key = question.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(question)

    return result[:3]


def normalize_account_keys(raw_keys: Any, known_keys: list[str]) -> list[str]:
    known = {key.upper() for key in known_keys if key}
    result: list[str] = []
    seen: set[str] = set()

    if isinstance(raw_keys, list):
        for value in raw_keys:
            token = normalize_text(value).upper()
            if not token or token in seen:
                continue
            if known and token not in known:
                continue
            seen.add(token)
            result.append(token)

    if result:
        return result
    return known_keys[:2] if known_keys else []


def infer_topics_from_inputs(
    summary_inputs: list[dict[str, Any]],
    known_account_keys: list[str],
    min_topics: int,
    max_topics: int,
) -> list[dict[str, Any]]:
    topics: list[dict[str, Any]] = []
    for row in summary_inputs:
        label = truncate_text(row.get("label_hint") or row.get("title") or row.get("sector") or "토픽", 36)
        topic_type = row.get("inferred_type")
        if topic_type not in ALLOWED_TYPES:
            topic_type = normalize_topic_type(row.get("report_type"), label, row.get("summary") or "", "sector")

        fallback_keywords = build_keywords_from_extract(
            {
                "themes": row.get("themes") or [],
                "sector": row.get("sector") or "",
                "related_holdings_in_my_portfolio": [
                    {"name": account_key}
                    for account_key in (row.get("related_accounts") or [])
                ],
            },
            label,
        )

        topic = {
            "label": label,
            "type": topic_type,
            "summary": truncate_text(row.get("summary") or "", 200),
            "questions": normalize_questions([], label, topic_type),
            "keywords": fallback_keywords,
            "priority": clamp_int(row.get("priority_score"), 1, 100, 60),
            "accountKeys": normalize_account_keys(row.get("related_accounts") or [], known_account_keys),
        }
        topics.append(topic)

    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for topic in sorted(topics, key=lambda item: item.get("priority", 0), reverse=True):
        key = (topic["label"].lower(), topic["type"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(topic)
        if len(deduped) >= max_topics:
            break

    if len(deduped) >= min_topics:
        return deduped

    defaults = [
        {
            "label": "시장 레짐 점검",
            "type": "macro",
            "summary": "거시 변수 변화와 리스크 신호를 점검해 전략의 기본 가정을 재검증합니다.",
            "questions": build_default_questions("시장 레짐", "macro"),
            "keywords": ["금리", "환율", "유가", "유동성", "리스크"],
            "priority": 80,
            "accountKeys": known_account_keys[:2],
        },
        {
            "label": "신규 후보 재탐색",
            "type": "new_candidate",
            "summary": "기존 보유 외 대안 자산/종목 후보를 점검해 후보군을 확장합니다.",
            "questions": build_default_questions("신규 후보", "new_candidate"),
            "keywords": ["신규", "대안", "ETF", "섹터", "후보"],
            "priority": 70,
            "accountKeys": known_account_keys[:2],
        },
    ]

    for fallback in defaults:
        if len(deduped) >= min_topics:
            break
        key = (fallback["label"].lower(), fallback["type"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(fallback)

    return deduped[:max_topics]


def validate_topics(
    raw_topics: Any,
    summary_inputs: list[dict[str, Any]],
    known_account_keys: list[str],
    min_topics: int,
    max_topics: int,
) -> list[dict[str, Any]]:
    if not isinstance(raw_topics, list):
        raw_topics = []

    fallback_topics = infer_topics_from_inputs(summary_inputs, known_account_keys, min_topics, max_topics)

    topics: list[dict[str, Any]] = []
    for index, raw_topic in enumerate(raw_topics):
        if not isinstance(raw_topic, dict):
            continue

        fallback = fallback_topics[index % len(fallback_topics)] if fallback_topics else {
            "label": "리서치 토픽",
            "type": "sector",
            "summary": "",
            "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"],
            "priority": 60,
            "questions": build_default_questions("리서치 토픽", "sector"),
            "accountKeys": known_account_keys[:2],
        }

        label = truncate_text(raw_topic.get("label") or fallback["label"], 36)
        summary = truncate_text(raw_topic.get("summary") or fallback["summary"], 200)
        topic_type = normalize_topic_type(raw_topic.get("type"), label, summary, fallback["type"])
        keywords = normalize_keywords(raw_topic.get("keywords"), label, fallback["keywords"])
        questions = normalize_questions(raw_topic.get("questions"), label, topic_type)

        topic = {
            "label": label,
            "type": topic_type,
            "summary": summary,
            "questions": questions,
            "keywords": keywords,
            "priority": clamp_int(raw_topic.get("priority"), 1, 100, fallback["priority"]),
            "accountKeys": normalize_account_keys(raw_topic.get("accountKeys"), known_account_keys)
            or fallback["accountKeys"],
        }
        topics.append(topic)

    deduped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for topic in sorted(topics, key=lambda item: item.get("priority", 0), reverse=True):
        key = (topic["label"].lower(), topic["type"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(topic)
        if len(deduped) >= max_topics:
            break

    if len(deduped) < min_topics:
        for fallback in fallback_topics:
            key = (fallback["label"].lower(), fallback["type"])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(fallback)
            if len(deduped) >= min_topics:
                break

    return deduped[:max_topics]


def choose_model(model_hint: str | None) -> list[str]:
    if model_hint:
        return [model_hint]
    return DEFAULT_MODEL_CANDIDATES[:]


def is_model_not_found(error_message: str) -> bool:
    lowered = error_message.lower()
    return "model_not_found" in lowered or "is not found" in lowered or "not supported" in lowered


def call_qwen_agenda(
    client: OpenAI,
    model_name: str,
    prompt: str,
    temperature: float,
    max_retries: int,
) -> dict[str, Any]:
    retry_suffixes = [
        "",
        (
            "\n\n중요: 반드시 JSON object 하나만 반환하세요. "
            "코드펜스, 설명 문장, 마크다운을 절대 붙이지 마세요."
        ),
    ]

    last_error: Exception | None = None

    for index in range(max(1, max_retries)):
        suffix = retry_suffixes[min(index, len(retry_suffixes) - 1)]
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a financial research planner. "
                            "Respond only with valid JSON object."
                        ),
                    },
                    {"role": "user", "content": prompt + suffix},
                ],
                temperature=temperature,
                max_tokens=2600,
                response_format={"type": "json_object"},
            )
            raw_text = normalize_text(response.choices[0].message.content if response.choices else "")
            if not raw_text:
                raise RuntimeError("Qwen 응답이 비어 있습니다.")
            return extract_json_block(raw_text)
        except Exception as exc:  # noqa: BLE001
            last_error = exc

    if last_error is None:
        raise RuntimeError("Qwen 호출 실패")
    raise last_error


def main() -> None:
    args = parse_args()

    root = Path(os.getenv("ECOREPORT_ROOT") or Path(__file__).resolve().parent.parent)
    env_path = root / ".env"
    if env_path.exists():
        load_simple_dotenv(env_path)

    api_key = (os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("DASHSCOPE_API_KEY 또는 QWEN_API_KEY가 설정되지 않았습니다.")

    state_dir = root / "data" / "analysis-state" / args.date
    extracts_path = state_dir / "stage1-report-extracts-v2.json"
    portfolio_path = root / "data" / "portfolio" / "latest.json"
    output_path = Path(args.output) if args.output else state_dir / DEFAULT_OUTPUT_NAME

    stage1 = load_json(extracts_path, None)
    if not stage1:
        raise RuntimeError(f"Stage 1 파일을 읽을 수 없습니다: {extracts_path}")
    extracts = stage1.get("extracts") or []
    if not extracts:
        raise RuntimeError("Stage 1 extracts가 비어 있습니다.")

    summary_inputs, input_source = build_summary_inputs(state_dir, extracts, max(1, args.max_input_summaries))
    if not summary_inputs:
        raise RuntimeError("입력 요약 데이터가 비어 있어 어젠다를 생성할 수 없습니다.")

    portfolio = load_json(portfolio_path, {"accounts": []})
    account_keys = [
        str(account.get("key") or "").strip().upper()
        for account in (portfolio.get("accounts") or [])
        if str(account.get("key") or "").strip()
    ]

    condensed_inputs = [
        {
            "report_id": row.get("report_id"),
            "title": row.get("title"),
            "broker": row.get("broker"),
            "sector": row.get("sector"),
            "summary": truncate_text(row.get("summary") or "", 220),
            "priority_score": clamp_int(row.get("priority_score"), 1, 100, 50),
            "themes": (row.get("themes") or [])[:5],
            "related_accounts": (row.get("related_accounts") or [])[:3],
            "type_hint": row.get("inferred_type") or "",
            "label_hint": row.get("label_hint") or "",
        }
        for row in summary_inputs
    ]

    prompt_payload = {
        "date": args.date,
        "portfolio_account_keys": account_keys,
        "instructions": {
            "topic_count": f"{args.min_topics}~{args.max_topics}",
            "topic_types": ["macro", "sector", "security", "new_candidate"],
            "summary_limit": "각 topic.summary는 200자 이내",
            "questions": "각 topic.questions는 3개",
            "keywords": "각 topic.keywords는 5개",
            "priority": "1~100",
        },
        "inputs": condensed_inputs,
    }

    prompt = (
        "아래 입력 요약을 토픽 기반 리서치 어젠다로 재구성하세요.\n"
        "반드시 JSON object 하나만 반환하세요.\n\n"
        "출력 스키마:\n"
        "{\n"
        '  "topics": [\n'
        "    {\n"
        '      "label": "...",\n'
        '      "type": "macro|sector|security|new_candidate",\n'
        '      "summary": "200자 이내",\n'
        '      "questions": ["질문1", "질문2", "질문3"],\n'
        '      "keywords": ["키워드1", "키워드2", "키워드3", "키워드4", "키워드5"],\n'
        '      "priority": 1-100,\n'
        '      "accountKeys": ["ISA", "KIS_MAIN"]\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "입력 데이터:\n"
        f"{json.dumps(prompt_payload, ensure_ascii=False, indent=2)}"
    )

    client = OpenAI(api_key=api_key, base_url=DEFAULT_BASE_URL)
    model_candidates = choose_model(args.model)

    raw_payload: dict[str, Any] | None = None
    used_model = ""
    api_error: Exception | None = None

    for candidate in model_candidates:
        try:
            raw_payload = call_qwen_agenda(
                client=client,
                model_name=candidate,
                prompt=prompt,
                temperature=args.temperature,
                max_retries=max(1, args.max_retries),
            )
            used_model = candidate
            api_error = None
            break
        except Exception as exc:  # noqa: BLE001
            api_error = exc
            if is_model_not_found(str(exc)):
                continue
            break

    if raw_payload is None:
        # API 실패 시에도 파이프라인 진행을 위해 입력 기반 휴리스틱 어젠다를 생성한다.
        heuristic_topics = infer_topics_from_inputs(
            summary_inputs,
            account_keys,
            min_topics=max(1, args.min_topics),
            max_topics=max(1, args.max_topics),
        )
        payload = {
            "date": args.date,
            "model": used_model or (args.model or "heuristic-fallback"),
            "source": "heuristic_fallback",
            "input_source": input_source,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "topics": heuristic_topics,
            "warning": f"Qwen API 실패로 휴리스틱 폴백 사용: {api_error}",
        }
    else:
        topics = validate_topics(
            raw_topics=raw_payload.get("topics"),
            summary_inputs=summary_inputs,
            known_account_keys=account_keys,
            min_topics=max(1, args.min_topics),
            max_topics=max(1, args.max_topics),
        )

        payload = {
            "date": args.date,
            "model": used_model or (args.model or "qwen"),
            "source": "qwen_api",
            "input_source": input_source,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "topics": topics,
        }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"saved: {output_path}")
    print(f"source: {payload['source']}")
    print(f"model: {payload['model']}")
    print(f"input_source: {payload['input_source']}")
    print(f"topics: {len(payload['topics'])}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"stage1.4 agenda 생성 실패: {exc}", file=sys.stderr)
        sys.exit(1)
