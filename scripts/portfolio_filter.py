#!/usr/bin/env python3
"""
Relevant Chunking: 브리핑 키워드 기반으로 포트폴리오에서
관련 종목 데이터만 추출해 컨텍스트 크기를 줄입니다.

수식: 전체 포트폴리오 집합 P에서 브리핑 핵심 키워드 K와
     유사도가 높은 부분집합 P' ⊆ P 만 반환.

사용법:
    from portfolio_filter import filter_portfolio

    filtered_md = filter_portfolio(
        portfolio_md=open("data/portfolio/rag/.../merged-portfolio.md").read(),
        briefing_md=open("knowledge/daily/2026-04-15-briefing.md").read(),
        top_k=8,
    )
"""
from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import Any


# ── 불용어 ────────────────────────────────────────────────────────────────────
_STOPWORDS_KO = {
    "의", "이", "가", "을", "를", "은", "는", "에", "와", "과", "도", "로", "으로",
    "에서", "부터", "까지", "이다", "있다", "없다", "하다", "되다", "것", "수",
    "및", "또는", "그리고", "하지만", "그러나", "따라서", "즉", "현재", "기준",
    "전일", "전월", "전년", "대비", "이상", "이하", "미만", "초과", "정도",
}

_STOPWORDS_EN = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    "this", "that", "it", "its", "as", "has", "have", "had", "not", "no",
}


# ── 키워드 추출 ───────────────────────────────────────────────────────────────
def extract_keywords(text: str, top_n: int = 40) -> set[str]:
    """브리핑 텍스트에서 핵심 키워드를 추출합니다."""
    keywords: set[str] = set()

    # 1) 종목코드 패턴 (6자리 숫자, ETF 코드)
    codes = re.findall(r"\b\d{6}\b", text)
    keywords.update(codes)

    # 2) 영어 종목/브랜드명 (3자 이상 대문자 시작 또는 전체 대문자)
    en_terms = re.findall(r"\b[A-Z][A-Za-z]{2,}\b|\b[A-Z]{2,}\b", text)
    keywords.update(t for t in en_terms if t.lower() not in _STOPWORDS_EN and len(t) >= 3)

    # 3) 한국어 명사구 (2~6자 한글 연속)
    ko_words = re.findall(r"[가-힣]{2,6}", text)
    freq = Counter(ko_words)
    # 빈도 2 이상이고 불용어 아닌 것
    keywords.update(w for w, c in freq.most_common(top_n) if c >= 2 and w not in _STOPWORDS_KO)

    # 4) 섹터/테마 키워드 고정 목록
    sector_keywords = {
        "반도체", "AI", "방산", "원자력", "전력", "배터리", "이차전지",
        "변압기", "전력기기", "사이버보안", "인프라", "바이오", "제약",
        "금융", "은행", "보험", "증권", "ETF", "HBM", "MLCC", "FC-BGA",
        "나스닥", "S&P500", "국채", "금리", "환율", "유가", "구리",
        "방어주", "성장주", "배당", "커버드콜", "인덱스",
    }
    # 브리핑에 실제로 등장하는 섹터 키워드만 추가
    keywords.update(kw for kw in sector_keywords if kw.lower() in text.lower())

    return keywords


# ── 청크 파싱 ─────────────────────────────────────────────────────────────────
def _parse_portfolio_chunks(portfolio_md: str) -> list[dict[str, Any]]:
    """merged-portfolio.md를 ## 단위로 청크 분리합니다."""
    chunks = []
    sections = re.split(r"\n## ", portfolio_md)
    for i, section in enumerate(sections):
        if i == 0:
            # 파일 헤더
            chunks.append({"type": "header", "text": section, "score": 999})
            continue
        lines = section.strip().split("\n")
        title = lines[0].strip()
        body = "\n".join(lines[1:]).strip()

        chunk_type = "other"
        if "portfolio_overview" in body or "포트폴리오 전체" in title:
            chunk_type = "overview"
        elif "account_summary" in body or "계좌 요약" in title:
            chunk_type = "account_summary"
        elif "account_target" in body or "목표 배분" in title:
            chunk_type = "account_target"
        elif "holding_detail" in body or "·" in title:
            chunk_type = "holding"

        chunks.append({
            "type": chunk_type,
            "title": title,
            "text": body,
            "full": f"## {section}",
            "score": 0,
        })
    return chunks


