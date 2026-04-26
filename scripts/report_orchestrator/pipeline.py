from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import PIPELINE_VERSION
from .config import PipelineConfig, load_config
from .llm import LlmClient
from .power import ShutdownResult, shutdown_windows_via_ssh, sleep_with_log, wake_windows
from .text_processing import (
    chunk_text,
    ensure_dir,
    extract_text_from_pdf,
    preprocess_text,
    read_json,
    sanitize_file_stem,
    sha1_of_file,
    sha1_of_text,
    write_json,
    write_text,
)


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat()


def relative_to_repo(path: Path, repo_root: Path) -> str:
    try:
        return str(path.relative_to(repo_root))
    except ValueError:
        return str(path)


def normalize_report_type(value: Any, fallback: str = "other") -> str:
    raw = str(value or "").strip().lower()
    mapping = {
        "industry": "industry",
        "macro": "macro",
        "company": "company",
        "strategy": "strategy",
        "other": "other",
    }
    if raw in mapping:
        return mapping[raw]
    category = str(value or "").strip()
    if any(token in category for token in ("경제", "macro", "금리", "환율")):
        return "macro"
    if any(token in category for token in ("산업", "업종", "sector")):
        return "industry"
    if any(token in category for token in ("기업", "company", "실적")):
        return "company"
    if any(token in category for token in ("전략", "strategy", "시황")):
        return "strategy"
    return fallback


def normalize_sentiment(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"bullish", "bearish", "neutral"}:
        return raw
    if any(token in raw for token in ("긍정", "매수", "상승", "bull")):
        return "bullish"
    if any(token in raw for token in ("부정", "매도", "하락", "bear")):
        return "bearish"
    return "neutral"


def normalize_time_horizon(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"short_term", "mid_term", "long_term"}:
        return raw
    if "short" in raw or "단기" in raw:
        return "short_term"
    if "long" in raw or "장기" in raw:
        return "long_term"
    return "mid_term"


def normalize_rating(value: Any) -> str:
    raw = str(value or "").strip().lower()
    mapping = {
        "buy": "buy",
        "매수": "buy",
        "overweight": "buy",
        "hold": "hold",
        "중립": "hold",
        "neutral": "neutral",
        "positive": "positive",
        "sell": "sell",
        "매도": "sell",
    }
    return mapping.get(raw, "unknown")


def normalize_rating_change(value: Any) -> str:
    raw = str(value or "").strip().lower()
    mapping = {
        "upgrade": "upgrade",
        "상향": "upgrade",
        "downgrade": "downgrade",
        "하향": "downgrade",
        "maintain": "maintain",
        "유지": "maintain",
        "initiate": "initiate",
        "개시": "initiate",
        "none": "none",
    }
    return mapping.get(raw, "none")


def normalize_ticker(value: Any) -> str | None:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return digits if len(digits) == 6 else None


def normalize_number(value: Any) -> float | int | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return value
    text = str(value).strip()
    cleaned = text.replace(",", "").replace("원", "").replace("KRW", "").strip()
    try:
        number = float(cleaned)
    except ValueError:
        return None
    if number.is_integer():
        return int(number)
    return round(number, 4)


def get_detail_limits(detail_level: str) -> dict[str, int]:
    if detail_level == "deep":
        return {
            "chunk_list_max": 6,
            "chunk_metrics_max": 6,
            "report_list_max": 5,
            "report_company_max": 5,
            "final_list_max": 8,
            "watchlist_max": 10,
            "timeline_max": 5,
            "scenario_max": 4,
            "opportunity_max": 6,
        }
    return {
        "chunk_list_max": 5,
        "chunk_metrics_max": 5,
        "report_list_max": 5,
        "report_company_max": 5,
        "final_list_max": 8,
        "watchlist_max": 10,
        "timeline_max": 5,
        "scenario_max": 4,
        "opportunity_max": 6,
    }


def clean_string_list(values: Any, max_items: int = 5) -> list[str]:
    if not isinstance(values, list):
        return []
    seen: set[str] = set()
    cleaned: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(text)
        if len(cleaned) >= max_items:
            break
    return cleaned


def clip_text(value: Any, max_chars: int) -> str:
    text = str(value or "").strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def clipped_string_list(values: Any, *, max_items: int = 3, max_chars: int = 140) -> list[str]:
    return [clip_text(item, max_chars) for item in clean_string_list(values, max_items=max_items)]


def normalize_key_metrics(values: Any, max_items: int = 5) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        metric_name = str(item.get("metric_name", "")).strip()
        value = str(item.get("value", "")).strip()
        context = str(item.get("context", "")).strip()
        if not metric_name and not value:
            continue
        normalized.append(
            {
                "metric_name": metric_name,
                "value": value,
                "context": context,
            }
        )
        if len(normalized) >= max_items:
            break
    return normalized


def compact_key_metrics_for_prompt(values: Any, max_items: int = 2) -> list[dict[str, str]]:
    return [
        {
            "metric_name": clip_text(item.get("metric_name"), 60),
            "value": clip_text(item.get("value"), 60),
            "context": clip_text(item.get("context"), 120),
        }
        for item in normalize_key_metrics(values, max_items=max_items)
    ]


def normalize_event_timeline(values: Any, max_items: int = 5) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    normalized: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, dict):
            continue
        event = str(item.get("event", "")).strip()
        timing = str(item.get("timing", "")).strip()
        importance = str(item.get("importance", "")).strip()
        if not event and not timing:
            continue
        key = f"{event.lower()}|{timing.lower()}"
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "event": event,
                "timing": timing,
                "importance": importance,
            }
        )
        if len(normalized) >= max_items:
            break
    return normalized


def normalize_scenario_map(values: Any, max_items: int = 4) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    normalized: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, dict):
            continue
        scenario = str(item.get("scenario", "")).strip()
        trigger = str(item.get("trigger", "")).strip()
        implication = str(item.get("implication", "")).strip()
        if not scenario:
            continue
        key = scenario.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "scenario": scenario,
                "trigger": trigger,
                "implication": implication,
            }
        )
        if len(normalized) >= max_items:
            break
    return normalized


def normalize_monitoring_calendar(values: Any, max_items: int = 6) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    normalized: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, dict):
            continue
        event = str(item.get("event", "")).strip()
        timing = str(item.get("timing", "")).strip()
        why_it_matters = str(item.get("why_it_matters", "")).strip()
        if not event:
            continue
        key = f"{event.lower()}|{timing.lower()}"
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "event": event,
                "timing": timing,
                "why_it_matters": why_it_matters,
            }
        )
        if len(normalized) >= max_items:
            break
    return normalized


def normalize_opportunity_buckets(values: Any, max_items: int = 6) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        return []
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, dict):
            continue
        theme = str(item.get("theme", "")).strip()
        why_now = str(item.get("why_now", "")).strip()
        linked_reports = clean_string_list(item.get("linked_reports"), max_items=5)
        if not theme:
            continue
        key = theme.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(
            {
                "theme": theme,
                "why_now": why_now,
                "linked_reports": linked_reports,
            }
        )
        if len(normalized) >= max_items:
            break
    return normalized


def normalize_chunk_summary(
    payload: dict[str, Any],
    report_title: str,
    report_type_hint: str,
    chunk_id: str,
    detail_level: str,
) -> dict[str, Any]:
    limits = get_detail_limits(detail_level)
    result = {
        "report_title": str(payload.get("report_title") or report_title).strip(),
        "report_type": normalize_report_type(payload.get("report_type"), fallback=report_type_hint),
        "chunk_id": str(payload.get("chunk_id") or chunk_id).strip() or chunk_id,
        "summary": str(payload.get("summary", "")).strip(),
        "sentiment": normalize_sentiment(payload.get("sentiment")),
        "key_points": clean_string_list(payload.get("key_points"), max_items=limits["chunk_list_max"]),
        "key_metrics": normalize_key_metrics(payload.get("key_metrics"), max_items=limits["chunk_metrics_max"]),
        "signals": clean_string_list(payload.get("signals"), max_items=limits["chunk_list_max"]),
        "catalysts": clean_string_list(payload.get("catalysts"), max_items=limits["chunk_list_max"]),
        "risks": clean_string_list(payload.get("risks"), max_items=limits["chunk_list_max"]),
        "mentioned_companies": clean_string_list(payload.get("mentioned_companies"), max_items=limits["chunk_list_max"]),
        "mentioned_sectors": clean_string_list(payload.get("mentioned_sectors"), max_items=limits["chunk_list_max"]),
    }
    if detail_level == "deep":
        result.update(
            {
                "market_implications": clean_string_list(payload.get("market_implications"), max_items=limits["chunk_list_max"]),
                "monitoring_points": clean_string_list(payload.get("monitoring_points"), max_items=limits["chunk_list_max"]),
                "event_timeline": normalize_event_timeline(payload.get("event_timeline"), max_items=limits["timeline_max"]),
                "variant_view": str(payload.get("variant_view", "")).strip(),
            }
        )
    return result


def _normalize_company_mentions(values: Any, max_items: int = 5, detail_level: str = "standard") -> list[dict[str, Any]]:
    if not isinstance(values, list):
        return []
    merged: dict[str, dict[str, Any]] = {}
    for item in values:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        key = name.lower()
        current = merged.setdefault(
            key,
            {
                "name": name,
                "ticker": None,
                "rating": "unknown",
                "rating_change": "none",
                "target_price": None,
                "current_price": None,
                "key_points": [],
                "catalysts": [],
                "risks": [],
            },
        )
        current["ticker"] = current["ticker"] or normalize_ticker(item.get("ticker"))
        current["rating"] = normalize_rating(item.get("rating") or current["rating"])
        current["rating_change"] = normalize_rating_change(item.get("rating_change") or current["rating_change"])
        current["target_price"] = current["target_price"] or normalize_number(item.get("target_price"))
        current["current_price"] = current["current_price"] or normalize_number(item.get("current_price"))
        current["key_points"] = clean_string_list(
            current["key_points"] + clean_string_list(item.get("key_points"), max_items=max_items),
            max_items=max_items,
        )
        current["catalysts"] = clean_string_list(
            current["catalysts"] + clean_string_list(item.get("catalysts"), max_items=max_items),
            max_items=max_items,
        )
        current["risks"] = clean_string_list(
            current["risks"] + clean_string_list(item.get("risks"), max_items=max_items),
            max_items=max_items,
        )
        if detail_level == "deep":
            current["valuation_view"] = str(item.get("valuation_view") or current.get("valuation_view") or "").strip()
            current["monitoring_points"] = clean_string_list(
                current.get("monitoring_points", []) + clean_string_list(item.get("monitoring_points"), max_items=max_items),
                max_items=max_items,
            )
    return list(merged.values())[:max_items]


