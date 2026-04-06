#!/usr/bin/env python3
"""
FRED API에서 핵심 거시경제 지표를 수집해 data/macro/fred-{date}.json 으로 저장한다.

사용:
  python3 scripts/fetch-fred-macro.py --date 2026-04-04
  python3 scripts/fetch-fred-macro.py  # 오늘 날짜 자동 사용
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

# 수집할 시리즈 정의
# (series_id, 이름, 조회 기간(일), 설명)
SERIES = [
    ("T10Y2Y",           "장단기 금리 스프레드 (10Y-2Y)",   60,  "역전 시 경기침체 선행"),
    ("VIXCLS",           "VIX 변동성 지수",                 30,  "시장 공포 지수"),
    ("DFF",              "Fed Funds Rate",                  30,  "미국 기준금리"),
    ("GS10",             "10년 국채 금리",                   30,  "장기 금리 수준"),
    ("CPIAUCSL",         "CPI (도시 소비자)",                400, "인플레이션 (YoY 계산용)"),
    ("UNRATE",           "실업률",                          90,  "고용 상태"),
    ("GOLDAMGBD228NLBM", "금 가격 (USD/트로이온스)",          60,  "안전자산 선호도"),
    ("PCOPPUSDM",        "구리 가격 (USD/톤, 월간)",         120, "경기 선행 지표"),
]


def fetch_series(api_key: str, series_id: str, date: str, lookback_days: int) -> list[dict]:
    start = (datetime.strptime(date, "%Y-%m-%d") - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    try:
        resp = requests.get(FRED_BASE, params={
            "series_id": series_id,
            "api_key": api_key,
            "file_type": "json",
            "observation_start": start,
            "observation_end": date,
        }, timeout=30)
        resp.raise_for_status()
        observations = resp.json().get("observations", [])
        return [{"date": o["date"], "value": float(o["value"])}
                for o in observations if o["value"] not in (".", "")]
    except Exception as e:
        print(f"  ⚠️ {series_id} 수집 실패: {e}", file=sys.stderr)
        return []


def compute_yoy(observations: list[dict]) -> float | None:
    """최신 값과 약 12개월 전 값으로 YoY% 계산."""
    if len(observations) < 2:
        return None
    latest = observations[-1]["value"]
    # 12개월 전(약 365일) 데이터 선택
    target_date = datetime.strptime(observations[-1]["date"], "%Y-%m-%d") - timedelta(days=365)
    candidates = [o for o in observations if datetime.strptime(o["date"], "%Y-%m-%d") <= target_date]
    if not candidates:
        return None
    year_ago = candidates[-1]["value"]
    if year_ago == 0:
        return None
    return round((latest - year_ago) / year_ago * 100, 4)


def compute_copper_gold_ratio(copper_obs: list[dict], gold_obs: list[dict]) -> dict | None:
    """구리/금 비율과 방향성 계산. 상승 → 경기 낙관, 하락 → 경기 비관."""
    if not copper_obs or not gold_obs:
        return None
    # 구리: USD/톤 → 트로이온스 환산(1톤=32150.7트로이온스) 후 금과 비교
    copper_latest = copper_obs[-1]["value"]
    gold_latest = gold_obs[-1]["value"]
    if gold_latest == 0:
        return None
    # 단순 비율 (구리달러/톤 ÷ 금달러/온스) — 방향성이 중요
    ratio_latest = copper_latest / gold_latest
    # 한 달 전 비율
    if len(copper_obs) >= 2 and len(gold_obs) >= 2:
        ratio_prev = copper_obs[-2]["value"] / max(gold_obs[-2]["value"], 1)
        momentum = "rising" if ratio_latest > ratio_prev else "falling"
    else:
        momentum = "unknown"
    return {
        "ratio": round(ratio_latest, 4),
        "momentum": momentum,
        "copper_usd_per_ton": copper_latest,
        "gold_usd_per_oz": gold_latest,
    }


def build_leading_signals(data: dict) -> dict:
    """수집된 FRED 데이터로 선행 신호 요약 생성."""
    signals = {}

    # 1. 장단기 금리 스프레드
    t10y2y = data.get("T10Y2Y")
    if t10y2y is not None:
        if t10y2y < -0.5:
            signals["yield_curve"] = {"value": t10y2y, "signal": "inversion_strong", "bias": "bearish"}
        elif t10y2y < 0:
            signals["yield_curve"] = {"value": t10y2y, "signal": "inversion_mild", "bias": "caution"}
        elif t10y2y > 0.5:
            signals["yield_curve"] = {"value": t10y2y, "signal": "normal", "bias": "bullish"}
        else:
            signals["yield_curve"] = {"value": t10y2y, "signal": "flat", "bias": "neutral"}

    # 2. VIX
    vix = data.get("VIXCLS")
    if vix is not None:
        if vix >= 30:
            signals["vix"] = {"value": vix, "signal": "extreme_fear", "bias": "bearish"}
        elif vix >= 20:
            signals["vix"] = {"value": vix, "signal": "elevated", "bias": "caution"}
        else:
            signals["vix"] = {"value": vix, "signal": "normal", "bias": "bullish"}

    # 3. 인플레이션
    cpi_yoy = data.get("CPIAUCSL_YOY")
    if cpi_yoy is not None:
        if cpi_yoy > 4:
            signals["inflation"] = {"value": cpi_yoy, "signal": "high", "bias": "bearish"}
        elif cpi_yoy > 2.5:
            signals["inflation"] = {"value": cpi_yoy, "signal": "elevated", "bias": "caution"}
        else:
            signals["inflation"] = {"value": cpi_yoy, "signal": "normal", "bias": "bullish"}

    # 4. 구리/금 비율
    cg = data.get("copper_gold_ratio")
    if cg:
        signals["copper_gold"] = {
            "ratio": cg["ratio"],
            "momentum": cg["momentum"],
            "bias": "bullish" if cg["momentum"] == "rising" else "bearish",
        }

    # 종합 선행 스코어 (0~100)
    bias_scores = {"bullish": 70, "caution": 50, "neutral": 50, "bearish": 30}
    values = [bias_scores.get(s.get("bias", "neutral"), 50) for s in signals.values()]
    signals["composite_score"] = round(sum(values) / len(values), 1) if values else 50

    return signals


def main():
    parser = argparse.ArgumentParser(description="FRED 매크로 데이터 수집")
    parser.add_argument("--date", default=datetime.now().strftime("%Y-%m-%d"))
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    api_key = os.getenv("FRED_API_KEY", "")
    if not api_key:
        print("❌ FRED_API_KEY가 .env에 없습니다.", file=sys.stderr)
        print("   발급: https://fredaccount.stlouisfed.org/apikeys", file=sys.stderr)
        sys.exit(1)

    print(f"📊 FRED 데이터 수집 시작 ({args.date})")

    data: dict = {
        "date": args.date,
        "collected_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    raw: dict = {}

    for series_id, name, lookback, desc in SERIES:
        print(f"  → {series_id} ({name})", end=" ", flush=True)
        obs = fetch_series(api_key, series_id, args.date, lookback)
        if obs:
            latest = obs[-1]
            data[series_id] = latest["value"]
            data[f"{series_id}_date"] = latest["date"]
            raw[series_id] = obs
            print(f"= {latest['value']} ({latest['date']})")
        else:
            print("(없음)")

    # YoY 계산
    if "CPIAUCSL" in raw:
        yoy = compute_yoy(raw["CPIAUCSL"])
        if yoy is not None:
            data["CPIAUCSL_YOY"] = yoy
            print(f"  → CPIAUCSL YoY = {yoy}%")

    # 구리/금 비율
    cg = compute_copper_gold_ratio(raw.get("PCOPPUSDM", []), raw.get("GOLDAMGBD228NLBM", []))
    if cg:
        data["copper_gold_ratio"] = cg
        print(f"  → 구리/금 비율 = {cg['ratio']} ({cg['momentum']})")

    # 선행 신호 요약
    data["leading_signals"] = build_leading_signals(data)
    print(f"  → 선행 종합 스코어 = {data['leading_signals']['composite_score']}")

    # 저장
    out_dir = ROOT / "data" / "macro"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = Path(args.output) if args.output else out_dir / f"fred-{args.date}.json"
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ 저장: {out_path}")


if __name__ == "__main__":
    main()
