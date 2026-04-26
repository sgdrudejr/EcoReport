#!/usr/bin/env python3
"""
KIS API로 국내 ETF/ETN 등락률 랭킹을 수집해 JSON으로 저장한다.

동작 방식
1) 네이버 ETF 목록 API에서 ETF 유니버스(코드/이름/거래량) 확보
2) 각 코드에 대해 KIS ETF/ETN 현재가 API 조회
3) 당일 등락률(changePct) 기준 정렬 후 상위 N개 저장

사용:
  .venv/bin/python scripts/collectors/fetch-kis-etf-ranking.py --date 2026-04-20 --top-n 80
  .venv/bin/python scripts/collectors/fetch-kis-etf-ranking.py  # 오늘 날짜
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# KIS SDK 경로 추가
KIS_SDK_PATH = Path(__file__).resolve().parent.parent.parent / "open-trading-api" / "examples_llm"
sys.path.insert(0, str(KIS_SDK_PATH))

ROOT = Path(__file__).resolve().parent.parent.parent

# kis_auth 로드 (KIS SDK)
try:
    import kis_auth as ka
except ImportError as e:
    print(f"kis_auth 로드 실패: {e}", file=sys.stderr)
    print(f"  경로 확인: {KIS_SDK_PATH}", file=sys.stderr)
    print(
        "  의존성 설치 예시: .venv/bin/python -m pip install pandas pyyaml pycryptodome requests websockets",
        file=sys.stderr,
    )
    sys.exit(1)

# API 엔드포인트
ETF_PRICE_URL = "/uapi/etfetn/v1/quotations/inquire-price"
ETF_PRICE_TR_ID = "FHPST02400000"

# Fallback: 국내주식 등락률 API (ETF 브랜딩 종목만 heuristic 필터)
FLUCTUATION_URL = "/uapi/domestic-stock/v1/ranking/fluctuation"
FLUCTUATION_TR_ID = "FHPST01700000"
ETF_BRAND_PATTERN = re.compile(
    r"(KODEX|TIGER|KOSEF|HANARO|ARIRANG|ACE|SOL|PLUS|KBSTAR|TIMEFOLIO|RISE|TRUSTON|ETF|ETN)",
    re.IGNORECASE,
)

NAVER_ETF_LIST_URL = "https://finance.naver.com/api/sise/etfItemList.nhn"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="KIS ETF 등락률 순위 수집")
    parser.add_argument("--date", default=None, help="수집 기준일 (YYYY-MM-DD), 기본: 오늘")
    parser.add_argument(
        "--output", default=None,
        help="출력 경로. 기본: data/external/kis-etf/{date}/etf-ranking.json"
    )
    parser.add_argument("--top-n", type=int, default=80, help="수집할 ETF 수 (기본 80)")
    parser.add_argument(
        "--scan-multiplier",
        type=int,
        default=3,
        help="유니버스 스캔 배수 (기본 3, top-n*배수 만큼 KIS 조회)",
    )
    return parser.parse_args()


def safe_float(value, default=0.0) -> float:
    try:
        return round(float(str(value).replace(",", "").strip()), 4)
    except (ValueError, TypeError):
        return default


def safe_int(value, default=0) -> int:
    try:
        return int(float(str(value).replace(",", "").strip()))
    except (ValueError, TypeError):
        return default


def fetch_naver_etf_universe(max_count: int) -> list[dict]:
    """네이버 ETF 목록 API에서 ETF 코드/이름/거래량 유니버스를 가져온다."""
    req = urllib.request.Request(
        NAVER_ETF_LIST_URL,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json, text/plain, */*",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read()

    decoded = None
    for encoding in ("cp949", "euc-kr", "utf-8"):
        try:
            decoded = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue

    if decoded is None:
        raise RuntimeError("네이버 ETF 목록 디코딩 실패")

    payload = json.loads(decoded)
    etf_items = payload.get("result", {}).get("etfItemList", [])

    universe = []
    for item in etf_items:
        code = str(item.get("itemcode", "")).strip().zfill(6)
        name = str(item.get("itemname", "")).strip()
        if not re.fullmatch(r"\d{6}", code) or not name:
            continue

        universe.append({
            "code": code,
            "name": name,
            "volumeHint": safe_int(item.get("quant"), 0),
            "amountHint": safe_int(item.get("amonut"), 0),
            "marketSumHint": safe_int(item.get("marketSum"), 0),
            "changePctHint": safe_float(item.get("changeRate"), 0.0),
        })

    # 유동성/시총 힌트를 우선해 상위부터 스캔
    universe.sort(
        key=lambda row: (row["volumeHint"], row["amountHint"], row["marketSumHint"]),
        reverse=True,
    )
    return universe[:max_count]


def fetch_single_etf_quote(code: str, name_hint: str) -> dict | None:
    """ETF/ETN 현재가(KIS) 1종목 조회."""
    params = {
        "FID_COND_MRKT_DIV_CODE": "J",  # KRX
        "FID_INPUT_ISCD": code,
    }
    res = ka._url_fetch(ETF_PRICE_URL, ETF_PRICE_TR_ID, "", params)

    if not res.isOK():
        return None

    body = res.getBody()
    row = getattr(body, "output", {}) or {}
    if not isinstance(row, dict):
        row = row.__dict__ if hasattr(row, "__dict__") else {}

    return {
        "code": code,
        "name": name_hint,
        "price": safe_float(row.get("stck_prpr")),
        "changePct": safe_float(row.get("prdy_ctrt")),
        "changeAmt": safe_float(row.get("prdy_vrss")),
        "volume": safe_float(row.get("acml_vol")),
        "highPrice": safe_float(row.get("stck_hgpr")),
        "lowPrice": safe_float(row.get("stck_lwpr")),
        "nav": safe_float(row.get("nav")),
        "navChangePct": safe_float(row.get("nav_prdy_ctrt")),
        "periodChangePct": safe_float(row.get("prdy_ctrt")),
    }


def fetch_etf_ranking(top_n: int = 80, scan_multiplier: int = 3) -> list[dict]:
    """ETF 유니버스를 기준으로 KIS ETF 현재가를 조회해 등락률 순위를 만든다."""
    scan_size = max(top_n * max(scan_multiplier, 1), top_n)
    universe = fetch_naver_etf_universe(scan_size)
    if not universe:
        raise RuntimeError("ETF 유니버스를 가져오지 못했습니다.")

    rows: list[dict] = []
    for idx, item in enumerate(universe, start=1):
        quote = fetch_single_etf_quote(item["code"], item["name"])
        if quote:
            rows.append(quote)

        # KIS 호출이 연속으로 몰릴 때를 대비한 여유
        if idx < len(universe):
            time.sleep(0.03)

    if not rows:
        raise RuntimeError("KIS ETF 현재가 조회 결과가 비어 있습니다.")

    # 당일 등락률 순 정렬
    rows.sort(key=lambda row: row.get("changePct", 0), reverse=True)
    ranked = rows[:top_n]
    for rank, row in enumerate(ranked, start=1):
        row["rank"] = rank
    return ranked


def fetch_fallback_from_fluctuation(top_n: int = 80) -> list[dict]:
    """Fallback: 국내주식 등락률 API 결과에서 ETF/ETN 이름 패턴만 필터링."""
    params = {
        "fid_cond_mrkt_div_code": "J",
        "fid_cond_scr_div_code": "20170",
        "fid_input_iscd": "0000",
        "fid_rank_sort_cls_code": "0",
        "fid_input_cnt_1": str(max(top_n * 3, 100)),
        "fid_prc_cls_code": "0",
        "fid_input_price_1": "",
        "fid_input_price_2": "",
        "fid_vol_cnt": "",
        "fid_trgt_cls_code": "0",
        "fid_trgt_exls_cls_code": "0",
        "fid_div_cls_code": "0",
        "fid_rsfl_rate1": "",
        "fid_rsfl_rate2": "",
    }

    res = ka._url_fetch(FLUCTUATION_URL, FLUCTUATION_TR_ID, "", params)
    if not res.isOK():
        raise RuntimeError(f"fallback API 호출 실패: {res.getErrorCode()} {res.getErrorMessage()}")

    body = res.getBody()
    output = getattr(body, "output", []) or []

    rows: list[dict] = []
    for item in output:
        row = item if isinstance(item, dict) else (item.__dict__ if hasattr(item, "__dict__") else {})
        code = str(row.get("stck_shrn_iscd", "")).strip().zfill(6)
        name = str(row.get("hts_kor_isnm", "")).strip()
        if not code or not name:
            continue
        if not ETF_BRAND_PATTERN.search(name):
            continue

        rows.append({
            "code": code,
            "name": name,
            "price": safe_float(row.get("stck_prpr")),
            "changePct": safe_float(row.get("prdy_ctrt")),
            "changeAmt": safe_float(row.get("prdy_vrss")),
            "volume": safe_float(row.get("acml_vol")),
            "highPrice": safe_float(row.get("stck_hgpr")),
            "lowPrice": safe_float(row.get("stck_lwpr")),
            "periodChangePct": safe_float(row.get("prd_rsfl_rate")),
        })

    rows.sort(key=lambda row: row.get("changePct", 0), reverse=True)
    rows = rows[:top_n]
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    return rows


def tag_themes(etf_list: list[dict], etf_map_path: Path) -> list[dict]:
    """stockeasy-theme-etf-map.json 기반으로 테마/섹터 태그 추가."""
    if not etf_map_path.exists():
        return etf_list

    etf_map = json.loads(etf_map_path.read_text(encoding="utf-8"))
    map_by_code = {str(e["code"]).zfill(6): e for e in (etf_map.get("etfs") or []) if e.get("code")}

    for etf in etf_list:
        mapped = map_by_code.get(str(etf.get("code", "")).zfill(6))
        if mapped:
            etf["sectors"] = mapped.get("sectors", [])
            etf["keywords"] = mapped.get("keywords", [])
            etf["rationale"] = mapped.get("rationale", "")
        else:
            etf["sectors"] = []
            etf["keywords"] = []
            etf["rationale"] = ""

    return etf_list


def main() -> None:
    args = parse_args()
    date = args.date or datetime.now().strftime("%Y-%m-%d")
    output_path = (
        Path(args.output)
        if args.output
        else ROOT / "data" / "external" / "kis-etf" / date / "etf-ranking.json"
    )

    # KIS 인증
    print("[kis-etf] KIS 인증 중...", flush=True)
    try:
        # kis_auth.auth()는 기본 경로(~/.KIS/config/kis_devlp.yaml)를 사용한다.
        ka.auth(svr="prod", product="01")
    except Exception as e:
        print(f"[kis-etf] 인증 실패: {e}", file=sys.stderr)
        sys.exit(1)

    print(
        f"[kis-etf] ETF 현재가 조회 기반 랭킹 생성 (top {args.top_n}, scan x{args.scan_multiplier})...",
        flush=True,
    )
    try:
        etf_list = fetch_etf_ranking(top_n=args.top_n, scan_multiplier=args.scan_multiplier)
        source_mode = "kis_etfetn_quote"
    except Exception as e:
        print(f"[kis-etf] 주 경로 실패, fallback 시도: {e}", file=sys.stderr)
        etf_list = fetch_fallback_from_fluctuation(top_n=args.top_n)
        source_mode = "kis_fluctuation_fallback"

    print(f"[kis-etf] {len(etf_list)}개 ETF 수집 완료", flush=True)

    # 테마 태그 추가
    etf_map_path = ROOT / "data" / "reference" / "stockeasy-theme-etf-map.json"
    etf_list = tag_themes(etf_list, etf_map_path)

    payload = {
        "source": "kis",
        "collectionMode": source_mode,
        "date": date,
        "capturedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "topN": args.top_n,
        "scanMultiplier": args.scan_multiplier,
        "etfs": etf_list,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(output_path)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"KIS ETF 수집 실패: {exc}", file=sys.stderr)
        sys.exit(1)