def normalize_report_summary(
    payload: dict[str, Any],
    metadata: dict[str, Any],
    chunk_summaries: list[dict[str, Any]],
    detail_level: str,
) -> dict[str, Any]:
    limits = get_detail_limits(detail_level)
    inferred_sentiment = normalize_sentiment(payload.get("overall_sentiment"))
    if not payload.get("overall_sentiment") and chunk_summaries:
        sentiments = [chunk.get("sentiment", "neutral") for chunk in chunk_summaries]
        inferred_sentiment = max({"bullish", "bearish", "neutral"}, key=sentiments.count)

    result = {
        "report_title": str(payload.get("report_title") or metadata.get("title") or "").strip(),
        "publisher": str(payload.get("publisher") or metadata.get("publisher") or "").strip(),
        "publish_date": str(payload.get("publish_date") or metadata.get("publish_date") or "").strip(),
        "author": str(payload.get("author") or "").strip(),
        "core_summary": str(payload.get("core_summary", "")).strip(),
        "overall_sentiment": inferred_sentiment,
        "time_horizon": normalize_time_horizon(payload.get("time_horizon")),
        "macro_view": clean_string_list(payload.get("macro_view"), max_items=limits["report_list_max"]),
        "sector_view": clean_string_list(payload.get("sector_view"), max_items=limits["report_list_max"]),
        "company_mentions": _normalize_company_mentions(
            payload.get("company_mentions"),
            max_items=limits["report_company_max"],
            detail_level=detail_level,
        ),
        "key_signals": clean_string_list(payload.get("key_signals"), max_items=limits["report_list_max"]),
        "risks": clean_string_list(payload.get("risks"), max_items=limits["report_list_max"]),
        "actionable_points": clean_string_list(payload.get("actionable_points"), max_items=limits["report_list_max"]),
    }
    if detail_level == "deep":
        result.update(
            {
                "variant_view": str(payload.get("variant_view", "")).strip(),
                "consensus_gap": str(payload.get("consensus_gap", "")).strip(),
                "valuation_view": str(payload.get("valuation_view", "")).strip(),
                "portfolio_relevance": clean_string_list(payload.get("portfolio_relevance"), max_items=limits["report_list_max"]),
                "monitoring_checklist": clean_string_list(payload.get("monitoring_checklist"), max_items=limits["report_list_max"]),
                "event_timeline": normalize_event_timeline(payload.get("event_timeline"), max_items=limits["timeline_max"]),
                "scenario_map": normalize_scenario_map(payload.get("scenario_map"), max_items=limits["scenario_max"]),
            }
        )
    return result


def normalize_final_market_view(payload: dict[str, Any], report_summaries: list[dict[str, Any]], detail_level: str) -> dict[str, Any]:
    limits = get_detail_limits(detail_level)
    company_watchlist = payload.get("company_watchlist")
    normalized_watchlist = []
    if isinstance(company_watchlist, list):
        for item in company_watchlist:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            normalized_watchlist.append(
                {
                    "name": name,
                    "ticker": normalize_ticker(item.get("ticker")),
                    "view": str(item.get("view", "")).strip(),
                    "catalysts": clean_string_list(item.get("catalysts"), max_items=limits["report_list_max"]),
                    "risks": clean_string_list(item.get("risks"), max_items=limits["report_list_max"]),
                }
            )
            if len(normalized_watchlist) >= limits["watchlist_max"]:
                break

    result = {
        "generated_at": now_iso(),
        "detail_level": detail_level,
        "report_count": len(report_summaries),
        "market_summary": str(payload.get("market_summary", "")).strip(),
        "macro_view": clean_string_list(payload.get("macro_view"), max_items=limits["final_list_max"]),
        "sector_view": clean_string_list(payload.get("sector_view"), max_items=limits["final_list_max"]),
        "company_watchlist": normalized_watchlist,
        "key_signals": clean_string_list(payload.get("key_signals"), max_items=limits["final_list_max"]),
        "risks": clean_string_list(payload.get("risks"), max_items=limits["final_list_max"]),
        "actionable_points": clean_string_list(payload.get("actionable_points"), max_items=limits["final_list_max"]),
        "reports": report_summaries,
    }
    if detail_level == "deep":
        result.update(
            {
                "regime_view": str(payload.get("regime_view", "")).strip(),
                "cross_report_consensus": clean_string_list(payload.get("cross_report_consensus"), max_items=limits["final_list_max"]),
                "cross_report_conflicts": clean_string_list(payload.get("cross_report_conflicts"), max_items=limits["final_list_max"]),
                "monitoring_calendar": normalize_monitoring_calendar(payload.get("monitoring_calendar"), max_items=limits["timeline_max"]),
                "opportunity_buckets": normalize_opportunity_buckets(payload.get("opportunity_buckets"), max_items=limits["opportunity_max"]),
            }
        )
    return result


def compact_chunk_summaries_for_merge(chunk_summaries: list[dict[str, Any]], detail_level: str) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    for item in chunk_summaries:
        compacted_item: dict[str, Any] = {
            "chunk_id": item.get("chunk_id", ""),
            "summary": clip_text(item.get("summary"), 180 if detail_level == "standard" else 240),
            "sentiment": item.get("sentiment", "neutral"),
            "key_points": clipped_string_list(
                item.get("key_points"),
                max_items=1 if detail_level == "standard" else 2,
                max_chars=100 if detail_level == "standard" else 120,
            ),
            "key_metrics": compact_key_metrics_for_prompt(item.get("key_metrics"), max_items=1),
            "signals": clipped_string_list(
                item.get("signals"),
                max_items=1 if detail_level == "standard" else 2,
                max_chars=90 if detail_level == "standard" else 110,
            ),
            "catalysts": clipped_string_list(
                item.get("catalysts"),
                max_items=1 if detail_level == "standard" else 2,
                max_chars=90 if detail_level == "standard" else 110,
            ),
            "risks": clipped_string_list(
                item.get("risks"),
                max_items=1 if detail_level == "standard" else 2,
                max_chars=90 if detail_level == "standard" else 110,
            ),
            "mentioned_companies": clipped_string_list(
                item.get("mentioned_companies"),
                max_items=2 if detail_level == "standard" else 3,
                max_chars=40 if detail_level == "standard" else 50,
            ),
            "mentioned_sectors": clipped_string_list(
                item.get("mentioned_sectors"),
                max_items=2 if detail_level == "standard" else 3,
                max_chars=40 if detail_level == "standard" else 50,
            ),
        }
        if detail_level == "deep":
            compacted_item.update(
                {
                    "market_implications": clipped_string_list(item.get("market_implications"), max_items=1, max_chars=100),
                    "monitoring_points": clipped_string_list(item.get("monitoring_points"), max_items=1, max_chars=100),
                    "event_timeline": normalize_event_timeline(item.get("event_timeline"), max_items=1),
                    "variant_view": clip_text(item.get("variant_view"), 120),
                }
            )
        compacted.append(compacted_item)
    return compacted


def compact_report_summaries_for_final(report_summaries: list[dict[str, Any]], detail_level: str) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    for item in report_summaries:
        compacted_item: dict[str, Any] = {
            "report_title": clip_text(item.get("report_title"), 120),
            "publisher": clip_text(item.get("publisher"), 60),
            "publish_date": item.get("publish_date", ""),
            "core_summary": clip_text(item.get("core_summary"), 360),
            "overall_sentiment": item.get("overall_sentiment", "neutral"),
            "time_horizon": item.get("time_horizon", "mid_term"),
            "macro_view": clipped_string_list(item.get("macro_view"), max_items=2, max_chars=140),
            "sector_view": clipped_string_list(item.get("sector_view"), max_items=2, max_chars=140),
            "key_signals": clipped_string_list(item.get("key_signals"), max_items=2, max_chars=140),
            "risks": clipped_string_list(item.get("risks"), max_items=2, max_chars=140),
            "actionable_points": clipped_string_list(item.get("actionable_points"), max_items=2, max_chars=140),
        }
        company_mentions = item.get("company_mentions")
        if isinstance(company_mentions, list):
            compacted_item["company_mentions"] = [
                {
                    "name": clip_text(company.get("name"), 60),
                    "rating": company.get("rating", "unknown"),
                    "key_points": clipped_string_list(company.get("key_points"), max_items=1, max_chars=120),
                }
                for company in company_mentions[:3]
                if isinstance(company, dict) and company.get("name")
            ]
        if detail_level == "deep":
            compacted_item.update(
                {
                    "variant_view": clip_text(item.get("variant_view"), 160),
                    "consensus_gap": clip_text(item.get("consensus_gap"), 160),
                    "valuation_view": clip_text(item.get("valuation_view"), 160),
                    "portfolio_relevance": clipped_string_list(item.get("portfolio_relevance"), max_items=2, max_chars=140),
                    "monitoring_checklist": clipped_string_list(item.get("monitoring_checklist"), max_items=2, max_chars=140),
                }
            )
        compacted.append(compacted_item)
    return compacted


def compact_category_views_for_final(
    category_views: dict[str, dict[str, Any]] | list[dict[str, Any]],
    detail_level: str,
) -> list[dict[str, Any]]:
    if isinstance(category_views, dict):
        feed = list(category_views.values())
    else:
        feed = category_views

    is_deep = detail_level == "deep"
    compacted: list[dict[str, Any]] = []
    for item in feed:
        if not isinstance(item, dict):
            continue
        compact_item: dict[str, Any] = {
            "category": clip_text(item.get("category"), 40),
            "market_summary": clip_text(item.get("market_summary"), 280 if is_deep else 180),
            "consensus_view": clipped_string_list(
                item.get("consensus_view"),
                max_items=3 if is_deep else 2,
                max_chars=120 if is_deep else 90,
            ),
            "minority_view": clipped_string_list(
                item.get("minority_view"),
                max_items=2,
                max_chars=110 if is_deep else 90,
            ),
            "contradictions": clipped_string_list(
                item.get("contradictions"),
                max_items=2,
                max_chars=120 if is_deep else 90,
            ),
            "investment_hypothesis": clip_text(item.get("investment_hypothesis"), 220 if is_deep else 160),
            "cross_signals": clipped_string_list(
                item.get("cross_signals"),
                max_items=3 if is_deep else 2,
                max_chars=120 if is_deep else 90,
            ),
            "macro_view": clipped_string_list(
                item.get("macro_view"),
                max_items=3 if is_deep else 2,
                max_chars=120 if is_deep else 90,
            ),
            "sector_view": clipped_string_list(
                item.get("sector_view"),
                max_items=3 if is_deep else 2,
                max_chars=120 if is_deep else 90,
            ),
            "key_signals": clipped_string_list(
                item.get("key_signals"),
                max_items=3 if is_deep else 2,
                max_chars=120 if is_deep else 90,
            ),
            "risks": clipped_string_list(
                item.get("risks"),
                max_items=3 if is_deep else 2,
                max_chars=110 if is_deep else 90,
            ),
            "actionable_points": clipped_string_list(
                item.get("actionable_points"),
                max_items=3 if is_deep else 2,
                max_chars=110 if is_deep else 90,
            ),
        }
        company_mentions = item.get("company_mentions")
        if isinstance(company_mentions, list):
            compact_item["company_mentions"] = [
                {
                    "name": clip_text(company.get("name"), 40),
                    "ticker": company.get("ticker", ""),
                    "rating": company.get("rating", "unknown"),
                    "key_points": clipped_string_list(
                        company.get("key_points"),
                        max_items=1,
                        max_chars=80,
                    ),
                }
                for company in company_mentions[: 3 if is_deep else 2]
                if isinstance(company, dict) and company.get("name")
            ]
        compacted.append(compact_item)
    return compacted


def infer_summary_category(summary: dict[str, Any]) -> str:
    title = str(summary.get("report_title") or "").strip()
    publisher = str(summary.get("publisher") or "").strip()
    title_lower = title.lower()
    publisher_lower = publisher.lower()
    company_mentions = summary.get("company_mentions")
    company_count = len(company_mentions) if isinstance(company_mentions, list) else 0

    def contains_any(*tokens: str) -> bool:
        haystack = f"{title_lower} {publisher_lower}"
        return any(token.lower() in haystack for token in tokens)

    if contains_any("bond", "ficc", "credit", "크레딧", "채권", "공사채", "여전채", "국채", "금리", "스프레드"):
        return "채권분석"

    if contains_any("morning brief", "morning letter", "morning snapshot", "daily", "장마감", "모닝코멘트", "미 증시", "국내주식 마감 시황", "달러,", "시황"):
        return "시황정보"

    if contains_any("전략", "strategy", "watchlist", "qna", "normalizing", "fund flow", "포커", "거래대금"):
        return "투자전략"

    if contains_any("imf", "geopolitics", "지정학", "미국-이란", "노동시장", "성장률", "경제", "macro", "환율", "물가", "gdp"):
        return "경제분석"

    if contains_any("weekly", "원전", "반도체", "mlcc", "nand", "전기전자", "디지털자산", "에너지", "우주", "산업", "업종"):
        return "산업분석"

    if contains_any("preview", "pre_", "pre:", "탐방노트", "후기", "간담회", "ir", "1q", "2q", "3q", "4q"):
        return "종목분석"

    if company_count <= 2 and company_count > 0:
        return "종목분석"
    if company_count >= 4:
        return "산업분석"
    if summary.get("time_horizon") == "short_term":
        return "시황정보"
    return "기타"


