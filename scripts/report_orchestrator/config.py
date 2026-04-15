from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = "http://192.168.0.218:8080/v1"
DEFAULT_MODEL = "Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
GEMINI_DEFAULT_MODEL = "gemini-2.5-flash"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def normalize_detail_level(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    return "deep" if raw == "deep" else "standard"


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _detail_int(
    *,
    env_name: str,
    config_key: str,
    file_config: dict[str, Any],
    detail_level: str,
    default: int,
) -> int:
    raw_env = os.getenv(env_name)
    if raw_env is not None:
        try:
            return int(raw_env)
        except ValueError:
            return default

    detail_key = f"{detail_level}_{config_key}"
    if detail_key in file_config:
        return int(file_config[detail_key])

    # Bare config keys describe the file's default detail level. This prevents
    # standard-mode chunk sizes from silently overriding an explicit deep run.
    file_detail_level = normalize_detail_level(file_config.get("detail_level", "standard"))
    if detail_level == file_detail_level and config_key in file_config:
        return int(file_config[config_key])

    return default


@dataclass(slots=True)
class PipelineConfig:
    repo_root: Path
    input_root: Path
    output_root: Path
    raw_pdfs_dir: Path
    extracted_text_dir: Path
    chunks_dir: Path
    chunk_summaries_dir: Path
    report_summaries_dir: Path
    merged_dir: Path
    logs_dir: Path
    detail_level: str
    windows_host: str
    windows_mac: str
    wol_wait_seconds: int
    auto_wake_enabled: bool
    shutdown_method: str
    windows_ssh_target: str
    windows_shutdown_command: str
    base_url: str
    model: str
    api_key: str
    timeout_seconds: int
    connection_retries: int
    chunk_retry_attempts: int
    merge_retry_attempts: int
    chunk_min_chars: int
    chunk_target_chars: int
    chunk_max_chars: int
    chunk_overlap_chars: int
    chunk_temperature: float
    merge_temperature: float
    chunk_max_tokens: int
    report_merge_max_tokens: int
    final_merge_max_tokens: int
    max_reports: int | None
    provider: str  # "local" | "gemini"
    category_merge_max_tokens: int
    company_batch_size: int
    analysis_max_tokens: int

    @property
    def chat_completions_url(self) -> str:
        return f"{self.base_url.rstrip('/')}/chat/completions"

    @property
    def is_deep(self) -> bool:
        return self.detail_level == "deep"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text("utf-8"))


def _resolve_path(repo_root: Path, raw: str, fallback: Path) -> Path:
    if not raw:
        return fallback
    candidate = Path(raw).expanduser()
    if candidate.is_absolute():
        return candidate
    return repo_root / candidate


