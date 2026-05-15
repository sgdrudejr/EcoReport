#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

import pandas as pd


ROOT_DIR = Path(__file__).resolve().parents[1]
OPEN_API_ROOT = ROOT_DIR / "open-trading-api"
DOMESTIC_STOCK_DIR = OPEN_API_ROOT / "examples_user" / "domestic_stock"
sys.path.extend([str(DOMESTIC_STOCK_DIR), str(OPEN_API_ROOT / "examples_user")])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Append KIS orderable cash fields to a raw account snapshot."
    )
    parser.add_argument("--env", choices=["real", "demo"], default="real")
    parser.add_argument("--json-path", required=True)
    return parser.parse_args()


def choose_auth_server(env: str) -> str:
    return "prod" if env == "real" else "vps"


def normalize_scalar(value):
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            return value
    return value


def dataframe_to_records(df: pd.DataFrame) -> list[dict]:
    if df.empty:
        return []
    return [
        {key: normalize_scalar(value) for key, value in row.items()}
        for row in df.to_dict(orient="records")
    ]


def choose_orderable_reference(snapshot: dict) -> tuple[str, str]:
    for row in snapshot.get("balance", {}).get("rows", []):
        pdno = str(row.get("pdno", "")).strip()
        price = row.get("prpr")
        if pdno.isdigit() and len(pdno) == 6 and price not in (None, "", 0, "0"):
            return pdno, str(int(float(str(price).replace(",", ""))))
    return "069500", "1"


def is_pension_account(acnt_prdt_cd: str) -> bool:
    return acnt_prdt_cd in {"22", "29", "55"}


def main() -> None:
    args = parse_args()
    json_path = Path(args.json_path)
    snapshot = json.loads(json_path.read_text(encoding="utf-8"))
    account = snapshot.get("account", {})
    cano = str(account.get("cano", "")).strip()
    acnt_prdt_cd = str(account.get("acnt_prdt_cd", "")).strip()
    if not cano or not acnt_prdt_cd:
        raise SystemExit(f"Missing account identifiers in {json_path}")

    import kis_auth as ka
    from domestic_stock_functions import inquire_psbl_order, pension_inquire_psbl_order

    ka.auth(svr=choose_auth_server(args.env))
    pdno, ord_unpr = choose_orderable_reference(snapshot)
    orderable_error = None
    orderable_rows = pd.DataFrame()

    try:
        if is_pension_account(acnt_prdt_cd):
            orderable_rows = pension_inquire_psbl_order(
                cano=cano,
                acnt_prdt_cd=acnt_prdt_cd,
                pdno=pdno,
                acca_dvsn_cd="00",
                cma_evlu_amt_icld_yn="N",
                ord_unpr=ord_unpr,
                ord_dvsn="01",
            )
        else:
            orderable_rows = inquire_psbl_order(
                env_dv=args.env,
                cano=cano,
                acnt_prdt_cd=acnt_prdt_cd,
                pdno=pdno,
                ord_unpr=ord_unpr,
                ord_dvsn="01",
                cma_evlu_amt_icld_yn="N",
                ovrs_icld_yn="N",
            )
    except Exception as exc:
        orderable_error = str(exc)

    snapshot["orderable_query"] = {
        "pdno": pdno,
        "ord_unpr": ord_unpr,
        "ord_dvsn": "01",
        "cma_evlu_amt_icld_yn": "N",
        "ovrs_icld_yn": "N",
        "acca_dvsn_cd": "00" if is_pension_account(acnt_prdt_cd) else None,
    }
    records = dataframe_to_records(orderable_rows)
    snapshot["orderable"] = {
        "rows": records,
        "summary": records,
        "error": orderable_error,
    }
    json_path.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
