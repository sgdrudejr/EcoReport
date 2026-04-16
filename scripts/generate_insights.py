#!/usr/bin/env python3
"""
인사이트 도출 스크립트: 딥리서치 결과 + 필터링된 포트폴리오 →
계좌별 운영 방안 + 추천 종목 → 검증 루프 → 물결표 정규화 → 저장.

파이프라인 3단계 (qwen3.5-flash):
  ① 브리핑 (generate_briefing.py)
  ② [Gemini 웹 딥리서치 - 수동]
  ③ 인사이트 도출 (이 스크립트) ← portfolio_filter.py 자동 호출

사용법:
    python3 scripts/generate_insights.py \
      --deepresearch knowledge/daily/2026-04-16-deepresearch.md \
      --portfolio data/portfolio/rag/latest/merged-portfolio.md \
      --briefing knowledge/daily/2026-04-16-briefing.md \
      --output knowledge/daily/2026-04-16-insights.md \
      --date 2026-04-16
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

from lib.env_loader import load_simple_dotenv

# ── 상수 ─────────────────────────────────────────────────────────────────────

QWEN_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
QWEN_DEFAULT_MODEL = "qwen3.5-flash"

# 물결표 유니코드 변형 → 일반 ~
_TILDE_VARIANTS = re.compile(
    r"[～∼〜﹋﹌＠̃\u223c\u007e\ufe4f\u02dc]",  # noqa: RUF001
    flags=re.UNICODE,
)

INSIGHTS_PROMPT = """\
당신은 포트폴리오 전략 애널리스트입니다.
아래 [딥리서치 결과]와 [현재 포트폴리오]를 바탕으로 다음을 작성하세요.

## 출력 형식 (마크다운)

### 1. 시장 핵심 요약 (3~5줄)
### 2. 계좌별 운영 방안
각 계좌(ISA / 연금저축 / 토스증권 / 한투 일반)에 대해:
- 현재 상태 한 줄 요약
- 권장 액션 (매수/매도/비중 조정 + 금액 또는 비중 명시)
- 이유 (딥리서치 근거 인용)
### 3. 신규 편입 추천 종목 (최대 5개, 현재 포트폴리오에 없는 종목)
| 종목명(코드) | 추천계좌 | 이유 | 리스크 |
### 4. 리스크 점검
- 최대 3가지 주요 리스크 + 대응 방향
### 5. 다음 확인 일정
- 향후 1~2주 내 주목할 이벤트/지표

규칙:
- 금액은 원화(원) 기준으로 명시
- 불확실한 수치는 추정임을 표기
- 현재 보유 종목은 [현재 포트폴리오]의 데이터를 우선 참조
"""

VALIDATION_PROMPT = """\
당신은 리스크 검토 담당자입니다.
아래 [인사이트 초안]을 읽고, 다음 기준을 체크하세요.

## 검토 기준
1. 단일 계좌에서 한 종목이 가용 현금의 70%를 초과하는 매수를 권장하는가?
2. 레버리지·인버스 ETF를 연금저축 계좌에 편입 권장하는가?
3. 리스크 언급 없이 고변동성 소형주 비중을 20% 이상 추천하는가?
4. 환율·금리 방향에 대한 단정적 예측이 포함되어 있는가?
5. 포트폴리오 목표 배분(계좌별 섹터 비중 목표)을 심각하게 이탈하는 안을 권장하는가?

