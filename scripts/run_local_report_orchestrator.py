#!/usr/bin/env python3
"""Entry point for the local report orchestrator pipeline."""

from __future__ import annotations

import sys

from report_orchestrator.pipeline import main


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