def category_slug(category: str) -> str:
    mapping = {
        "경제분석": "macro",
        "투자전략": "strategy",
        "시황정보": "market",
        "채권분석": "fixed_income",
        "산업분석": "industry",
        "종목분석": "company",
        "기타": "other",
    }
    return mapping.get(category, sanitize_file_stem(category) or "category")


def _common_strings(items: list[str], limit: int) -> list[str]:
    counter: dict[str, int] = {}
    for item in items:
        text = str(item or "").strip()
        if not text:
            continue
        counter[text] = counter.get(text, 0) + 1
    ranked = sorted(counter.items(), key=lambda pair: (-pair[1], len(pair[0])))
    return [text for text, _count in ranked[:limit]]


def _contains_theme(text: str, keywords: list[str]) -> bool:
    lowered = text.lower()
    return any(keyword.lower() in lowered for keyword in keywords)


def compact_report_summaries_for_category(report_summaries: list[dict[str, Any]], detail_level: str) -> list[dict[str, Any]]:
    is_deep = detail_level == "deep"
    compacted: list[dict[str, Any]] = []
    for item in report_summaries:
        resolved_title = item.get("report_title") or item.get("category") or "요약"
        resolved_summary = item.get("core_summary") or item.get("market_summary") or ""
        compact_item: dict[str, Any] = {
            "report_title": clip_text(resolved_title, 120),
            "publisher": clip_text(item.get("publisher"), 40),
            "publish_date": item.get("publish_date", ""),
            "category": str(item.get("category") or infer_summary_category(item)).strip() or "기타",
            "overall_sentiment": item.get("overall_sentiment", "neutral"),
            "time_horizon": item.get("time_horizon", "mid_term"),
            "core_summary": clip_text(resolved_summary, 500 if is_deep else 260),
            "macro_view": clipped_string_list(item.get("macro_view"), max_items=5 if is_deep else 3, max_chars=160),
            "sector_view": clipped_string_list(item.get("sector_view"), max_items=5 if is_deep else 3, max_chars=160),
            "key_signals": clipped_string_list(item.get("key_signals"), max_items=5 if is_deep else 3, max_chars=160),
            "risks": clipped_string_list(item.get("risks"), max_items=4 if is_deep else 2, max_chars=150),
            "actionable_points": clipped_string_list(item.get("actionable_points"), max_items=4 if is_deep else 2, max_chars=150),
        }
        company_mentions = item.get("company_mentions")
        if isinstance(company_mentions, list):
            compact_item["company_mentions"] = [
                {
                    "name": clip_text(company.get("name"), 50),
                    "ticker": company.get("ticker", ""),
                    "rating": company.get("rating", "unknown"),
                    "target_price": company.get("target_price"),
                    "key_points": clipped_string_list(company.get("key_points"), max_items=3 if is_deep else 1, max_chars=130),
                    "catalysts": clipped_string_list(company.get("catalysts"), max_items=2, max_chars=100),
                    "risks": clipped_string_list(company.get("risks"), max_items=2, max_chars=100),
                }
                for company in company_mentions[:5 if is_deep else 2]
                if isinstance(company, dict) and company.get("name")
            ]
        if is_deep:
            compact_item.update(
                {
                    "variant_view": clip_text(item.get("variant_view"), 250),
                    "consensus_gap": clip_text(item.get("consensus_gap"), 250),
                    "scenario_map": item.get("scenario_map") if isinstance(item.get("scenario_map"), dict) else {},
                    "event_timeline": clipped_string_list(item.get("event_timeline"), max_items=3, max_chars=120),
                    "portfolio_relevance": clipped_string_list(item.get("portfolio_relevance"), max_items=3, max_chars=120),
                    "fx_view": clip_text(item.get("fx_view"), 160),
                }
            )
        compacted.append(compact_item)
    return compacted


@dataclass(slots=True)
class ReportSource:
    report_date: str
    report_id: str
    title: str
    publisher: str
    publish_date: str
    category: str
    pdf_path: Path
    preferred_text_path: Path | None
    metadata: dict[str, Any]

    @property
    def safe_stem(self) -> str:
        return sanitize_file_stem(self.report_id)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local PDF report orchestrator")
    parser.add_argument("--config", default=None, help="Path to local-report-orchestrator.json")
    parser.add_argument("--date", default=None, help="Only process one report date (YYYY-MM-DD)")
    parser.add_argument("--limit", type=int, default=None, help="Max report count for this run")
    parser.add_argument("--detail", choices=["standard", "deep"], default=None, help="Detail level for extraction and merging")
    parser.add_argument("--force", action="store_true", help="Ignore caches and rebuild outputs")
    parser.add_argument("--chunks-only", action="store_true", help="Only extract text and build chunks; do not call the LLM")
    parser.add_argument("--test-connection-only", action="store_true", help="Only run the short LAN connectivity check")
    return parser.parse_args(argv)


