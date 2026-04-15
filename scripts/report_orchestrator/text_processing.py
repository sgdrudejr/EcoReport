from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path


NUMERIC_HEAVY_PATTERN = re.compile(r"[\d.,%()+\-/:]+")
PAGE_MARKER_PATTERN = re.compile(r"^(?:\[PAGE\s+\d+\]|---\s*Page\s+\d+\s*---|\d+)$", re.IGNORECASE)
HEADING_PATTERN = re.compile(r"^(?:[0-9]+[.)]|[■□▶◆●]|[A-Za-z가-힣][A-Za-z가-힣0-9\s]{0,40}[:：])")


def sha1_of_file(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha1_of_text(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text("utf-8"))


def write_json(path: Path, payload) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")


def write_text(path: Path, payload: str) -> None:
    ensure_dir(path.parent)
    path.write_text(payload, "utf-8")


def sanitize_file_stem(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("_") or "report"


def extract_text_from_pdf(pdf_path: Path) -> str:
    command = ["pdftotext", "-layout", "-nopgbrk", str(pdf_path), "-"]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"pdftotext failed with exit code {result.returncode}")
    return result.stdout


def _is_numeric_heavy(line: str) -> bool:
    stripped = line.strip()
    if len(stripped) < 8:
        return False
    numeric_parts = "".join(NUMERIC_HEAVY_PATTERN.findall(stripped))
    alpha_parts = re.sub(r"[\d.,%()+\-/: ]+", "", stripped)
    digit_ratio = len(numeric_parts) / max(len(stripped), 1)
    return digit_ratio >= 0.55 and len(alpha_parts) <= max(8, len(stripped) * 0.25)


def _should_join(prev_line: str, current_line: str) -> bool:
    if not prev_line or not current_line:
        return False
    if PAGE_MARKER_PATTERN.match(prev_line) or PAGE_MARKER_PATTERN.match(current_line):
        return False
    if HEADING_PATTERN.match(current_line):
        return False
    if _is_numeric_heavy(prev_line) or _is_numeric_heavy(current_line):
        return False
    if prev_line.endswith((".", "?", "!", ":", ";", "]", ")", "%")):
        return False
    return True


def preprocess_text(text: str) -> str:
    text = (
        text.replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\u0000", "")
        .replace("\t", " ")
    )
    lines = [line.strip() for line in text.split("\n")]

    paragraphs: list[str] = []
    current: list[str] = []
    numeric_block_count = 0

    def flush_current() -> None:
        if not current:
            return
        paragraph = " ".join(part.strip() for part in current if part.strip())
        paragraph = re.sub(r"\s{2,}", " ", paragraph).strip()
        if paragraph:
            paragraphs.append(paragraph)
        current.clear()

    def flush_numeric() -> None:
        nonlocal numeric_block_count
        if numeric_block_count >= 2:
            paragraphs.append(f"[TABLE_BLOCK_COLLAPSED rows={numeric_block_count}]")
        numeric_block_count = 0

    for raw_line in lines:
        line = re.sub(r"\s{2,}", " ", raw_line).strip()
        if not line:
            flush_current()
            flush_numeric()
            continue

        if PAGE_MARKER_PATTERN.match(line):
            flush_current()
            flush_numeric()
            continue

        if _is_numeric_heavy(line):
            flush_current()
            numeric_block_count += 1
            continue

        flush_numeric()
        if current and _should_join(current[-1], line):
            current[-1] = f"{current[-1]} {line}"
        else:
            current.append(line)

    flush_current()
    flush_numeric()

    normalized = "\n\n".join(paragraphs)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    normalized = re.sub(r"[ ]{2,}", " ", normalized)
    return normalized.strip()


def _split_large_paragraph(paragraph: str, max_chars: int) -> list[str]:
    if len(paragraph) <= max_chars:
        return [paragraph]

    sentences = re.split(r"(?<=[.!?다요])\s+", paragraph)
    parts: list[str] = []
    current = ""
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if not current:
            current = sentence
            continue
        if len(current) + 1 + len(sentence) <= max_chars:
            current = f"{current} {sentence}"
        else:
            parts.append(current)
            current = sentence
    if current:
        parts.append(current)

    if not parts:
        return [paragraph[i : i + max_chars] for i in range(0, len(paragraph), max_chars)]

    normalized_parts: list[str] = []
    for part in parts:
        if len(part) <= max_chars:
            normalized_parts.append(part)
        else:
            normalized_parts.extend(part[i : i + max_chars] for i in range(0, len(part), max_chars))
    return normalized_parts


def trailing_overlap(text: str, overlap_chars: int) -> str:
    if len(text) <= overlap_chars:
        return text
    tail = text[-overlap_chars:]
    split_at = tail.find("\n\n")
    if split_at > 0 and len(tail) - split_at >= overlap_chars * 0.55:
        return tail[split_at + 2 :].strip()
    split_at = tail.find(" ")
    if split_at > 0 and len(tail) - split_at >= overlap_chars * 0.55:
        return tail[split_at + 1 :].strip()
    return tail.strip()


def chunk_text(text: str, min_chars: int, target_chars: int, max_chars: int, overlap_chars: int) -> list[dict]:
    paragraphs = [paragraph.strip() for paragraph in text.split("\n\n") if paragraph.strip()]
    expanded: list[str] = []
    for paragraph in paragraphs:
        expanded.extend(_split_large_paragraph(paragraph, max_chars))

    chunks: list[dict] = []
    overlap_seed = ""
    index = 0

    while index < len(expanded):
        parts: list[str] = [overlap_seed] if overlap_seed else []
        fresh_parts = 0
        while index < len(expanded):
            candidate = expanded[index]
            joined = "\n\n".join(part for part in parts + [candidate] if part)
            if fresh_parts > 0 and len(joined) > max_chars and len("\n\n".join(part for part in parts if part)) >= min_chars:
                break
            if fresh_parts == 0 and len(joined) > max_chars and len(candidate) > target_chars:
                break
            parts.append(candidate)
            fresh_parts += 1
            index += 1
            current_text = "\n\n".join(part for part in parts if part)
            if len(current_text) >= target_chars:
                break

        chunk_text_value = "\n\n".join(part for part in parts if part).strip()
        if not chunk_text_value:
            break

        chunks.append(
            {
                "chunk_index": len(chunks),
                "char_length": len(chunk_text_value),
                "text": chunk_text_value,
            }
        )
        overlap_seed = trailing_overlap(chunk_text_value, overlap_chars)

    return chunks
