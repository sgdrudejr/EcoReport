from __future__ import annotations

import os
from pathlib import Path


def _normalize_value(raw: str) -> str:
    value = raw.strip()
    if not value:
        return ""

    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]

    comment_index = value.find(" #")
    if comment_index >= 0:
        return value[:comment_index].strip()

    return value


def load_simple_dotenv(env_path: Path, override: bool = False) -> dict[str, str]:
    if not env_path.exists():
        return {}

    loaded: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        normalized = line[7:].strip() if line.startswith("export ") else line
        if "=" not in normalized:
            continue

        key, raw_value = normalized.split("=", 1)
        key = key.strip()
        if not key:
            continue

        value = _normalize_value(raw_value)
        if override or key not in os.environ:
            os.environ[key] = value
        loaded[key] = value

    return loaded
