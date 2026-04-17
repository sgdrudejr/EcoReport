#!/usr/bin/env python3
from report_orchestrator.config import load_config


def main() -> int:
    config = load_config()
    from report_orchestrator.pipeline import ReportOrchestrator

    orchestrator = ReportOrchestrator(config, force=False)
    result = orchestrator.ensure_windows_llm_ready()
    if result["ok"]:
        print(f"LLM connection OK: {config.chat_completions_url} | model={config.model}")
        return 0
    print(f"LLM connection FAILED: {config.chat_completions_url} | model={config.model}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