# ── 유사도 점수 계산 ──────────────────────────────────────────────────────────
def _score_chunk(chunk: dict[str, Any], keywords: set[str]) -> int:
    """키워드 매칭 기반 유사도 점수."""
    if chunk["type"] in ("header", "overview", "account_summary", "account_target"):
        return 999  # 항상 포함

    combined = (chunk.get("title", "") + " " + chunk.get("text", "")).lower()
    score = 0
    for kw in keywords:
        if kw.lower() in combined:
            score += 1
    # 종목코드 직접 매칭은 가중치 높게
    codes = re.findall(r"\b\d{6}\b", combined)
    for code in codes:
        if code in keywords:
            score += 3
    return score


# ── 메인 필터 함수 ─────────────────────────────────────────────────────────────
def filter_portfolio(
    portfolio_md: str,
    briefing_md: str,
    top_k: int = 8,
    min_score: int = 1,
) -> tuple[str, dict[str, Any]]:
    """
    브리핑 키워드 기반으로 관련 포트폴리오 청크만 추출합니다.

    Returns:
        (filtered_md, meta) — 필터링된 마크다운과 메타데이터
    """
    keywords = extract_keywords(briefing_md)
    chunks = _parse_portfolio_chunks(portfolio_md)

    # 점수 계산
    holding_chunks = []
    always_include = []
    for chunk in chunks:
        score = _score_chunk(chunk, keywords)
        chunk["score"] = score
        if chunk["type"] in ("header", "overview", "account_summary", "account_target"):
            always_include.append(chunk)
        else:
            holding_chunks.append(chunk)

    # holding 청크를 점수 순으로 정렬, top_k 선택
    holding_chunks.sort(key=lambda c: c["score"], reverse=True)
    selected_holdings = [c for c in holding_chunks if c["score"] >= min_score][:top_k]
    excluded_holdings = [c for c in holding_chunks if c not in selected_holdings]

    # 출력 조합
    output_parts = []
    for chunk in always_include:
        output_parts.append(chunk.get("full") or chunk.get("text", ""))

    if selected_holdings:
        output_parts.append("\n\n---\n## 브리핑 관련 보유 종목 (필터링됨)\n")
        for chunk in selected_holdings:
            output_parts.append(chunk["full"])

    if excluded_holdings:
        excluded_names = [c.get("title", "?") for c in excluded_holdings]
        output_parts.append(
            f"\n\n> **컨텍스트 절감**: 관련도 낮은 {len(excluded_holdings)}개 종목 제외 "
            f"({', '.join(excluded_names[:5])}{'...' if len(excluded_names) > 5 else ''})"
        )

    filtered_md = "\n".join(output_parts)

    meta = {
        "total_holdings": len(holding_chunks),
        "selected_holdings": len(selected_holdings),
        "excluded_holdings": len(excluded_holdings),
        "keywords_used": sorted(keywords),
        "original_chars": len(portfolio_md),
        "filtered_chars": len(filtered_md),
        "reduction_pct": round((1 - len(filtered_md) / max(len(portfolio_md), 1)) * 100, 1),
    }

    return filtered_md, meta


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse, json

    parser = argparse.ArgumentParser(description="포트폴리오 관련 청크 필터링")
    parser.add_argument("--portfolio", required=True, help="merged-portfolio.md 경로")
    parser.add_argument("--briefing", required=True, help="briefing.md 경로")
    parser.add_argument("--output", required=True, help="출력 파일 경로")
    parser.add_argument("--top-k", type=int, default=8, help="최대 holding 청크 수 (기본 8)")
    parser.add_argument("--min-score", type=int, default=1, help="최소 유사도 점수")
    args = parser.parse_args()

    portfolio_md = Path(args.portfolio).read_text(encoding="utf-8")
    briefing_md = Path(args.briefing).read_text(encoding="utf-8")

    filtered_md, meta = filter_portfolio(
        portfolio_md=portfolio_md,
        briefing_md=briefing_md,
        top_k=args.top_k,
        min_score=args.min_score,
    )

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(filtered_md, encoding="utf-8")

    meta_path = out.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✅ 필터링 완료: {out}")
    print(f"   전체 보유종목: {meta['total_holdings']}개")
    print(f"   선택된 종목:   {meta['selected_holdings']}개")
    print(f"   컨텍스트 절감: {meta['reduction_pct']}% ({meta['original_chars']:,} → {meta['filtered_chars']:,} chars)")
    print(f"   핵심 키워드:   {', '.join(list(meta['keywords_used'])[:10])}...")