## 출력 형식 (JSON만 반환, 마크다운 없음)
{
  "pass": true | false,
  "issues": ["위반 사항 설명 (없으면 빈 배열)"],
  "suggestions": ["개선 제안 (없으면 빈 배열)"]
}
"""


# ── 유틸 ─────────────────────────────────────────────────────────────────────

def normalize_tilde(text: str) -> str:
    """물결표 유니코드 변형을 모두 표준 ~로 치환합니다."""
    return _TILDE_VARIANTS.sub("~", text)


def load_api_key(project_root: Path) -> str:
    env_path = project_root / ".env"
    if env_path.exists():
        load_simple_dotenv(env_path)
    api_key = os.getenv("QWEN_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError(".env 또는 환경변수에 QWEN_API_KEY가 없습니다.")
    return api_key


def call_qwen(api_key: str, model: str, prompt: str, max_tokens: int = 4096) -> str:
    """Qwen API 단순 호출 (OpenAI-compat)."""
    from openai import OpenAI

    client = OpenAI(api_key=api_key, base_url=QWEN_BASE_URL)
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
    )
    return resp.choices[0].message.content.strip()


# ── 포트폴리오 필터 ───────────────────────────────────────────────────────────

def filter_portfolio(portfolio_md: str, briefing_md: str, top_k: int, min_score: int) -> tuple[str, dict[str, Any]]:
    """portfolio_filter 모듈을 임포트해 필터링. 없으면 원본 반환."""
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        from portfolio_filter import filter_portfolio as _filter
        return _filter(portfolio_md, briefing_md, top_k=top_k, min_score=min_score)
    except ImportError:
        print("⚠️  portfolio_filter 모듈 없음 — 포트폴리오 필터링 생략", file=sys.stderr)
        return portfolio_md, {"reduction_pct": 0, "note": "filter skipped"}


# ── 검증 루프 ─────────────────────────────────────────────────────────────────

def validate_insights(api_key: str, model: str, insights_md: str) -> dict[str, Any]:
    """인사이트 초안을 리스크 기준으로 검증. JSON 결과 반환."""
    prompt = f"{VALIDATION_PROMPT}\n\n[인사이트 초안]\n{insights_md}"
    raw = call_qwen(api_key, model, prompt, max_tokens=1024)

    # JSON 블록만 추출
    json_match = re.search(r"\{[\s\S]*\}", raw)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass
    return {"pass": True, "issues": [], "suggestions": [], "raw": raw}


# ── 메인 ─────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="딥리서치 + 포트폴리오 → 인사이트 도출")
    parser.add_argument("--deepresearch", required=True, help="딥리서치 결과 .md 경로")
    parser.add_argument("--portfolio", required=True, help="merged-portfolio.md 경로")
    parser.add_argument("--briefing", default=None, help="브리핑 .md 경로 (포트폴리오 필터링 키워드 추출용)")
    parser.add_argument("--output", required=True, help="출력 insights.md 경로")
    parser.add_argument("--date", default=None, help="기준 날짜 (YYYY-MM-DD, 메타데이터용)")
    parser.add_argument("--model", default=QWEN_DEFAULT_MODEL, help="Qwen 모델명")
    parser.add_argument("--max-tokens", type=int, default=4096, help="인사이트 생성 최대 토큰")
    parser.add_argument("--top-k", type=int, default=8, help="포트폴리오 필터 top-k 보유종목")
    parser.add_argument("--min-score", type=int, default=1, help="포트폴리오 필터 최소 점수")
    parser.add_argument("--skip-validation", action="store_true", help="검증 루프 건너뜀")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project_root = Path(__file__).parent.parent
    api_key = load_api_key(project_root)

    run_date = args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # ── 파일 로드 ───────────────────────────────────────────────────────────
    deepresearch_md = Path(args.deepresearch).read_text(encoding="utf-8")
    portfolio_md_raw = Path(args.portfolio).read_text(encoding="utf-8")

    # 브리핑이 있으면 포트폴리오 필터링, 없으면 원본 사용
    if args.briefing and Path(args.briefing).exists():
        briefing_md = Path(args.briefing).read_text(encoding="utf-8")
        print("🔗 포트폴리오 필터링 중...")
        portfolio_md, filter_meta = filter_portfolio(
            portfolio_md_raw, briefing_md, top_k=args.top_k, min_score=args.min_score
        )
        print(
            f"   전체 보유종목: {filter_meta.get('total_holdings', '?')}개 → "
            f"선택: {filter_meta.get('selected_holdings', '?')}개 "
            f"(컨텍스트 {filter_meta.get('reduction_pct', 0):.1f}% 절감)"
        )
    else:
        portfolio_md = portfolio_md_raw
        filter_meta = {"reduction_pct": 0, "note": "no briefing provided"}
        print("ℹ️  브리핑 미제공 — 포트폴리오 필터링 생략")

    # ── 인사이트 생성 ────────────────────────────────────────────────────────
    full_prompt = (
        f"{INSIGHTS_PROMPT}\n\n"
        f"[딥리서치 결과]\n{deepresearch_md}\n\n"
        f"[현재 포트폴리오]\n{portfolio_md}"
    )

    print(f"🤖 인사이트 생성 중... (모델: {args.model})")
    insights_raw = call_qwen(api_key, args.model, full_prompt, max_tokens=args.max_tokens)
    insights_md = normalize_tilde(insights_raw)
    print("   ✅ 인사이트 생성 완료")

    # ── 검증 루프 ────────────────────────────────────────────────────────────
    validation_result: dict[str, Any] = {}
    if not args.skip_validation:
        print("🔍 리스크 검증 중...")
        validation_result = validate_insights(api_key, args.model, insights_md)
        passed = validation_result.get("pass", True)
        issues = validation_result.get("issues", [])
        suggestions = validation_result.get("suggestions", [])

        if passed:
            print("   ✅ 검증 통과")
        else:
            print(f"   ⚠️  검증 이슈 {len(issues)}건 발견:")
            for issue in issues:
                print(f"      - {issue}")

        # 검증 코멘트를 인사이트 말미에 추가
        if issues or suggestions:
            notes = "\n\n---\n## ⚠️ 검증 노트\n"
            for iss in issues:
                notes += f"- **이슈**: {iss}\n"
            for sug in suggestions:
                notes += f"- **제안**: {sug}\n"
            insights_md += normalize_tilde(notes)
    else:
        print("ℹ️  --skip-validation 플래그 — 검증 건너뜀")

    # ── 헤더 추가 ────────────────────────────────────────────────────────────
    header = (
        f"# 포트폴리오 인사이트 — {run_date}\n\n"
        f"> 모델: `{args.model}` | 생성: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}\n\n"
    )
    final_md = normalize_tilde(header + insights_md)

    # ── 저장 ────────────────────────────────────────────────────────────────
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(final_md, encoding="utf-8")

    meta = {
        "run_date": run_date,
        "model": args.model,
        "deepresearch_file": str(args.deepresearch),
        "portfolio_file": str(args.portfolio),
        "briefing_file": str(args.briefing),
        "filter_meta": filter_meta,
        "validation": validation_result,
        "output_chars": len(final_md),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    meta_path = out_path.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n✅ 인사이트 저장 완료: {out_path}")
    print(f"   출력 크기: {len(final_md):,} chars")
    if validation_result:
        v_pass = "통과" if validation_result.get("pass", True) else "이슈 있음"
        print(f"   검증 결과: {v_pass} ({len(validation_result.get('issues', []))}건)")
    print(f"   메타데이터: {meta_path}")


if __name__ == "__main__":
    main()
