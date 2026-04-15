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
        result = original_call(self, category, summaries)
        return result

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
            return _original_complete(messages=messages, temperature=temperature,
                                      max_tokens=max_tokens, retry_attempts=retry_attempts)

        self.client.complete_json = injected_complete
        try:
            return original_analysis(self, category_views)
        finally:
            self.client.complete_json = _original_complete

    import types
    orchestrator._call_category_merge_llm = types.MethodType(patched_category_merge, orchestrator)  # type: ignore[assignment]
    orchestrator.extract_structured_analysis = types.MethodType(patched_extract_analysis, orchestrator)  # type: ignore[assignment]


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

   카테고리 뷰:    {len(category_views)}개 → reports/merged/by_category/
   구조화 분석:
     컨센서스:     {consensus_count}개
     소수의견:     {minority_count}개
     모순·충돌:    {contradiction_count}개
     크로스신호:   {cross_count}개
   → reports/merged/structured_analysis.json

   📋 딥리서치 프롬프트 → reports/merged/deep_research_prompt.md
      Gemini 웹(gemini.google.com)에서 딥리서치 모드로 붙여넣기

   이후: python scripts/generate_insights_report.py --date {args.date}
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
