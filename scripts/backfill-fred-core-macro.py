#!/usr/bin/env python3
"""
FRED 핵심 매크로(VIXCLS, T10Y2Y)를 날짜 범위로 백필해
data/macro/fred-YYYY-MM-DD.json 파일을 생성/보완한다.

사용 예시:
  python3 scripts/backfill-fred-core-macro.py --start 2025-12-01 --end 2026-04-17
  python3 scripts/backfill-fred-core-macro.py --start 2025-12-01 --end 2026-04-17 --overwrite
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from lib.env_loader import load_simple_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_simple_dotenv(ROOT / ".env")

FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"
CORE_SERIES = ("VIXCLS", "T10Y2Y")


@dataclass(frozen=True)
class SeriesPoint:
  date: str
  value: float


def parse_iso_date(text: str) -> date:
  try:
    return datetime.strptime(text, "%Y-%m-%d").date()
  except ValueError as exc:
    raise argparse.ArgumentTypeError(f"invalid date: {text}") from exc


def date_range(start: date, end: date):
  current = start
  while current <= end:
    yield current
    current += timedelta(days=1)


def fetch_series(api_key: str, series_id: str, start: date, end: date) -> list[SeriesPoint]:
  params = {
    "series_id": series_id,
    "api_key": api_key,
    "file_type": "json",
    "observation_start": start.strftime("%Y-%m-%d"),
    "observation_end": end.strftime("%Y-%m-%d"),
  }
  request_url = f"{FRED_BASE}?{urlencode(params)}"
  request = Request(request_url, headers={"User-Agent": "Mozilla/5.0"})
  with urlopen(request, timeout=30) as response:
    payload = json.loads(response.read().decode("utf-8"))
  observations = payload.get("observations", [])

  rows: list[SeriesPoint] = []
  for obs in observations:
    raw_value = obs.get("value")
    raw_date = obs.get("date")
    if not raw_date or raw_value in (None, "", "."):
      continue
    try:
      rows.append(SeriesPoint(date=str(raw_date), value=float(raw_value)))
    except ValueError:
      continue
  return rows


def asof_lookup(points: list[SeriesPoint], target: str) -> SeriesPoint | None:
  chosen: SeriesPoint | None = None
  for row in points:
    if row.date <= target:
      chosen = row
    else:
      break
  return chosen


def load_json(path: Path) -> dict | None:
  if not path.exists():
    return None
  try:
    return json.loads(path.read_text(encoding="utf-8"))
  except Exception:
    return None


def main() -> int:
  parser = argparse.ArgumentParser(description="FRED 핵심 매크로 백필")
  parser.add_argument("--start", required=True, type=parse_iso_date, help="시작일 (YYYY-MM-DD)")
  parser.add_argument("--end", required=True, type=parse_iso_date, help="종료일 (YYYY-MM-DD)")
  parser.add_argument("--overwrite", action="store_true", help="기존 파일도 덮어쓰기")
  args = parser.parse_args()

  if args.start > args.end:
    print("❌ --start 는 --end 보다 이전이어야 합니다.", file=sys.stderr)
    return 1

  api_key = os.getenv("FRED_API_KEY", "").strip()
  if not api_key:
    print("❌ FRED_API_KEY가 .env에 없습니다.", file=sys.stderr)
    print("   발급: https://fredaccount.stlouisfed.org/apikeys", file=sys.stderr)
    return 1

  # as-of 조회를 위해 시작일 이전 버퍼 포함
  buffered_start = args.start - timedelta(days=31)
  output_dir = ROOT / "data" / "macro"
  output_dir.mkdir(parents=True, exist_ok=True)

  print(
    f"📥 Fetching core macro series from {buffered_start} to {args.end} (target: {args.start} ~ {args.end})"
  )
  series_data: dict[str, list[SeriesPoint]] = {}
  for series_id in CORE_SERIES:
    rows = fetch_series(api_key, series_id, buffered_start, args.end)
    if not rows:
      print(f"❌ {series_id} returned no rows.", file=sys.stderr)
      return 1
    series_data[series_id] = rows
    print(f"  - {series_id}: {len(rows)} rows")

  created = 0
  updated = 0
  skipped = 0
  failed = 0
  now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

  for day in date_range(args.start, args.end):
    day_str = day.strftime("%Y-%m-%d")
    out_path = output_dir / f"fred-{day_str}.json"
    existing = load_json(out_path) or {}

    if (
      not args.overwrite
      and isinstance(existing.get("VIXCLS"), (int, float))
      and isinstance(existing.get("T10Y2Y"), (int, float))
    ):
      skipped += 1
      continue

    vix_point = asof_lookup(series_data["VIXCLS"], day_str)
    spread_point = asof_lookup(series_data["T10Y2Y"], day_str)
    if not vix_point or not spread_point:
      failed += 1
      continue

    payload = existing if isinstance(existing, dict) else {}
    payload["date"] = day_str
    payload["collected_at"] = now_iso
    payload["VIXCLS"] = vix_point.value
    payload["VIXCLS_date"] = vix_point.date
    payload["T10Y2Y"] = spread_point.value
    payload["T10Y2Y_date"] = spread_point.date
    payload.setdefault("backfill_meta", {})
    if isinstance(payload["backfill_meta"], dict):
      payload["backfill_meta"]["source"] = "scripts/backfill-fred-core-macro.py"
      payload["backfill_meta"]["updated_at"] = now_iso

    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if out_path.exists() and existing:
      updated += 1
    else:
      created += 1

  print(
    f"✅ done. created={created}, updated={updated}, skipped={skipped}, failed={failed}"
  )
  if failed > 0:
    print("⚠️ 일부 날짜는 as-of 매크로 값이 없어 건너뛰었습니다.", file=sys.stderr)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
