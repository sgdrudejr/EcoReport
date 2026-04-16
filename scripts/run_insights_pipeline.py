#!/usr/bin/env python3
"""
run_insights_pipeline.py
저장된 report_summaries를 읽어 인사이트 파이프라인을 실행한다.

Codex(로컬 LLM)가 report_summaries 생성을 마친 후 이어서 실행:
  python scripts/run_insights_pipeline.py --date 2026-04-15

파이프라인:
  1. report_summaries/{date}/*.json 로드
  2. 카테고리별 병합  → reports/merged/by_category/
  3. 구조화 분석 추출 → reports/merged/structured_analysis.json
  4. 딥리서치 프롬프트 → reports/merged/deep_research_prompt.md  ← Gemini 웹에 붙여넣기

작업지침서: config/insights-instructions.md (깃으로 관리)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date as date_type
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from report_orchestrator.config import load_config
from report_orchestrator.llm import LlmClient
from report_orchestrator.pipeline import ReportOrchestrator
from report_orchestrator.text_processing import read_json


# ── 작업지침서 로더 ───────────────────────────────────────────────────────────

def load_instructions(path: Path) -> str:
    """config/insights-instructions.md를 읽어 문자열로 반환한다."""
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    return ""


# ── report_summaries 로더 ─────────────────────────────────────────────────────

def load_report_summaries(report_summaries_dir: Path, date: str) -> list[dict]:
    """저장된 report_summaries/{date}/*.json을 모두 읽어 반환한다."""
    date_dir = report_summaries_dir / date
    if not date_dir.exists():
        return []
    summaries = []
    for path in sorted(date_dir.glob("*.json")):
        raw = read_json(path, {})
        report = raw.get("report", raw)  # {meta:..., report:...} 구조 대응
        if report:
            summaries.append(report)
    return summaries


# ── 오버라이드된 메서드: 작업지침서 주입 ─────────────────────────────────────

def patch_orchestrator_with_instructions(orchestrator: ReportOrchestrator, instructions: str) -> None:
    """오케스트레이터의 LLM 호출 메서드에 작업지침서를 주입한다."""
    if not instructions:
        return

    original_call = orchestrator._call_category_merge_llm.__func__  # type: ignore[attr-defined]
    original_analysis = orchestrator.extract_structured_analysis.__func__  # type: ignore[attr-defined]
    instructions_block = f"\n\n---\n## 작업지침서 (깃 관리)\n{instructions}"

    def patched_category_merge(self, category, summaries):
        _original_complete = self.client.complete_json

        def injected_complete(*, messages, temperature, max_tokens, retry_attempts):
            if messages and messages[0]["role"] == "system":
                messages = list(messages)
                messages[0] = {
                    "role": "system",
                    "content": messages[0]["content"] + instructions_block,
                }
            return _original_complete(
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                retry_attempts=retry_attempts,
            )

        self.client.complete_json = injected_complete
        try:
            return original_call(self, category, summaries)
        finally:
            self.client.complete_json = _original_complete

    def patched_extract_analysis(self, category_views):
        # 시스템 메시지에 작업지침서 주입
        _original_complete = self.client.complete_json

        def injected_complete(*, messages, temperature, max_tokens, retry_attempts):
            if messages and messages[0]["role"] == "system":
                messages = list(messages)
                messages[0] = {
                    "role": "system",
                    "content": messages[0]["content"] + instructions_block,
                }
            return _original_complete(
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                retry_attempts=retry_attempts,
            )

        self.client.complete_json = injected_complete
        try:
            return original_analysis(self, category_views)
        finally:
            self.client.complete_json = _original_complete

    import types
    orchestrator._call_category_merge_llm = types.MethodType(patched_category_merge, orchestrator)  # type: ignore[assignment]
    orchestrator.extract_structured_analysis = types.MethodType(patched_extract_analysis, orchestrator)  # type: ignore[assignment]


# ── Gemini 풀필드 직접 분석 ───────────────────────────────────────────────────

def run_gemini_full_analysis(
    summaries: list[dict],
    instructions: str,
    date: str,
    config,
    out_dir: Path,
) -> None:
    """75개 리포트 요약 전체 필드를 Gemini에 직접 넣어 심층 분석을 생성한다."""
    from openai import OpenAI

    total_chars = len(json.dumps(summaries, ensure_ascii=False))
    print(f"  📨 Gemini 풀필드 분석 | {len(summaries)}개 리포트 | {total_chars:,}자 (≈{int(total_chars*0.4/1000)}K 토큰)")

    client = OpenAI(
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        api_key=os.environ.get("GEMINI_API_KEY", config.api_key),
    )

    response = client.chat.completions.create(
        model=config.model,
        messages=[
            {
                "role": "system",
                "content": (
                    f"너는 한국 증권사 리포트 {len(summaries)}개를 종합 분석하는 시니어 투자 분석가다.\n"
                    f"아래 작업지침서를 반드시 따라라.\n\n{instructions}\n\n"
                    "출력은 마크다운, 한국어로 작성하라.\n"
                    "각 섹션은 충분히 깊게 분석하라. 단순 나열이 아닌 해석과 판단을 포함하라."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "date": date,
                        "report_count": len(summaries),
                        "task": (
                            "아래 리포트 요약 전체(모든 필드 포함)를 바탕으로 다음을 작성하라:\n\n"
                            "1. 오늘 시장 핵심 요약 (5~7줄, 숫자/지표 포함)\n"
                            "2. 매크로 레짐 판단 및 근거 (Growth/Stagflation/Risk-Off/Neutral)\n"
                            "3. 컨센서스 TOP 5 (동의율 추정 + 핵심 근거 + 수혜 종목/ETF)\n"
                            "4. 소수 의견 — 주목해야 할 역발상 3개 (왜 틀릴 수 있는지, 왜 맞을 수 있는지)\n"
                            "5. 모순·충돌 분석 — 같은 종목/테마에 상반된 뷰가 있는 것 전부 (판단 포함)\n"
                            "6. 크로스카테고리 투자 신호 — 매크로+채권+전략+산업이 동시에 가리키는 방향\n"
                            "7. 시나리오 맵 — 상승/하락 시나리오별 트리거와 수혜/피해 섹터\n"
                            "8. 이번 주 실행 체크리스트 (ETF/종목 구체적으로, 계좌별 ISA/PENSION/KIS_MAIN 구분)"
                        ),
                        "reports": summaries,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        max_tokens=16000,
        temperature=0.1,
    )

    result = response.choices[0].message.content
    finish = response.choices[0].finish_reason
    print(f"  ✅ 완료 | finish={finish} | {len(result):,}자")

    out_path = out_dir / "gemini_full_analysis.md"
    out_path.write_text(f"# {date} Gemini 전체 분석\n\n" + result, encoding="utf-8")
    print(f"  📄 저장 → {out_path.relative_to(ROOT)}")


# ── 메인 ─────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="인사이트 파이프라인 — report_summaries 이어받기")
    parser.add_argument("--date", default=str(date_type.today()), help="처리할 날짜 (YYYY-MM-DD)")
    parser.add_argument("--config", default=None, help="local-report-orchestrator.json 경로")
    parser.add_argument("--instructions", default=None, help="작업지침서 경로 (기본: config/insights-instructions.md)")
    parser.add_argument("--force", action="store_true", help="캐시 무시하고 재생성")
    parser.add_argument("--detail", choices=["standard", "deep"], default=None)
    parser.add_argument("--provider", default=None, help="gemini | local (config 기본값 덮어쓰기)")
    args = parser.parse_args()

    # provider 오버라이드 (env를 통해)
    if args.provider:
        os.environ["REPORT_ORCHESTRATOR_PROVIDER"] = args.provider
    elif not os.getenv("REPORT_ORCHESTRATOR_PROVIDER"):
        os.environ["REPORT_ORCHESTRATOR_PROVIDER"] = "gemini"  # 기본값: Gemini

    if args.detail:
        os.environ["REPORT_ORCHESTRATOR_DETAIL"] = args.detail

    config = load_config(args.config)

    # .env 자동 로드 (python-dotenv 없어도 동작)
    env_path = ROOT / ".env"
    if env_path.exists() and not os.getenv("GEMINI_API_KEY"):
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
        # config 재로드 (env 반영)
        config = load_config(args.config)

    print(f"🚀 인사이트 파이프라인 시작 | {args.date} | provider={config.provider} | model={config.model}")

    # 작업지침서 로드
    instructions_path = Path(args.instructions) if args.instructions else ROOT / "config" / "insights-instructions.md"
    instructions = load_instructions(instructions_path)
    if instructions:
        print(f"📋 작업지침서 로드: {instructions_path.relative_to(ROOT)}")
    else:
        print("⚠️  작업지침서 없음 — config/insights-instructions.md 를 작성하세요")

    # report_summaries 로드
    summaries = load_report_summaries(config.report_summaries_dir, args.date)
    if not summaries:
        print(f"❌ report_summaries 없음: {config.report_summaries_dir / args.date}")
        print("   Codex(로컬 LLM) 실행이 아직 완료되지 않았을 수 있습니다.")
        return 1
    print(f"📚 report_summaries 로드: {len(summaries)}개 ({args.date})")

    # Step 0: Gemini 풀필드 직접 분석 (핵심 단계)
    print("\n🧠 Step 0: Gemini 풀필드 심층 분석...")
    ensure_dir(config.merged_dir)
    try:
        run_gemini_full_analysis(summaries, instructions, args.date, config, config.merged_dir)
    except Exception as error:  # noqa: BLE001
        print(f"  ❌ Gemini 풀필드 분석 실패: {error}")

    # 오케스트레이터 초기화 (LLM 연결 체크 없이)
    orchestrator = ReportOrchestrator(config, force=args.force, date_filter=args.date)

    # 작업지침서 주입
    patch_orchestrator_with_instructions(orchestrator, instructions)

    # Step 1: 카테고리별 병합
    print("\n🗂  Step 1: 카테고리별 병합...")
    from report_orchestrator.text_processing import ensure_dir
    ensure_dir(config.merged_dir)
    category_views = orchestrator.merge_by_category(summaries)

    if not category_views:
        print("❌ 카테고리 병합 실패")
        return 1

    # Step 2: 구조화 분석
    print("\n🔬 Step 2: 구조화 분석 추출...")
    analysis = orchestrator.extract_structured_analysis(category_views)

    # Step 3: 딥리서치 프롬프트
    print("\n📋 Step 3: 딥리서치 프롬프트 생성...")
    orchestrator.generate_deep_research_prompt(analysis, date=args.date)

    # 결과 요약
    consensus_count = len(analysis.get("consensus", []))
    minority_count = len(analysis.get("minority_views", []))
    contradiction_count = len(analysis.get("contradictions", []))
    cross_count = len(analysis.get("cross_category_signals", []))

    print(f"""
✅ 인사이트 파이프라인 완료

   🧠 Gemini 풀필드 분석  → reports/merged/gemini_full_analysis.md  ← 핵심 결과물
   🗂  카테고리 뷰         → reports/merged/by_category/ ({len(category_views)}개)
   🔬 구조화 분석         → reports/merged/structured_analysis.json
     컨센서스 {consensus_count}개 / 소수의견 {minority_count}개 / 모순 {contradiction_count}개 / 크로스신호 {cross_count}개
   📋 딥리서치 프롬프트   → reports/merged/deep_research_prompt.md
      └ Gemini 웹(gemini.google.com) 딥리서치 모드에 붙여넣기

   이후: python scripts/generate_insights_report.py --date {args.date}
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