class ReportOrchestrator:
    def __init__(self, config: PipelineConfig, *, force: bool = False, date_filter: str | None = None, limit: int | None = None):
        self.config = config
        self.force = force
        self.date_filter = date_filter
        self.limit = limit if limit is not None else config.max_reports
        self.client = LlmClient(config)
        self.failed_files: list[dict[str, Any]] = []
        self.request_failures: list[dict[str, Any]] = []
        self.stats: dict[str, Any] = {
            "pipeline_version": PIPELINE_VERSION,
            "detail_level": self.config.detail_level,
            "started_at": now_iso(),
            "startup_sequence": [],
            "connection_test": None,
            "reports_total": 0,
            "reports_processed": 0,
            "reports_skipped": 0,
            "reports_failed": 0,
            "chunk_total": 0,
            "chunk_summaries_created": 0,
            "chunk_summaries_reused": 0,
            "report_summaries_created": 0,
            "report_summaries_reused": 0,
            "retry_count": 0,
            "final_merge_created": False,
            "category_merges_created": 0,
            "structured_analysis_created": False,
            "chunks_only": False,
        }

    def log(self, message: str) -> None:
        print(message, flush=True)

    def collect_reports(self) -> list[ReportSource]:
        reports: list[ReportSource] = []
        if not self.config.input_root.exists():
            return reports

        for date_dir in sorted(self.config.input_root.iterdir()):
            if not date_dir.is_dir():
                continue
            date_text = date_dir.name
            if self.date_filter and date_text != self.date_filter:
                continue

            index_path = date_dir / "index.json"
            index_rows = read_json(index_path, [])
            if index_rows:
                for row in index_rows:
                    pdf_path = self.config.repo_root / row["pdf_path"] if row.get("pdf_path") else date_dir / f"{row.get('id', 'report')}.pdf"
                    preferred_text = None
                    if row.get("full_text_path"):
                        preferred_text = self.config.repo_root / row["full_text_path"]
                    else:
                        sibling_text = date_dir / "text" / f"{row.get('id', 'report')}.txt"
                        if sibling_text.exists():
                            preferred_text = sibling_text

                    reports.append(
                        ReportSource(
                            report_date=date_text,
                            report_id=str(row.get("id") or pdf_path.stem),
                            title=str(row.get("title") or pdf_path.stem),
                            publisher=str(row.get("broker") or row.get("publisher") or ""),
                            publish_date=str(row.get("date") or date_text),
                            category=str(row.get("category") or row.get("sector") or "other"),
                            pdf_path=pdf_path,
                            preferred_text_path=preferred_text,
                            metadata=row,
                        )
                    )
            else:
                for pdf_path in sorted(date_dir.glob("*.pdf")):
                    reports.append(
                        ReportSource(
                            report_date=date_text,
                            report_id=pdf_path.stem,
                            title=pdf_path.stem,
                            publisher="",
                            publish_date=date_text,
                            category="other",
                            pdf_path=pdf_path,
                            preferred_text_path=None,
                            metadata={},
                        )
                    )

        if self.limit is not None:
            reports = reports[: self.limit]
        self.stats["reports_total"] = len(reports)
        return reports

    def ensure_output_layout(self) -> None:
        for path in (
            self.config.raw_pdfs_dir,
            self.config.extracted_text_dir,
            self.config.chunks_dir,
            self.config.chunk_summaries_dir,
            self.config.report_summaries_dir,
            self.config.merged_dir,
            self.config.logs_dir,
        ):
            ensure_dir(path)

    def run_connection_test(self) -> dict[str, Any]:
        result = self.client.test_connection()
        self.stats["connection_test"] = result
        write_json(self.config.logs_dir / "connection_test.json", result)
        if result["ok"]:
            self.log(f"✅ LLM connection test passed at {self.config.chat_completions_url}")
        else:
            self.log(f"❌ LLM connection test failed after {len(result['attempts'])} attempts")
        return result

    def ensure_windows_llm_ready(self) -> dict[str, Any]:
        startup_log: list[dict[str, Any]] = []

        initial = self.run_connection_test()
        startup_log.append(
            {
                "step": "initial_connection_check",
                "ok": initial["ok"],
                "logged_at": now_iso(),
                "details": initial,
            }
        )
        if initial["ok"]:
            startup_log.append(
                {
                    "step": "shutdown_policy",
                    "ok": True,
                    "logged_at": now_iso(),
                    "details": f"Windows shutdown method configured: {self.config.shutdown_method}",
                }
            )
            self.stats["startup_sequence"] = startup_log
            write_json(self.config.logs_dir / "startup_sequence.json", startup_log)
            return initial

        if not self.config.auto_wake_enabled:
            startup_log.append(
                {
                    "step": "wake_on_lan_skipped",
                    "ok": False,
                    "logged_at": now_iso(),
                    "details": "Auto-wake disabled; Windows power-on not attempted.",
                }
            )
            self.stats["startup_sequence"] = startup_log
            write_json(self.config.logs_dir / "startup_sequence.json", startup_log)
            return initial

        self.log(f"🌙 Windows LLM server is down at {self.config.base_url}; sending Wake-on-LAN to {self.config.windows_mac}")
        wake_result = wake_windows(self.config.windows_mac)
        startup_log.append(
            {
                "step": "wake_on_lan",
                "ok": wake_result.ok,
                "logged_at": now_iso(),
                "details": {
                    "method": wake_result.method,
                    "message": wake_result.details,
                    "windows_host": self.config.windows_host,
                    "windows_mac": self.config.windows_mac,
                },
            }
        )
        if not wake_result.ok:
            self.stats["startup_sequence"] = startup_log
            write_json(self.config.logs_dir / "startup_sequence.json", startup_log)
            return {"ok": False, "attempts": initial.get("attempts", [])}

        self.log(f"📡 Wake-on-LAN sent via {wake_result.method}; waiting {self.config.wol_wait_seconds}s before retrying")
        sleep_with_log(self.config.wol_wait_seconds, self.log)

        second_check = self.run_connection_test()
        startup_log.append(
            {
                "step": "post_wake_connection_check",
                "ok": second_check["ok"],
                "logged_at": now_iso(),
                "details": second_check,
            }
        )
        startup_log.append(
            {
                "step": "shutdown_policy",
                "ok": True,
                "logged_at": now_iso(),
                "details": f"Windows shutdown method configured: {self.config.shutdown_method}",
            }
        )
        self.stats["startup_sequence"] = startup_log
        write_json(self.config.logs_dir / "startup_sequence.json", startup_log)
        return second_check

    def shutdown_windows_if_configured(self) -> ShutdownResult:
        if self.config.shutdown_method == "ssh":
            result = shutdown_windows_via_ssh(
                self.config.windows_ssh_target,
                self.config.windows_shutdown_command,
            )
        elif self.config.shutdown_method in {"", "none"}:
            result = ShutdownResult(
                ok=False,
                method="none",
                details="Shutdown skipped because no shutdown transport is configured.",
            )
        else:
            result = ShutdownResult(
                ok=False,
                method=self.config.shutdown_method,
                details=f"Unsupported shutdown method: {self.config.shutdown_method}",
            )

        write_json(
            self.config.logs_dir / "shutdown_attempt.json",
            {
                "ok": result.ok,
                "method": result.method,
                "details": result.details,
                "logged_at": now_iso(),
            },
        )
        if result.ok:
            self.log(f"🛑 Windows shutdown command sent via {result.method}")
        else:
            self.log(f"⚠️ Windows shutdown was not completed: {result.details}")
        return result

    def mirror_raw_pdf(self, report: ReportSource) -> None:
        destination = self.config.raw_pdfs_dir / report.report_date / report.pdf_path.name
        ensure_dir(destination.parent)
        if destination.exists() or destination.is_symlink():
            return
        try:
            destination.symlink_to(report.pdf_path)
        except OSError:
            shutil.copy2(report.pdf_path, destination)

    def extract_and_preprocess_text(self, report: ReportSource, fingerprint: str) -> tuple[str, bool]:
        destination = self.config.extracted_text_dir / report.report_date / f"{report.safe_stem}.txt"
        meta_path = destination.with_suffix(".meta.json")
        existing_meta = read_json(meta_path, {})
        if (
            not self.force
            and destination.exists()
            and existing_meta.get("source_fingerprint") == fingerprint
            and existing_meta.get("pipeline_version") == PIPELINE_VERSION
            and existing_meta.get("detail_level") == self.config.detail_level
        ):
            return destination.read_text("utf-8"), True

        if report.preferred_text_path and report.preferred_text_path.exists():
            raw_text = report.preferred_text_path.read_text("utf-8")
            extraction_method = "existing_text"
        else:
            raw_text = extract_text_from_pdf(report.pdf_path)
            extraction_method = "pdftotext"

        cleaned_text = preprocess_text(raw_text)
        write_text(destination, cleaned_text)
        write_json(
            meta_path,
            {
                "pipeline_version": PIPELINE_VERSION,
                "source_fingerprint": fingerprint,
                "extraction_method": extraction_method,
                "char_length": len(cleaned_text),
                "generated_at": now_iso(),
                "source_pdf": relative_to_repo(report.pdf_path, self.config.repo_root),
                "detail_level": self.config.detail_level,
            },
        )
        return cleaned_text, False

    def build_chunks(self, report: ReportSource, text: str, fingerprint: str) -> tuple[list[dict[str, Any]], bool]:
        destination = self.config.chunks_dir / report.report_date / f"{report.safe_stem}.json"
        existing = read_json(destination, {})
        config_signature = {
            "detail_level": self.config.detail_level,
            "min_chars": self.config.chunk_min_chars,
            "target_chars": self.config.chunk_target_chars,
            "max_chars": self.config.chunk_max_chars,
            "overlap_chars": self.config.chunk_overlap_chars,
        }
        if (
            not self.force
            and destination.exists()
            and existing.get("meta", {}).get("source_fingerprint") == fingerprint
            and existing.get("meta", {}).get("config") == config_signature
            and existing.get("meta", {}).get("pipeline_version") == PIPELINE_VERSION
            and existing.get("meta", {}).get("detail_level") == self.config.detail_level
        ):
            return existing.get("chunks", []), True

        chunks = chunk_text(
            text,
            min_chars=self.config.chunk_min_chars,
            target_chars=self.config.chunk_target_chars,
            max_chars=self.config.chunk_max_chars,
            overlap_chars=self.config.chunk_overlap_chars,
        )
        for chunk in chunks:
            chunk["chunk_id"] = f"{report.safe_stem}_chunk_{chunk['chunk_index'] + 1:03d}"
            chunk["content_fingerprint"] = sha1_of_text(chunk["text"])

        write_json(
            destination,
            {
                "meta": {
                    "pipeline_version": PIPELINE_VERSION,
                    "source_fingerprint": fingerprint,
                    "generated_at": now_iso(),
                    "report_id": report.report_id,
                    "report_title": report.title,
                    "detail_level": self.config.detail_level,
                    "config": config_signature,
                },
                "chunks": chunks,
            },
        )
        return chunks, False

    def _record_failure(self, *, stage: str, report: ReportSource, message: str, chunk_id: str | None = None, excerpt: str | None = None) -> None:
        payload = {
            "stage": stage,
            "report_date": report.report_date,
            "report_id": report.report_id,
            "report_title": report.title,
            "message": message,
            "chunk_id": chunk_id,
            "excerpt": excerpt,
            "logged_at": now_iso(),
        }
        self.failed_files.append(payload)
        self.request_failures.append(payload)

    def summarize_chunks(self, report: ReportSource, chunks: list[dict[str, Any]], fingerprint: str) -> tuple[list[dict[str, Any]], bool]:
        destination = self.config.chunk_summaries_dir / report.report_date / f"{report.safe_stem}.json"
        existing = read_json(destination, {})
        existing_meta = existing.get("meta", {})
        existing_by_id = {}
        for item in existing.get("chunk_summaries", []):
            if isinstance(item, dict) and item.get("chunk_id"):
                existing_by_id[item.get("chunk_id")] = item
        existing_fingerprints = existing_meta.get("chunk_fingerprints", {})
        if (
            not self.force
            and destination.exists()
            and existing_meta.get("source_fingerprint") == fingerprint
            and existing_meta.get("pipeline_version") == PIPELINE_VERSION
            and existing_meta.get("detail_level") == self.config.detail_level
        ):
            clean_existing = [
                {key: value for key, value in item.items() if not str(key).startswith("_")}
                for item in existing.get("chunk_summaries", [])
                if isinstance(item, dict)
            ]
            self.stats["chunk_summaries_reused"] += len(clean_existing)
            return clean_existing, True

        report_type_hint = normalize_report_type(report.category)
        limits = get_detail_limits(self.config.detail_level)
        results: list[dict[str, Any]] = []
        created_count = 0
        reused_count = 0

        for chunk in chunks:
            chunk_id = chunk["chunk_id"]
            cached = existing_by_id.get(chunk_id)
            if (
                not self.force
                and cached
                and existing_fingerprints.get(chunk_id) == chunk["content_fingerprint"]
                and existing_meta.get("pipeline_version") == PIPELINE_VERSION
            ):
                results.append({key: value for key, value in cached.items() if not key.startswith("_")})
                reused_count += 1
                continue

            messages = [
                {
                    "role": "system",
                    "content": (
                        "너는 한국 증권/산업/매크로 PDF 리포트 구조화 추출기다. "
                        "반드시 JSON 객체만 출력하고, 마크다운/설명/코드펜스를 절대 쓰지 마라. "
                        f"summary는 {'충분히 구체적이되 장황하지 않게' if self.config.is_deep else '짧게'} 유지하고, "
                        f"key_points/signals/catalysts/risks와 company/sector 목록은 최대 {limits['chunk_list_max']}개만 남겨라. "
                        "숫자 데이터, 이벤트 일정, 시장 함의, 반대 해석 가능성이 있으면 구조적으로 정리하라."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "task": "chunk_summary",
                            "report_title": report.title,
                            "report_type_hint": report_type_hint,
                            "chunk_id": chunk_id,
                            "required_schema": {
                                "report_title": "",
                                "report_type": "industry|macro|company|strategy|other",
                                "chunk_id": "",
                                "summary": "",
                                "sentiment": "bullish|bearish|neutral",
                                "key_points": [],
                                "key_metrics": [{"metric_name": "", "value": "", "context": ""}],
                                "signals": [],
                                "catalysts": [],
                                "risks": [],
                                "mentioned_companies": [],
                                "mentioned_sectors": [],
                            },
                            "chunk_text": chunk["text"],
                            "detail_level": self.config.detail_level,
                        },
                        ensure_ascii=False,
                    ),
                },
            ]
            if self.config.is_deep:
                required_schema = json.loads(messages[1]["content"])
                required_schema["required_schema"].update(
                    {
                        "market_implications": [],
                        "monitoring_points": [],
                        "event_timeline": [{"event": "", "timing": "", "importance": ""}],
                        "variant_view": "",
                    }
                )
                messages[1]["content"] = json.dumps(required_schema, ensure_ascii=False)

            try:
                result = self.client.complete_json(
                    messages=messages,
                    temperature=self.config.chunk_temperature,
                    max_tokens=self.config.chunk_max_tokens,
                    retry_attempts=self.config.chunk_retry_attempts,
                )
                self.stats["retry_count"] += max(0, result.attempts - 1)
                normalized = normalize_chunk_summary(
                    result.payload,
                    report.title,
                    report_type_hint,
                    chunk_id,
                    self.config.detail_level,
                )
                results.append(normalized)
                existing_by_id[chunk_id] = normalized
                existing_fingerprints[chunk_id] = chunk["content_fingerprint"]
                created_count += 1
            except Exception as error:  # noqa: BLE001
                self._record_failure(
                    stage="chunk_summary",
                    report=report,
                    message=str(error),
                    chunk_id=chunk_id,
                    excerpt=chunk["text"][:1200],
                )

        if len(results) != len(chunks):
            raise RuntimeError(f"Chunk summary incomplete for {report.report_id}: {len(results)}/{len(chunks)} chunks")

        write_json(
            destination,
            {
                "meta": {
                    "pipeline_version": PIPELINE_VERSION,
                "source_fingerprint": fingerprint,
                    "generated_at": now_iso(),
                    "report_id": report.report_id,
                    "report_title": report.title,
                    "model": self.config.model,
                    "detail_level": self.config.detail_level,
                    "chunk_fingerprints": existing_fingerprints,
                },
            "chunk_summaries": [
                existing_by_id[chunk["chunk_id"]] if chunk["chunk_id"] in existing_by_id else chunk
                for chunk in chunks
            ],
            },
        )
        self.stats["chunk_summaries_created"] += created_count
        self.stats["chunk_summaries_reused"] += reused_count
        return results, False

    def merge_report_summary(self, report: ReportSource, chunk_summaries: list[dict[str, Any]], fingerprint: str) -> tuple[dict[str, Any], bool]:
        destination = self.config.report_summaries_dir / report.report_date / f"{report.safe_stem}.json"
        existing = read_json(destination, {})
        if (
            not self.force
            and destination.exists()
            and existing.get("meta", {}).get("source_fingerprint") == fingerprint
            and existing.get("meta", {}).get("pipeline_version") == PIPELINE_VERSION
            and existing.get("meta", {}).get("detail_level") == self.config.detail_level
        ):
            self.stats["report_summaries_reused"] += 1
            return existing.get("report", {}), True

        prompt_chunk_summaries = compact_chunk_summaries_for_merge(chunk_summaries, self.config.detail_level)
        messages = [
            {
                "role": "system",
                "content": (
                    "너는 chunk 요약 JSON만 이용해 리포트 단위 구조화 요약을 병합하는 금융 분석기다. "
                    "반드시 JSON 객체만 출력하고, 제공된 chunk summary와 메타데이터 밖의 사실을 지어내지 마라. "
                    f"company_mentions는 회사명 기준으로 중복 병합하고 최종 {get_detail_limits(self.config.detail_level)['report_company_max']}개 이내로 줄여라. "
                    f"macro_view, sector_view, key_signals, risks, actionable_points도 각각 최대 {get_detail_limits(self.config.detail_level)['report_list_max']}개만 남겨라. "
                    "각 리스트 항목은 120자 이내의 단문으로 쓰고, 코드펜스와 마크다운을 절대 출력하지 마라. "
                    "핵심 논지, 컨센서스와의 차이, 포트폴리오 relevance, 체크리스트가 보이면 구조적으로 정리하라."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": "merge_report_summary",
                        "metadata": {
                            "report_title": report.title,
                            "publisher": report.publisher,
                            "publish_date": report.publish_date,
                            "category": report.category,
                        },
                        "required_schema": {
                            "report_title": "",
                            "publisher": "",
                            "publish_date": "YYYY-MM-DD",
                            "author": "",
                            "core_summary": "",
                            "overall_sentiment": "bullish|bearish|neutral",
                            "time_horizon": "short_term|mid_term|long_term",
                            "macro_view": [],
                            "sector_view": [],
                            "company_mentions": [
                                {
                                    "name": "",
                                    "ticker": None,
                                    "rating": "buy|hold|sell|positive|neutral|unknown",
                                    "rating_change": "upgrade|downgrade|maintain|initiate|none",
                                    "target_price": None,
                                    "current_price": None,
                                    "key_points": [],
                                    "catalysts": [],
                                    "risks": [],
                                }
                            ],
                            "key_signals": [],
                            "risks": [],
                            "actionable_points": [],
                        },
                        "chunk_summaries": prompt_chunk_summaries,
                        "detail_level": self.config.detail_level,
                    },
                    ensure_ascii=False,
                ),
            },
        ]
        if self.config.is_deep:
            required_schema = json.loads(messages[1]["content"])
            required_schema["required_schema"].update(
                {
                    "variant_view": "",
                    "consensus_gap": "",
                    "valuation_view": "",
                    "portfolio_relevance": [],
                    "monitoring_checklist": [],
                    "event_timeline": [{"event": "", "timing": "", "importance": ""}],
                    "scenario_map": [{"scenario": "", "trigger": "", "implication": ""}],
                }
            )
            messages[1]["content"] = json.dumps(required_schema, ensure_ascii=False)

        try:
            result = self.client.complete_json(
                messages=messages,
                temperature=self.config.merge_temperature,
                max_tokens=self.config.report_merge_max_tokens,
                retry_attempts=self.config.merge_retry_attempts,
            )
        except Exception:
            compact_messages = [
                {
                    "role": "system",
                    "content": (
                        "너는 금융 리포트 요약기다. 이전 출력이 너무 길어 실패했으므로 아주 작은 JSON 객체만 출력하라. "
                        "코드펜스/마크다운 없이 닫힌 JSON만 출력하라. 모든 리스트는 최대 3개, 각 항목은 100자 이내다."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "task": "merge_report_summary_compact",
                            "metadata": {
                                "report_title": report.title,
                                "publisher": report.publisher,
                                "publish_date": report.publish_date,
                                "category": report.category,
                            },
                            "required_schema": {
                                "report_title": "",
                                "publisher": "",
                                "publish_date": "YYYY-MM-DD",
                                "core_summary": "",
                                "overall_sentiment": "bullish|bearish|neutral",
                                "time_horizon": "short_term|mid_term|long_term",
                                "macro_view": [],
                                "sector_view": [],
                                "company_mentions": [{"name": "", "rating": "positive|neutral|unknown", "key_points": []}],
                                "key_signals": [],
                                "risks": [],
                                "actionable_points": [],
                                "variant_view": "",
                                "portfolio_relevance": [],
                                "monitoring_checklist": [],
                            },
                            "chunk_summaries": prompt_chunk_summaries,
                        },
                        ensure_ascii=False,
                    ),
                },
            ]
            result = self.client.complete_json(
                messages=compact_messages,
                temperature=self.config.merge_temperature,
                max_tokens=min(self.config.report_merge_max_tokens, 3600),
                retry_attempts=self.config.merge_retry_attempts,
            )
        self.stats["retry_count"] += max(0, result.attempts - 1)
        normalized = normalize_report_summary(
            result.payload,
            {
                "title": report.title,
                "publisher": report.publisher,
                "publish_date": report.publish_date,
            },
            chunk_summaries,
            self.config.detail_level,
        )
        write_json(
            destination,
            {
                "meta": {
                    "pipeline_version": PIPELINE_VERSION,
                    "source_fingerprint": fingerprint,
                    "generated_at": now_iso(),
                    "report_id": report.report_id,
                    "report_title": report.title,
                    "model": self.config.model,
                    "detail_level": self.config.detail_level,
                },
                "report": normalized,
            },
        )
        self.stats["report_summaries_created"] += 1
        return normalized, False

    # ── 계층적 병합 파이프라인 ──────────────────────────────────────────────────

    def _group_by_category(self, report_summaries: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
        from collections import defaultdict
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for summary in report_summaries:
            cat = str(summary.get("category") or "").strip()
            if not cat or cat == "기타":
                cat = infer_summary_category(summary)
            groups[cat].append(summary)
        return dict(groups)

    def _split_category_batches(self, summaries: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        compacted = compact_report_summaries_for_category(summaries, self.config.detail_level)
        max_chars = 16000 if self.config.detail_level == "deep" else 12000
        batches: list[list[dict[str, Any]]] = []
        current_original: list[dict[str, Any]] = []
        current_chars = 0

        for original, compacted_item in zip(summaries, compacted):
            item_chars = len(json.dumps(compacted_item, ensure_ascii=False))
            if current_original and current_chars + item_chars > max_chars:
                batches.append(current_original)
                current_original = []
                current_chars = 0
            current_original.append(original)
            current_chars += item_chars

        if current_original:
            batches.append(current_original)
        return batches

    def merge_category_view(self, category: str, summaries: list[dict[str, Any]]) -> dict[str, Any]:
        """카테고리 내 리포트 요약들을 하나의 카테고리 뷰로 병합한다.
        종목분석은 company_batch_size 단위로 서브배치 후 재병합한다."""
        batch_size = self.config.company_batch_size
        batches = self._split_category_batches(summaries)
        if category == "종목분석" and len(summaries) > batch_size:
            sub_views = []
            for i in range(0, len(summaries), batch_size):
                batch = summaries[i:i + batch_size]
                sub_views.append(self._call_category_merge_llm(category, batch))
            return self._call_category_merge_llm(f"{category}(통합)", sub_views)
        if len(batches) > 1:
            sub_views = []
            for index, batch in enumerate(batches, start=1):
                self.log(f"     ↳ {category} 서브배치 {index}/{len(batches)} ({len(batch)}건)")
                sub_views.append(self._call_category_merge_llm(category, batch))
            return self._call_category_merge_llm(f"{category}(통합)", sub_views)
        return self._call_category_merge_llm(category, summaries)

    def _call_category_merge_llm(self, category: str, summaries: list[dict[str, Any]]) -> dict[str, Any]:
        limits = get_detail_limits(self.config.detail_level)
        is_deep = self.config.detail_level == "deep"
        prompt_summaries = compact_report_summaries_for_category(summaries, self.config.detail_level)
        system_content = (
            f"너는 '{category}' 카테고리 리포트 {len(summaries)}건을 분석해 하나의 통합 카테고리 뷰를 생성하는 시장 분석가다. "
            "반드시 JSON 객체만 출력하라. 마크다운 코드블록 없이 순수 JSON만.\n\n"
            "분석 지침:\n"
            "1. 컨센서스: 복수 리포트에서 공통으로 언급되는 뷰를 consensus_view로 정리하라\n"
            "2. 소수의견: 1~2개 리포트만 언급하는 독특한 시각을 minority_view로 분리하라\n"
            "3. 모순 탐지: 같은 섹터/종목에 대해 상반된 전망이 있으면 contradictions에 명시하라\n"
            "4. 투자 가설: 여러 리포트의 시그널을 종합해 actionable한 투자 가설을 investment_hypothesis로 도출하라\n"
            "5. 크로스 시그널: 이 카테고리가 다른 섹터/자산에 미치는 연쇄 영향을 cross_signals에 서술하라\n"
            f"6. sector_view와 key_signals는 최대 {limits['final_list_max']}개, 각 항목은 구체적 수치/날짜 포함\n"
            "7. 단순 나열 금지 — 리포트 간 비교, 충돌, 공통점을 드러내는 서술을 우선시하라"
        )
        required_schema: dict[str, Any] = {
            "category": category,
            "market_summary": "",
            "overall_sentiment": "neutral",
            "consensus_view": [],
            "minority_view": [],
            "contradictions": [],
            "investment_hypothesis": "",
            "cross_signals": [],
            "macro_view": [],
            "sector_view": [],
            "key_signals": [],
            "risks": [],
            "company_mentions": [],
            "actionable_points": [],
        }
        if is_deep:
            required_schema.update({
                "scenario_bull": "",
                "scenario_bear": "",
                "time_sensitive_events": [],
                "portfolio_impact": [],
            })
        messages = [
            {"role": "system", "content": system_content},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": "merge_category_view",
                        "category": category,
                        "report_count": len(summaries),
                        "required_schema": required_schema,
                        "report_summaries": prompt_summaries,
                        "detail_level": self.config.detail_level,
                    },
                    ensure_ascii=False,
                ),
            },
        ]
        result = self.client.complete_json(
            messages=messages,
            temperature=self.config.merge_temperature,
            max_tokens=self.config.category_merge_max_tokens,
            retry_attempts=self.config.merge_retry_attempts,
        )
        self.stats["retry_count"] += max(0, result.attempts - 1)
        view = result.payload
        view.setdefault("category", category)
        return view

    def _merge_category_view_local(self, category: str, summaries: list[dict[str, Any]]) -> dict[str, Any]:
        limits = get_detail_limits(self.config.detail_level)
        compacted = compact_report_summaries_for_category(summaries, self.config.detail_level)

        bullish = sum(1 for item in compacted if item.get("overall_sentiment") == "bullish")
        bearish = sum(1 for item in compacted if item.get("overall_sentiment") == "bearish")
        if bullish > bearish:
            overall_sentiment = "bullish"
        elif bearish > bullish:
            overall_sentiment = "bearish"
        else:
            overall_sentiment = "neutral"

        macro_pool: list[str] = []
        sector_pool: list[str] = []
        signal_pool: list[str] = []
        risk_pool: list[str] = []
        action_pool: list[str] = []
        summary_pool: list[str] = []
        company_pool: dict[str, dict[str, Any]] = {}

        for item in compacted:
            macro_pool.extend(item.get("macro_view", []))
            sector_pool.extend(item.get("sector_view", []))
            signal_pool.extend(item.get("key_signals", []))
            risk_pool.extend(item.get("risks", []))
            action_pool.extend(item.get("actionable_points", []))
            if item.get("core_summary"):
                summary_pool.append(str(item["core_summary"]))
            for company in item.get("company_mentions", []):
                if not isinstance(company, dict):
                    continue
                name = str(company.get("name", "")).strip()
                if not name:
                    continue
                if name not in company_pool:
                    company_pool[name] = {
                        "name": name,
                        "rating": company.get("rating", "unknown"),
                        "key_points": [],
                        "_count": 0,
                    }
                company_pool[name]["_count"] += 1
                company_pool[name]["key_points"] = clean_string_list(
                    company_pool[name]["key_points"] + clean_string_list(company.get("key_points"), max_items=2),
                    max_items=2,
                )

        ranked_companies = sorted(company_pool.values(), key=lambda item: (-item["_count"], item["name"]))
        company_mentions = [
            {
                "name": item["name"],
                "rating": item.get("rating", "unknown"),
                "key_points": item.get("key_points", []),
            }
            for item in ranked_companies[: limits["report_company_max"]]
        ]

        summary_lines = _common_strings(summary_pool, 3)
        market_summary = " ".join(summary_lines) if summary_lines else f"{category} 카테고리 요약 {len(summaries)}건을 병합한 결과입니다."

        return {
            "category": category,
            "market_summary": clip_text(market_summary, 420),
            "overall_sentiment": overall_sentiment,
            "macro_view": _common_strings(macro_pool, limits["final_list_max"]),
            "sector_view": _common_strings(sector_pool, limits["final_list_max"]),
            "key_signals": _common_strings(signal_pool, limits["final_list_max"]),
            "risks": _common_strings(risk_pool, limits["final_list_max"]),
            "company_mentions": company_mentions,
            "actionable_points": _common_strings(action_pool, limits["final_list_max"]),
        }

    def _load_index_metadata(self, report_summaries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """index.json에서 report_id별 opinion/target_price 등 구조화 메타데이터를 로드한다."""
        id_to_meta: dict[str, dict[str, Any]] = {}
        # 날짜 추출 (summaries의 publish_date 또는 report_id 기반)
        dates: set[str] = set()
        for s in report_summaries:
            d = s.get("publish_date") or s.get("report_date") or ""
            if d:
                dates.add(d[:10])
            rid = s.get("report_id") or s.get("id") or ""
            if rid:
                id_to_meta[rid] = {}

        for date_str in dates:
            index_path = self.config.input_root / date_str / "index.json"
            if not index_path.exists():
                continue
            rows = read_json(index_path, [])
            if not isinstance(rows, list):
                continue
            for row in rows:
                rid = str(row.get("id") or "")
                if rid:
                    id_to_meta[rid] = {
                        "broker_opinion": row.get("opinion"),
                        "broker_target_price": row.get("target_price"),
                        "broker": row.get("broker") or row.get("publisher") or "",
                        "ticker": row.get("ticker"),
                        "ticker_name": row.get("ticker_name"),
                    }
        return id_to_meta

    def _enrich_summary_with_index(
        self, summary: dict[str, Any], meta: dict[str, Any]
    ) -> dict[str, Any]:
        """summary dict에 index.json 구조화 데이터를 주입한다."""
        if not meta:
            return summary
        enriched = dict(summary)
        report = enriched.get("report", enriched)
        # broker opinion / target price를 최상위 및 report 레벨에 모두 주입
        for field in ("broker_opinion", "broker_target_price", "ticker", "ticker_name"):
            val = meta.get(field)
            if val is not None:
                enriched[field] = val
                if isinstance(report, dict):
                    report[field] = val
        return enriched

    def _build_cross_context(self, category_views: dict[str, dict[str, Any]]) -> dict[str, str]:
        """각 카테고리에게 넘겨줄 타 카테고리 brief 컨텍스트를 생성한다."""
        cross: dict[str, str] = {}
        for cat, view in category_views.items():
            sentiment = view.get("overall_sentiment", "neutral")
            summary = clip_text(view.get("market_summary", ""), 120)
            key_signals = view.get("key_signals", [])
            signal_str = " / ".join(str(s)[:60] for s in key_signals[:2]) if key_signals else ""
            cross[cat] = f"[{sentiment}] {summary}" + (f" | 핵심: {signal_str}" if signal_str else "")
        return cross

    def _call_cross_context_enrichment(
        self,
        category: str,
        first_pass_view: dict[str, Any],
        cross_context: dict[str, str],
    ) -> dict[str, Any]:
        """2nd pass ④⑤: 크로스 컨텍스트 주입 + 놓친 모순/소수의견 비판 요청."""
        other_cats = {k: v for k, v in cross_context.items() if k != category}
        messages = [
            {
                "role": "system",
                "content": (
                    f"너는 '{category}' 카테고리 분석을 심화하는 시장 분석가다. "
                    "1차 분석 결과와 타 카테고리 컨텍스트를 바탕으로 분석을 보완하라. "
                    "반드시 JSON 객체만 출력하라. 마크다운 코드블록 없이 순수 JSON.\n\n"
                    "보완 지침:\n"
                    "1. [크로스 시그널] 타 카테고리 동향이 이 카테고리에 미치는 연쇄 영향을 구체적으로 서술\n"
                    "2. [누락된 모순] 1차 분석에서 빠진 상반된 시각이나 리스크를 추가\n"
                    "3. [소수의견] 1~2개 리포트만 언급했지만 주목할 만한 비컨센서스 시각\n"
                    "4. [투자 가설 강화] 크로스 카테고리 정보를 반영해 investment_hypothesis를 더 구체적으로 재작성\n"
                    "기존 필드 값을 유지하되 enriched_ 접두사 필드로 보완 내용을 추가하라"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": "cross_context_enrichment",
                        "category": category,
                        "first_pass_analysis": first_pass_view,
                        "other_category_context": other_cats,
                        "required_additions": {
                            "enriched_cross_signals": [],
                            "enriched_contradictions": [],
                            "enriched_minority_view": [],
                            "enriched_investment_hypothesis": "",
                            "enriched_risks": [],
                        },
                    },
                    ensure_ascii=False,
                ),
            },
        ]
        result = self.client.complete_json(
            messages=messages,
            temperature=self.config.merge_temperature,
            max_tokens=self.config.category_merge_max_tokens,
            retry_attempts=self.config.merge_retry_attempts,
        )
        enriched = result.payload
        # 기존 1st pass view에 enriched_ 필드를 병합
        merged = dict(first_pass_view)
        for k, v in enriched.items():
            if k.startswith("enriched_") and v:
                merged[k] = v
        return merged

    def merge_by_category(self, report_summaries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """카테고리별로 병합하고 결과를 파일로 저장한다.

        세 가지 개선사항 포함:
        ③ index.json opinion/target_price 주입
        ④ 카테고리 간 크로스 컨텍스트 2nd pass
        ⑤ 누락 모순/소수의견 비판 2nd pass
        """
        # ③ index.json 메타데이터 로드 후 summary에 주입
        id_to_meta = self._load_index_metadata(report_summaries)
        enriched_summaries = [
            self._enrich_summary_with_index(s, id_to_meta.get(s.get("report_id") or s.get("id") or "", {}))
            for s in report_summaries
        ]

        groups = self._group_by_category(enriched_summaries)
        by_category_dir = self.config.merged_dir / "by_category"
        ensure_dir(by_category_dir)
        category_views: dict[str, dict[str, Any]] = {}

        # ── 1st pass: 카테고리별 병합 ──
        self.log("  📊 1st pass: 카테고리별 병합...")
        for category, summaries in sorted(groups.items()):
            safe_name = category_slug(category)
            out_path = by_category_dir / f"{safe_name}.json"
            if not self.force and out_path.exists():
                cached = read_json(out_path, {})
                cached_view = cached.get("category_view")
                if isinstance(cached_view, dict) and not cached.get("meta", {}).get("cross_enriched"):
                    # cross enrichment 안 된 캐시는 재사용하되 2nd pass 대상으로 표시
                    category_views[category] = cached_view
                    self.log(f"  🗂  {category}: 기존 결과 재사용 (cross enrichment 예정)")
                    continue
                elif isinstance(cached_view, dict):
                    category_views[category] = cached_view
                    self.log(f"  🗂  {category}: 기존 결과 재사용 → {relative_to_repo(out_path, self.config.repo_root)}")
                    continue

            self.log(f"  🗂  {category}: {len(summaries)}개 리포트 병합 중...")
            try:
                view = self.merge_category_view(category, summaries)
                category_views[category] = view
                self.log(f"     ✅ {category} 1st pass 완료")
            except Exception as error:  # noqa: BLE001
                self.log(f"     ⚠️ {category} 병합 실패, 로컬 폴백 사용: {error}")
                category_views[category] = self._merge_category_view_local(category, summaries)

        # ── 2nd pass: ④ 크로스 컨텍스트 + ⑤ 비판 보완 ──
        self.log("  🔗 2nd pass: 크로스 컨텍스트 enrichment...")
        cross_context = self._build_cross_context(category_views)
        enriched_views: dict[str, dict[str, Any]] = {}

        for category in sorted(category_views.keys()):
            safe_name = category_slug(category)
            out_path = by_category_dir / f"{safe_name}.json"
            # 이미 cross_enriched된 캐시는 스킵
            if not self.force and out_path.exists():
                cached = read_json(out_path, {})
                if cached.get("meta", {}).get("cross_enriched"):
                    enriched_views[category] = cached.get("category_view", category_views[category])
                    self.log(f"  🔗 {category}: cross enrichment 캐시 재사용")
                    continue

            self.log(f"  🔗 {category}: cross enrichment 중...")
            try:
                enriched_view = self._call_cross_context_enrichment(
                    category, category_views[category], cross_context
                )
                enriched_views[category] = enriched_view
                write_json(out_path, {
                    "meta": {
                        "pipeline_version": PIPELINE_VERSION,
                        "generated_at": now_iso(),
                        "category": category,
                        "report_count": len(groups.get(category, [])),
                        "model": self.config.model,
                        "detail_level": self.config.detail_level,
                        "cross_enriched": True,
                    },
                    "category_view": enriched_view,
                })
                self.log(f"     ✅ {category} cross enrichment 완료 → {relative_to_repo(out_path, self.config.repo_root)}")
            except Exception as error:  # noqa: BLE001
                self.log(f"     ⚠️ {category} cross enrichment 실패 (1st pass 결과 사용): {error}")
                enriched_views[category] = category_views[category]
                write_json(out_path, {
                    "meta": {
                        "pipeline_version": PIPELINE_VERSION,
                        "generated_at": now_iso(),
                        "category": category,
                        "report_count": len(groups.get(category, [])),
                        "model": self.config.model,
                        "detail_level": self.config.detail_level,
                        "cross_enriched": False,
                    },
                    "category_view": category_views[category],
                })

        self.stats["category_merges_created"] = len(enriched_views)
        return enriched_views

    def _extract_structured_analysis_local(self, category_views: dict[str, dict[str, Any]]) -> dict[str, Any]:
        category_count = max(len(category_views), 1)
        theme_specs = [
            {
                "theme": "AI 인프라/반도체 수요 지속",
                "keywords": ["ai", "반도체", "hbm", "nand", "mlcc", "데이터센터", "gpu"],
            },
            {
                "theme": "지정학-에너지 안보가 방산·원전 서사를 강화",
                "keywords": ["지정학", "중동", "유가", "방산", "원전", "에너지", "호르무즈"],
            },
            {
                "theme": "유동성/금리 안정이 위험자산 선호를 지지",
                "keywords": ["금리", "국채", "유동성", "vix", "위험자산", "외국인", "상승"],
            },
            {
                "theme": "실적장세와 밸류업이 종목 차별화를 확대",
                "keywords": ["실적", "밸류업", "preview", "거래대금", "증권", "roe"],
            },
        ]

        category_texts: dict[str, str] = {}
        for category, view in category_views.items():
            pool = [
                str(view.get("market_summary", "")),
                *[str(item) for item in view.get("macro_view", [])],
                *[str(item) for item in view.get("sector_view", [])],
                *[str(item) for item in view.get("key_signals", [])],
                *[str(item) for item in view.get("risks", [])],
            ]
            category_texts[category] = " ".join(pool)

        consensus = []
        for spec in theme_specs:
            matched_categories = [
                category for category, text in category_texts.items() if _contains_theme(text, spec["keywords"])
            ]
            if not matched_categories:
                continue
            evidence = ", ".join(matched_categories)
            consensus.append(
                {
                    "theme": spec["theme"],
                    "agreement_rate": round(len(set(matched_categories)) / category_count, 2),
                    "evidence": f"{evidence} 카테고리에서 반복적으로 확인됨",
                }
            )
        consensus = consensus[:5]

        minority_views = []
        for category, view in category_views.items():
            if category in {"기타", "투자전략"} or len(view.get("actionable_points", [])) >= 4:
                rationale = view.get("market_summary", "")
                minority_views.append(
                    {
                        "theme": f"{category}에서 포착된 비주류 시나리오",
                        "agreement_rate": round(1 / category_count, 2),
                        "rationale": clip_text(rationale, 180),
                        "why_worth_noting": clip_text(
                            "다른 카테고리보다 실행 아이디어가 구체적이거나 이벤트 드리븐 성격이 강함",
                            140,
                        ),
                    }
                )
        minority_views = minority_views[:4]

        contradictions = []
        macro_view = category_views.get("경제분석", {})
        market_view = category_views.get("시황정보", {})
        fixed_income_view = category_views.get("채권분석", {})
        if macro_view and market_view:
            contradictions.append(
                {
                    "topic": "지정학 리스크와 위험자산 랠리의 공존",
                    "bullish": {
                        "publisher": "시황정보",
                        "reason": clip_text(market_view.get("market_summary", ""), 110),
                    },
                    "bearish": {
                        "publisher": "경제분석",
                        "reason": clip_text(macro_view.get("market_summary", ""), 110),
                    },
                }
            )
        if fixed_income_view and market_view:
            contradictions.append(
                {
                    "topic": "채권 크레딧 경계와 주식 위험선호 회복의 충돌",
                    "bullish": {
                        "publisher": "시황정보",
                        "reason": clip_text(market_view.get("market_summary", ""), 110),
                    },
                    "bearish": {
                        "publisher": "채권분석",
                        "reason": clip_text(fixed_income_view.get("market_summary", ""), 110),
                    },
                }
            )
        contradictions = contradictions[:5]

        company_candidates: list[str] = []
        for category in ("산업분석", "종목분석", "시황정보"):
            view = category_views.get(category, {})
            for company in view.get("company_mentions", [])[:4]:
                if isinstance(company, dict) and company.get("name"):
                    company_candidates.append(str(company["name"]))

        cross_category_signals = [
            {
                "signal": "지정학 불안과 에너지 안보 서사의 동시 부각",
                "macro_implication": "방산·원전·전력설비가 중기 알파 소스로 재평가될 가능성",
                "sector_beneficiary": ["방산", "원전", "전력설비"],
                "company_plays": _common_strings(company_candidates, 3),
            },
            {
                "signal": "AI 인프라 수요와 반도체/부품 공급망 확장",
                "macro_implication": "반도체 장비·소재·전력기기까지 수혜 사슬이 이어질 가능성",
                "sector_beneficiary": ["반도체", "전자부품", "전력기기"],
                "company_plays": _common_strings(company_candidates[1:], 3),
            },
            {
                "signal": "금리 안정과 거래대금 회복",
                "macro_implication": "증권·성장주·대형 기술주에 우호적인 유동성 환경",
                "sector_beneficiary": ["증권", "성장주", "대형 기술주"],
                "company_plays": _common_strings(company_candidates[2:], 3),
            },
        ]

        return {
            "consensus": consensus,
            "minority_views": minority_views,
            "contradictions": contradictions,
            "cross_category_signals": cross_category_signals,
        }

    def extract_structured_analysis(self, category_views: dict[str, dict[str, Any]]) -> dict[str, Any]:
        """카테고리 뷰들로부터 컨센서스/소수의견/모순/크로스신호를 구조화 추출한다."""
        out_path = self.config.merged_dir / "structured_analysis.json"
        messages = [
            {
                "role": "system",
                "content": (
                    "너는 여러 카테고리의 증권사 리포트 뷰를 분석해서 구조화된 인사이트를 추출하는 분석기다. "
                    "반드시 JSON 객체만 출력하라. "
                    "consensus agreement_rate는 0~1 사이 숫자로 추정하라. "
                    "contradictions는 같은 종목/주제에 대한 상반된 뷰를 찾아라."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": "extract_structured_analysis",
                        "required_schema": {
                            "consensus": [
                                {"theme": "", "agreement_rate": 0.0, "evidence": ""}
                            ],
                            "minority_views": [
                                {"theme": "", "agreement_rate": 0.0, "rationale": "", "why_worth_noting": ""}
                            ],
                            "contradictions": [
                                {
                                    "topic": "",
                                    "bullish": {"publisher": "", "reason": ""},
                                    "bearish": {"publisher": "", "reason": ""},
                                }
                            ],
                            "cross_category_signals": [
                                {
                                    "signal": "",
                                    "macro_implication": "",
                                    "sector_beneficiary": [],
                                    "company_plays": [],
                                }
                            ],
                        },
                        "category_views": category_views,
                        "detail_level": self.config.detail_level,
                    },
                    ensure_ascii=False,
                ),
            },
        ]
        try:
            result = self.client.complete_json(
                messages=messages,
                temperature=self.config.merge_temperature,
                max_tokens=self.config.analysis_max_tokens,
                retry_attempts=self.config.merge_retry_attempts,
            )
            self.stats["retry_count"] += max(0, result.attempts - 1)
            analysis = result.payload
            model_name = self.config.model
        except Exception as error:  # noqa: BLE001
            self.log(f"     ⚠️ 구조화 분석 Gemini 실패, 로컬 폴백 사용: {error}")
            analysis = self._extract_structured_analysis_local(category_views)
            model_name = "local-fallback"
        write_json(out_path, {
            "meta": {
                "pipeline_version": PIPELINE_VERSION,
                "generated_at": now_iso(),
                "model": model_name,
                "detail_level": self.config.detail_level,
            },
            "analysis": analysis,
        })
        self.stats["structured_analysis_created"] = True
        return analysis

    def generate_deep_research_prompt(self, analysis: dict[str, Any], date: str | None = None) -> None:
        """구조화된 분석을 기반으로 Gemini 딥리서치용 프롬프트 MD 파일을 생성한다."""
        date_str = date or dt.date.today().isoformat()
        out_path = self.config.merged_dir / "deep_research_prompt.md"

        consensus_lines = []
        for i, item in enumerate(analysis.get("consensus", [])[:5], 1):
            rate = item.get("agreement_rate", 0)
            pct = f"{int(rate * 100)}%" if isinstance(rate, (int, float)) else str(rate)
            consensus_lines.append(f"{i}. **{item.get('theme', '')}** ({pct} 동의): {item.get('evidence', '')}")

        minority_lines = []
        for item in analysis.get("minority_views", [])[:4]:
            rate = item.get("agreement_rate", 0)
            pct = f"{int(rate * 100)}%" if isinstance(rate, (int, float)) else str(rate)
            minority_lines.append(
                f"- **{item.get('theme', '')}** ({pct}): {item.get('rationale', '')} "
                f"— 주목 이유: {item.get('why_worth_noting', '')}"
            )

        contradiction_lines = []
        for item in analysis.get("contradictions", [])[:5]:
            bull = item.get("bullish", {})
            bear = item.get("bearish", {})
            contradiction_lines.append(
                f"- **{item.get('topic', '')}**: "
                f"{bull.get('publisher', '')}(매수, {bull.get('reason', '')}) vs "
                f"{bear.get('publisher', '')}(주의, {bear.get('reason', '')})"
            )

        cross_lines = []
        for item in analysis.get("cross_category_signals", [])[:5]:
            sectors = ", ".join(item.get("sector_beneficiary", []))
            companies = ", ".join(item.get("company_plays", []))
            cross_lines.append(
                f"- **{item.get('signal', '')}** → {item.get('macro_implication', '')} "
                f"→ 섹터 수혜: {sectors or '-'}, 종목: {companies or '-'}"
            )

        nl = "\n"
        prompt = (
            f"# {date_str} 증권사 리포트 딥리서치 요청\n\n"
            "오늘 증권사 리포트들을 AI로 분석한 구조화된 결과입니다.\n"
            "아래 내용을 바탕으로 딥리서치를 수행해 주세요.\n\n"
            "---\n\n"
            "## 📊 컨센서스 (상위 동의 테마)\n\n"
            f"{nl.join(consensus_lines) or '- 데이터 없음'}\n\n"
            "---\n\n"
            "## 🔍 소수 의견 — 검토 가치 있음\n\n"
            f"{nl.join(minority_lines) or '- 데이터 없음'}\n\n"
            "---\n\n"
            "## ⚡ 모순·충돌 — 판단 요청\n\n"
            f"{nl.join(contradiction_lines) or '- 데이터 없음'}\n\n"
            "---\n\n"
            "## 🔗 크로스카테고리 신호\n\n"
            f"{nl.join(cross_lines) or '- 데이터 없음'}\n\n"
            "---\n\n"
            "## 🎯 딥리서치 요청 사항\n\n"
            "1. **소수 의견 검증**: 소수 의견 중 실현 가능성이 높은 것은? 최신 글로벌 데이터와 뉴스를 근거로 판단해 주세요.\n"
            "2. **모순 해소**: 모순·충돌 목록에서 어느 쪽이 더 설득력 있나요? 외부 데이터 기반으로 판단해 주세요.\n"
            "3. **크로스시그널 투자 아이디어**: 크로스카테고리 신호에서 도출되는 구체적 투자 아이디어 3가지를 제시해 주세요 (ETF 또는 개별 종목 포함).\n"
            "4. **컨센서스 사각지대**: 현재 컨센서스가 놓치고 있는 리스크 또는 기회는 무엇인가요?\n"
            "5. **실행 체크리스트**: 이번 주 투자 관점에서 확인해야 할 사항 3가지를 요약해 주세요.\n"
        )
        write_text(out_path, prompt)
        self.log(f"  📋 딥리서치 프롬프트 생성 → {relative_to_repo(out_path, self.config.repo_root)}")

    def merge_final_market_view(
        self,
        report_summaries: list[dict[str, Any]],
        category_views: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        if not report_summaries:
            return

        report_summaries_sorted = sorted(
            report_summaries,
            key=lambda item: (item.get("publish_date", ""), item.get("report_title", "")),
        )
        prompt_report_summaries = compact_report_summaries_for_final(report_summaries_sorted, self.config.detail_level)
        summary_hash = sha1_of_text(json.dumps(report_summaries_sorted, ensure_ascii=False, sort_keys=True))
        json_path = self.config.merged_dir / "final_market_view.json"
        existing = read_json(json_path, {})
        if (
            not self.force
            and existing.get("meta", {}).get("report_summaries_hash") == summary_hash
            and existing.get("meta", {}).get("pipeline_version") == PIPELINE_VERSION
            and existing.get("meta", {}).get("detail_level") == self.config.detail_level
        ):
            return

        category_prompt_views = compact_category_views_for_final(category_views or {}, self.config.detail_level)
        use_category_views = len(category_prompt_views) > 0
        merge_payload: dict[str, Any] = {
            "task": "merge_final_market_view",
            "required_schema": {
                "market_summary": "",
                "macro_view": [],
                "sector_view": [],
                "company_watchlist": [
                    {
                        "name": "",
                        "ticker": None,
                        "view": "",
                        "catalysts": [],
                        "risks": [],
                    }
                ],
                "key_signals": [],
                "risks": [],
                "actionable_points": [],
            },
            "detail_level": self.config.detail_level,
        }
        if use_category_views:
            merge_payload["category_views"] = category_prompt_views
            merge_payload["preferred_source"] = "category_views"
        else:
            merge_payload["report_summaries"] = prompt_report_summaries
            merge_payload["preferred_source"] = "report_summaries"

        messages = [
            {
                "role": "system",
                "content": (
                    "너는 여러 개의 report summary JSON 또는 category view JSON을 하나의 투자 인사이트 시장 뷰로 병합하는 분석기다. "
                    "반드시 JSON 객체만 출력하라. 보고서 원문이 아니라 구조화된 요약 입력만 사용하라. "
                    f"company_watchlist는 최대 {get_detail_limits(self.config.detail_level)['watchlist_max']}개, "
                    f"나머지 리스트 필드는 최대 {get_detail_limits(self.config.detail_level)['final_list_max']}개만 남겨라. "
                    "리포트 간 공통분모, 충돌 포인트, 앞으로 확인할 이벤트 캘린더와 기회 버킷이 있으면 구조적으로 정리하라."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(merge_payload, ensure_ascii=False),
            },
        ]
        if self.config.is_deep:
            required_schema = json.loads(messages[1]["content"])
            required_schema["required_schema"].update(
                {
                    "regime_view": "",
                    "cross_report_consensus": [],
                    "cross_report_conflicts": [],
                    "monitoring_calendar": [{"event": "", "timing": "", "why_it_matters": ""}],
                    "opportunity_buckets": [{"theme": "", "why_now": "", "linked_reports": []}],
                }
            )
            messages[1]["content"] = json.dumps(required_schema, ensure_ascii=False)

        result = self.client.complete_json(
            messages=messages,
            temperature=self.config.merge_temperature,
            max_tokens=self.config.final_merge_max_tokens,
            retry_attempts=self.config.merge_retry_attempts,
        )
        self.stats["retry_count"] += max(0, result.attempts - 1)
        final_view = normalize_final_market_view(result.payload, report_summaries_sorted, self.config.detail_level)

        write_json(
            json_path,
            {
                "meta": {
                    "pipeline_version": PIPELINE_VERSION,
                    "generated_at": now_iso(),
                    "report_summaries_hash": summary_hash,
                    "model": self.config.model,
                    "detail_level": self.config.detail_level,
                },
                "market_view": final_view,
            },
        )
        write_text(self.config.merged_dir / "final_market_view.md", self.render_final_markdown(final_view))
        if self.config.is_deep:
            write_text(self.config.merged_dir / "final_market_view.deep.md", self.render_final_markdown(final_view))
            write_json(self.config.merged_dir / "final_market_view.deep.json", {"meta": {"detail_level": self.config.detail_level}, "market_view": final_view})
        self.stats["final_merge_created"] = True

    def render_final_markdown(self, market_view: dict[str, Any]) -> str:
        lines = [
            "# Final Market View",
            "",
            f"- Generated at: {market_view.get('generated_at', '')}",
            f"- Source reports: {market_view.get('report_count', 0)}",
            f"- Detail level: {market_view.get('detail_level', self.config.detail_level)}",
            "",
            "## Market Summary",
            market_view.get("market_summary", "") or "-",
            "",
            "## Macro View",
        ]
        if market_view.get("regime_view"):
            lines.extend(["", "## Regime View", market_view.get("regime_view", "")])
        lines.extend([f"- {item}" for item in market_view.get("macro_view", [])] or ["-"])
        lines.extend(["", "## Sector View"])
        lines.extend([f"- {item}" for item in market_view.get("sector_view", [])] or ["-"])
        if market_view.get("cross_report_consensus"):
            lines.extend(["", "## Cross-Report Consensus"])
            lines.extend([f"- {item}" for item in market_view.get("cross_report_consensus", [])])
        if market_view.get("cross_report_conflicts"):
            lines.extend(["", "## Cross-Report Conflicts"])
            lines.extend([f"- {item}" for item in market_view.get("cross_report_conflicts", [])])
        lines.extend(["", "## Key Signals"])
        lines.extend([f"- {item}" for item in market_view.get("key_signals", [])] or ["-"])
        lines.extend(["", "## Risks"])
        lines.extend([f"- {item}" for item in market_view.get("risks", [])] or ["-"])
        lines.extend(["", "## Actionable Points"])
        lines.extend([f"- {item}" for item in market_view.get("actionable_points", [])] or ["-"])
        if market_view.get("monitoring_calendar"):
            lines.extend(["", "## Monitoring Calendar"])
            for item in market_view.get("monitoring_calendar", []):
                event = item.get("event", "")
                timing = item.get("timing", "")
                why = item.get("why_it_matters", "")
                lines.append(f"- {timing} | {event}: {why}".strip())
        if market_view.get("opportunity_buckets"):
            lines.extend(["", "## Opportunity Buckets"])
            for item in market_view.get("opportunity_buckets", []):
                lines.append(f"- {item.get('theme', '')}: {item.get('why_now', '')}".strip())
        lines.extend(["", "## Company Watchlist"])
        if market_view.get("company_watchlist"):
            for item in market_view["company_watchlist"]:
                line = f"- {item['name']}"
                if item.get("ticker"):
                    line += f" ({item['ticker']})"
                if item.get("view"):
                    line += f": {item['view']}"
                lines.append(line)
        else:
            lines.append("-")

        lines.extend(["", "## Report Digests"])
        for report in market_view.get("reports", []):
            title = report.get("report_title", "Untitled report")
            publish_date = report.get("publish_date", "")
            publisher = report.get("publisher", "")
            lines.extend(
                [
                    f"### {publish_date} | {title}",
                    f"- Publisher: {publisher or '-'}",
                    f"- Sentiment: {report.get('overall_sentiment', 'neutral')}",
                    f"- Time horizon: {report.get('time_horizon', 'mid_term')}",
                    f"- Summary: {report.get('core_summary', '') or '-'}",
                ]
            )
            if report.get("variant_view"):
                lines.append(f"- Variant view: {report.get('variant_view', '')}")
            if report.get("consensus_gap"):
                lines.append(f"- Consensus gap: {report.get('consensus_gap', '')}")
            if report.get("valuation_view"):
                lines.append(f"- Valuation view: {report.get('valuation_view', '')}")
            for item in report.get("portfolio_relevance", []):
                lines.append(f"- Portfolio relevance: {item}")
            for item in report.get("monitoring_checklist", []):
                lines.append(f"- Monitoring: {item}")
            for item in report.get("event_timeline", []):
                lines.append(f"- Event: {item.get('timing', '')} | {item.get('event', '')} | {item.get('importance', '')}")
            for item in report.get("actionable_points", []):
                lines.append(f"- Action: {item}")
            lines.append("")

        return "\n".join(lines).strip() + "\n"

    def write_logs(self) -> None:
        write_json(self.config.logs_dir / "failed_files.json", self.failed_files)
        if self.request_failures:
            write_json(self.config.logs_dir / "llm_failures.json", self.request_failures)
        self.stats["finished_at"] = now_iso()
        write_json(self.config.logs_dir / "run_stats.json", self.stats)

    def run(self, *, test_connection_only: bool = False, chunks_only: bool = False) -> int:
        self.ensure_output_layout()
        if test_connection_only:
            connection = self.ensure_windows_llm_ready()
            if not connection["ok"]:
                self.write_logs()
                return 2
            self.write_logs()
            return 0

        if chunks_only:
            self.stats["chunks_only"] = True
            self.stats["connection_test"] = {
                "ok": None,
                "skipped": True,
                "reason": "chunks-only mode does not call the Windows LLM server",
            }
            self.log("🧩 Chunks-only mode: skipping Windows LLM connection, WOL, summaries, final merge, and shutdown.")
        else:
            connection = self.ensure_windows_llm_ready()
            if not connection["ok"]:
                self.stats["reports_failed"] = self.stats["reports_total"]
                self.write_logs()
                return 2

        reports = self.collect_reports()
        self.stats["reports_total"] = len(reports)
        self.log(f"📚 Collected {len(reports)} PDF reports from {relative_to_repo(self.config.input_root, self.config.repo_root)}")

        successful_report_summaries: list[dict[str, Any]] = []

        for index, report in enumerate(reports, start=1):
            title_preview = report.title[:80]
            self.log(f"[{index}/{len(reports)}] {report.report_date} {report.report_id} | {title_preview}")
            if not report.pdf_path.exists():
                self._record_failure(stage="collect", report=report, message=f"PDF not found: {report.pdf_path}")
                self.stats["reports_failed"] += 1
                continue

            fingerprint = sha1_of_file(report.pdf_path)
            try:
                self.mirror_raw_pdf(report)
                cleaned_text, text_reused = self.extract_and_preprocess_text(report, fingerprint)
                chunks, chunks_reused = self.build_chunks(report, cleaned_text, fingerprint)
                if not chunks:
                    raise RuntimeError("No chunks were created from the extracted text")
                self.stats["chunk_total"] += len(chunks)

                if chunks_only:
                    if text_reused and chunks_reused:
                        self.stats["reports_skipped"] += 1
                    else:
                        self.stats["reports_processed"] += 1
                    continue

                chunk_summaries, chunk_reused = self.summarize_chunks(report, chunks, fingerprint)
                report_summary, report_reused = self.merge_report_summary(report, chunk_summaries, fingerprint)
                successful_report_summaries.append(report_summary)

                fully_reused = text_reused and chunks_reused and chunk_reused and report_reused
                if fully_reused:
                    self.stats["reports_skipped"] += 1
                else:
                    self.stats["reports_processed"] += 1

            except Exception as error:  # noqa: BLE001
                self._record_failure(stage="report", report=report, message=str(error))
                self.stats["reports_failed"] += 1
                self.log(f"  ❌ failed: {error}")
                continue

        if chunks_only:
            self.stats["final_merge_created"] = False
            self.stats["shutdown_action"] = "skipped"
            self.stats["shutdown_method"] = "none"
            self.stats["shutdown_ok"] = False
            self.stats["shutdown_note"] = "Skipped because chunks-only mode does not use the Windows LLM server."
        else:
            def _make_synthetic_report(report_id: str) -> ReportSource:
                return ReportSource(
                    report_date=self.date_filter or "all",
                    report_id=report_id,
                    title=report_id,
                    publisher="",
                    publish_date="",
                    category="other",
                    pdf_path=self.config.repo_root / "reports",
                    preferred_text_path=None,
                    metadata={},
                )

            # Step 1: 카테고리별 병합
            category_views: dict[str, dict[str, Any]] = {}
            try:
                self.log("🗂  카테고리별 병합 시작...")
                category_views = self.merge_by_category(successful_report_summaries)
            except Exception as error:  # noqa: BLE001
                self._record_failure(stage="category_merge", report=_make_synthetic_report("category_merge"), message=str(error))

            # Step 2: 기존 final_market_view 병합 (하위 호환 유지)
            try:
                self.merge_final_market_view(successful_report_summaries, category_views)
            except Exception as error:  # noqa: BLE001
                self._record_failure(stage="final_merge", report=_make_synthetic_report("final_market_view"), message=str(error))

            # Step 3: 구조화 분석 추출 (카테고리 뷰가 있을 때만)
            if category_views:
                try:
                    self.log("🔬 구조화 분석 추출 중...")
                    analysis = self.extract_structured_analysis(category_views)
                    # Step 4: 딥리서치 프롬프트 생성
                    self.generate_deep_research_prompt(analysis, date=self.date_filter)
                except Exception as error:  # noqa: BLE001
                    self._record_failure(stage="structured_analysis", report=_make_synthetic_report("structured_analysis"), message=str(error))

            shutdown_result = self.shutdown_windows_if_configured()
            self.stats["shutdown_action"] = "attempted" if self.config.shutdown_method not in {"", "none"} else "skipped"
            self.stats["shutdown_method"] = shutdown_result.method
            self.stats["shutdown_ok"] = shutdown_result.ok
            self.stats["shutdown_note"] = shutdown_result.details

        self.write_logs()
        return 0 if self.stats["reports_failed"] == 0 else 1


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.detail:
        os.environ["REPORT_ORCHESTRATOR_DETAIL"] = args.detail
    config = load_config(args.config)
    orchestrator = ReportOrchestrator(
        config,
        force=args.force,
        date_filter=args.date,
        limit=args.limit,
    )
    return orchestrator.run(test_connection_only=args.test_connection_only, chunks_only=args.chunks_only)
