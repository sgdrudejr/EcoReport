#!/usr/bin/env python3
"""
StockEasy 원시 JSON → stockeasy-context.md 변환 스크립트
사용법: python3 scripts/stockeasy_normalizer.py --date 2026-04-17
"""
import json
import argparse
from pathlib import Path
from datetime import date as dt_date

ROOT = Path(__file__).parent.parent


def load_json(path: Path):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def fmt_sector(data) -> str:
    if not data:
        return ""
    tables = data.get("tables", [])
    if not tables:
        return ""
    table = tables[0]
    headers = table.get("headers", [])
    rows = table.get("rows", [])
    lines = ["## 섹터 신호등 / 등락률 / 이격률\n"]
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
    for row in rows:
        cells = []
        for cell in row:
            if isinstance(cell, list):
                cells.append(" / ".join(str(c) for c in cell))
            else:
                cells.append(str(cell).replace("\n", " ").strip())
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def fmt_briefing(data) -> str:
    if not data:
        return ""
    # tab_contents에서 default 탭 찾기
    tab_contents = data.get("tab_contents", [])
    briefing_text = ""
    for tab in tab_contents:
        if tab.get("tab") == "default" or not briefing_text:
            briefing_text = tab.get("text", "")
    if not briefing_text:
        briefing_text = data.get("raw_text", "")

    # 날짜 이후 본문만 추출 (앞의 네비게이션 제거)
    import re
    # "FINANCIAL INTELLIGENCE" 이후 부분 추출
    match = re.search(r"FINANCIAL INTELLIGENCE\s*\n(.+)", briefing_text, re.DOTALL)
    if match:
        briefing_text = match.group(1).strip()
    # 너무 길면 자르기
    if len(briefing_text) > 3000:
        briefing_text = briefing_text[:3000] + "\n...(생략)"

    return f"## 오늘의 브리핑\n\n{briefing_text}"


def fmt_rs(data) -> str:
    if not data:
        return ""
    tables = data.get("tables", [])
    if not tables:
        return ""
    table = tables[0]
    headers = table.get("headers", [])
    rows = table.get("rows", [])[:30]
    lines = ["## RS 강도 상위 종목\n"]
    # 핵심 컬럼만 추출 (섹터, 종목명, RS)
    key_cols = []
    for i, h in enumerate(headers):
        if h in ["섹터", "종목명", "RS", "RS(1M)", "RS(3M)", "현재가", "등락률"]:
            key_cols.append((i, h))
    if not key_cols:
        key_cols = [(i, h) for i, h in enumerate(headers)]
    lines.append("| " + " | ".join(h for _, h in key_cols) + " |")
    lines.append("| " + " | ".join(["---"] * len(key_cols)) + " |")
    for row in rows:
        cells = []
        for i, _ in key_cols:
            if i < len(row):
                cell = row[i]
                if isinstance(cell, list):
                    cells.append(" / ".join(str(c) for c in cell))
                else:
                    cells.append(str(cell).replace("\n", " ").strip())
            else:
                cells.append("")
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def fmt_industry_report(data) -> str:
    if not data:
        return ""
    tables = data.get("tables", [])
    if not tables:
        return "## 산업리포트\n\n> 데이터 없음"
    lines = ["## 산업리포트 섹터별 요약\n"]
    # 섹터별 그룹핑
    sector_map: dict[str, list] = {}
    for table in tables:
        rows = table.get("rows", [])
        headers = table.get("headers", [])
        # 컬럼 인덱스 찾기
        idx_sector = next((i for i, h in enumerate(headers) if "섹터" in h or "분류" in h), None)
        idx_title = next((i for i, h in enumerate(headers) if "제목" in h or "리포트" in h or "title" in h.lower()), None)
        idx_firm = next((i for i, h in enumerate(headers) if "증권" in h or "기관" in h or "firm" in h.lower()), None)
        if idx_title is None and len(headers) > 1:
            idx_title = 1
        for row in rows:
            sector = str(row[idx_sector]).strip() if idx_sector is not None and idx_sector < len(row) else "기타"
            title = str(row[idx_title]).strip() if idx_title is not None and idx_title < len(row) else ""
            firm = str(row[idx_firm]).strip() if idx_firm is not None and idx_firm < len(row) else ""
            entry = f"- [{firm}] {title}" if firm else f"- {title}"
            sector_map.setdefault(sector, []).append(entry)
    for sector, reports in list(sector_map.items())[:20]:
        lines.append(f"### {sector}")
        lines.extend(reports[:10])
        lines.append("")
    total = sum(len(v) for v in sector_map.values())
    lines.append(f"> 총 {total}건 수집")
    return "\n".join(lines)


def fmt_strategy_room(label: str, data) -> str:
    if not data:
        return ""
    lines = [f"### {label}"]
    holdings = data.get("holdings", [])
    exits = data.get("exits", [])
    new_entries = data.get("new_entries", [])

    if new_entries:
        lines.append("**신규 편입**")
        for item in new_entries:
            name = item.get("종목명", "")
            sector = item.get("섹터", "").replace("\n", " ")
            if name:
                lines.append(f"- {name} ({sector})")

    if holdings:
        lines.append("**보유**")
        for item in holdings[:30]:
            name = item.get("종목명", "")
            sector = item.get("섹터", "").replace("\n", " ")
            returns = item.get("수익률", "")
            if name:
                lines.append(f"- {name} ({sector}) {returns}")

    real_exits = [e for e in exits if e.get("종목명", "").strip()]
    if real_exits:
        lines.append("**이탈**")
        for item in real_exits:
            name = item.get("종목명", "")
            returns = item.get("수익률", "")
            if name:
                lines.append(f"- {name} {returns}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=str(dt_date.today()))
    args = parser.parse_args()
    date = args.date

    base = ROOT / "data" / "stockeasy" / date
    out_path = base / "stockeasy-context.md"

    sector = load_json(base / "sector.json")
    briefing = load_json(base / "briefing.json")
    rs = load_json(base / "rs.json")
    industry_report = load_json(base / "industry_report.json")
    momentum = load_json(base / "momentum.json")
    peak = load_json(base / "peak.json")
    value = load_json(base / "value.json")

    sections = [f"# StockEasy 시장 데이터 ({date})\n"]

    s = fmt_sector(sector)
    if s:
        sections.append(s)

    b = fmt_briefing(briefing)
    if b:
        sections.append(b)

    r = fmt_rs(rs)
    if r:
        sections.append(r)

    ir = fmt_industry_report(industry_report)
    if ir:
        sections.append(ir)

    strat_lines = ["## 전략실 종목\n"]
    strat_lines.append(fmt_strategy_room("모멘텀", momentum))
    strat_lines.append(fmt_strategy_room("피크", peak))
    strat_lines.append(fmt_strategy_room("밸류", value))
    sections.append("\n\n".join(strat_lines))

    content = "\n\n".join(sections)
    out_path.write_text(content, encoding="utf-8")
    print(f"✅ stockeasy-context.md 생성: {out_path} ({len(content):,}자)")


if __name__ == "__main__":
    main()