def load_config(config_path: str | None = None) -> PipelineConfig:
    repo_root = _repo_root()
    resolved_config_path = (
        Path(config_path).expanduser()
        if config_path
        else repo_root / "config" / "local-report-orchestrator.json"
    )

    file_config: dict[str, Any] = {}
    if resolved_config_path.exists():
        file_config = _read_json(resolved_config_path)

    detail_level = normalize_detail_level(
        os.getenv("REPORT_ORCHESTRATOR_DETAIL")
        or os.getenv("LLM_REPORT_DETAIL")
        or file_config.get("detail_level", "standard")
    )

    input_root = _resolve_path(
        repo_root,
        os.getenv("REPORT_ORCHESTRATOR_INPUT_ROOT") or os.getenv("LLM_REPORT_INPUT_ROOT") or file_config.get("input_root", "data/reports"),
        repo_root / "data" / "reports",
    )
    output_root = _resolve_path(
        repo_root,
        os.getenv("REPORT_ORCHESTRATOR_OUTPUT_ROOT") or os.getenv("LLM_REPORT_OUTPUT_ROOT") or file_config.get("output_root", "reports"),
        repo_root / "reports",
    )

    provider = str(
        os.getenv("REPORT_ORCHESTRATOR_PROVIDER")
        or file_config.get("provider", "local")
    ).strip().lower()

    if provider == "gemini":
        base_url = (
            os.getenv("LLM_BASE_URL")
            or os.getenv("REPORT_ORCHESTRATOR_BASE_URL")
            or file_config.get("gemini_base_url", GEMINI_BASE_URL)
        )
        model = (
            os.getenv("LLM_MODEL")
            or os.getenv("REPORT_ORCHESTRATOR_MODEL")
            or file_config.get("gemini_model", GEMINI_DEFAULT_MODEL)
        )
        api_key = (
            os.getenv("GEMINI_API_KEY")
            or os.getenv("LLM_API_KEY")
            or file_config.get("api_key", "")
        )
    else:
        base_url = (
            os.getenv("REPORT_ORCHESTRATOR_BASE_URL")
            or file_config.get("base_url")
            or os.getenv("LLM_BASE_URL")
            or DEFAULT_BASE_URL
        )
        model = (
            os.getenv("REPORT_ORCHESTRATOR_MODEL")
            or file_config.get("model")
            or os.getenv("LLM_MODEL")
            or DEFAULT_MODEL
        )
        api_key = (
            os.getenv("LLM_API_KEY")
            or os.getenv("REPORT_ORCHESTRATOR_API_KEY")
            or file_config.get("api_key", "dummy")
        )
    max_reports_raw = os.getenv("REPORT_ORCHESTRATOR_MAX_REPORTS") or os.getenv("LLM_REPORT_MAX_REPORTS")
    if max_reports_raw is None:
        max_reports_raw = file_config.get("max_reports")
    max_reports = int(max_reports_raw) if max_reports_raw not in (None, "") else None

    default_chunk_min = 4200 if detail_level == "deep" else 7000
    default_chunk_target = 5000 if detail_level == "deep" else 8000
    default_chunk_max = 6000 if detail_level == "deep" else 9000
    default_chunk_overlap = 800 if detail_level == "deep" else 900
    default_chunk_retry = 3 if detail_level == "deep" else 2
    default_merge_retry = 3 if detail_level == "deep" else 2
    default_chunk_tokens = 1600 if detail_level == "deep" else 900
    default_report_merge_tokens = 7000 if detail_level == "deep" else 1500
    default_final_merge_tokens = 8000 if detail_level == "deep" else 1800

    shutdown_method = str(
        os.getenv("REPORT_ORCHESTRATOR_SHUTDOWN_METHOD")
        or file_config.get("shutdown_method", "none")
    ).strip().lower()

    return PipelineConfig(
        repo_root=repo_root,
        input_root=input_root,
        output_root=output_root,
        raw_pdfs_dir=output_root / "raw_pdfs",
        extracted_text_dir=output_root / "extracted_text",
        chunks_dir=output_root / "chunks",
        chunk_summaries_dir=output_root / "chunk_summaries",
        report_summaries_dir=output_root / "report_summaries",
        merged_dir=output_root / "merged",
        logs_dir=output_root / "logs",
        detail_level=detail_level,
        windows_host=os.getenv("WINDOWS_HOST") or file_config.get("windows_host", "192.168.0.218"),
        windows_mac=os.getenv("WINDOWS_MAC") or file_config.get("windows_mac", "A0:AD:9F:CD:47:D2"),
        wol_wait_seconds=_env_int("REPORT_ORCHESTRATOR_WOL_WAIT_SECONDS", int(file_config.get("wol_wait_seconds", 60))),
        auto_wake_enabled=(os.getenv("REPORT_ORCHESTRATOR_AUTO_WAKE", str(file_config.get("auto_wake_enabled", True))).strip().lower() not in {"0", "false", "no"}),
        shutdown_method=shutdown_method,
        windows_ssh_target=os.getenv("WINDOWS_SSH_TARGET") or file_config.get("windows_ssh_target", ""),
        windows_shutdown_command=(
            os.getenv("WINDOWS_SHUTDOWN_COMMAND")
            or file_config.get("windows_shutdown_command", "shutdown /s /t 0")
        ),
        base_url=base_url,
        model=model,
        api_key=api_key,
        timeout_seconds=_env_int("REPORT_ORCHESTRATOR_TIMEOUT_SECONDS", int(file_config.get("timeout_seconds", 180))),
        connection_retries=_env_int("REPORT_ORCHESTRATOR_CONNECTION_RETRIES", int(file_config.get("connection_retries", 3))),
        chunk_retry_attempts=_detail_int(
            env_name="REPORT_ORCHESTRATOR_CHUNK_RETRY_ATTEMPTS",
            config_key="chunk_retry_attempts",
            file_config=file_config,
            detail_level=detail_level,
            default=default_chunk_retry,
        ),
        merge_retry_attempts=_detail_int(
            env_name="REPORT_ORCHESTRATOR_MERGE_RETRY_ATTEMPTS",
            config_key="merge_retry_attempts",
            file_config=file_config,
            detail_level=detail_level,
            default=default_merge_retry,
        ),
        chunk_min_chars=_detail_int(
            env_name="REPORT_ORCHESTRATOR_CHUNK_MIN_CHARS",
            config_key="chunk_min_chars",
            file_config=file_config,
            detail_level=detail_level,
            default=default_chunk_min,
        ),
        chunk_target_chars=_detail_int(
            env_name="REPORT_ORCHESTRATOR_CHUNK_TARGET_CHARS",
            config_key="chunk_target_chars",
            file_config=file_config,
            detail_level=detail_level,
            default=default_chunk_target,
        ),
        chunk_max_chars=_detail_int(
            env_name="REPORT_ORCHESTRATOR_CHUNK_MAX_CHARS",
            config_key="chunk_max_chars",
            file_config=file_config,
            detail_level=detail_level,
            default=default_chunk_max,
        ),
        chunk_overlap_chars=_detail_int(
            env_name="REPORT_ORCHESTRATOR_CHUNK_OVERLAP_CHARS",
            config_key="chunk_overlap_chars",
            file_config=file_config,
            detail_level=detail_level,
            default=default_chunk_overlap,
        ),
        chunk_temperature=_env_float("REPORT_ORCHESTRATOR_CHUNK_TEMPERATURE", float(file_config.get("chunk_temperature", 0.1))),
        merge_temperature=_env_float("REPORT_ORCHESTRATOR_MERGE_TEMPERATURE", float(file_config.get("merge_temperature", 0.1))),
        chunk_max_tokens=_detail_int(
            env_name="REPORT_ORCHESTRATOR_CHUNK_MAX_TOKENS",
            config_key="chunk_max_tokens",
            file_config=file_config,
            detail_level=detail_level,
            default=default_chunk_tokens,
        ),
        report_merge_max_tokens=_detail_int(
            env_name="REPORT_ORCHESTRATOR_REPORT_MERGE_MAX_TOKENS",
            config_key="report_merge_max_tokens",
            file_config=file_config,
            detail_level=detail_level,
            default=default_report_merge_tokens,
        ),
        final_merge_max_tokens=_detail_int(
            env_name="REPORT_ORCHESTRATOR_FINAL_MERGE_MAX_TOKENS",
            config_key="final_merge_max_tokens",
            file_config=file_config,
            detail_level=detail_level,
            default=default_final_merge_tokens,
        ),
        max_reports=max_reports,
        provider=provider,
        category_merge_max_tokens=_detail_int(
            env_name="REPORT_ORCHESTRATOR_CATEGORY_MERGE_MAX_TOKENS",
            config_key="category_merge_max_tokens",
            file_config=file_config,
            detail_level=detail_level,
            default=4096 if detail_level == "deep" else 2400,
        ),
        company_batch_size=int(
            os.getenv("REPORT_ORCHESTRATOR_COMPANY_BATCH_SIZE")
            or file_config.get("company_batch_size", 10)
        ),
        analysis_max_tokens=_detail_int(
            env_name="REPORT_ORCHESTRATOR_ANALYSIS_MAX_TOKENS",
            config_key="analysis_max_tokens",
            file_config=file_config,
            detail_level=detail_level,
            default=5200 if detail_level == "deep" else 3200,
        ),
    )
