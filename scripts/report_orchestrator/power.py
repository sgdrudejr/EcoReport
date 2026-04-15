from __future__ import annotations

import re
import socket
import subprocess
import time
from dataclasses import dataclass


MAC_PATTERN = re.compile(r"[^0-9A-Fa-f]")


@dataclass(slots=True)
class WakeResult:
    ok: bool
    method: str
    details: str


@dataclass(slots=True)
class ShutdownResult:
    ok: bool
    method: str
    details: str


def normalize_mac(mac_address: str) -> str:
    normalized = MAC_PATTERN.sub("", mac_address or "")
    if len(normalized) != 12:
        raise ValueError(f"Invalid MAC address: {mac_address}")
    return normalized.lower()


def send_magic_packet(mac_address: str, *, broadcast_ip: str = "255.255.255.255", port: int = 9) -> None:
    normalized = normalize_mac(mac_address)
    payload = bytes.fromhex("ff" * 6 + normalized * 16)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(payload, (broadcast_ip, port))


def wake_windows(mac_address: str) -> WakeResult:
    try:
        result = subprocess.run(
            ["wakeonlan", mac_address],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            details = (result.stdout or result.stderr or "").strip() or "wakeonlan command sent"
            return WakeResult(ok=True, method="wakeonlan", details=details)
    except FileNotFoundError:
        pass
    except Exception as error:  # noqa: BLE001
        return WakeResult(ok=False, method="wakeonlan", details=str(error))

    try:
        send_magic_packet(mac_address)
        return WakeResult(ok=True, method="magic_packet", details="UDP magic packet sent to broadcast 255.255.255.255:9")
    except Exception as error:  # noqa: BLE001
        return WakeResult(ok=False, method="magic_packet", details=str(error))


def sleep_with_log(seconds: int, log) -> None:
    remaining = max(0, seconds)
    while remaining > 0:
        step = min(remaining, 10)
        time.sleep(step)
        remaining -= step
        if remaining > 0:
            log(f"⏳ Waiting for Windows boot: {remaining}s remaining")


def shutdown_windows_via_ssh(ssh_target: str, shutdown_command: str) -> ShutdownResult:
    if not ssh_target.strip():
        return ShutdownResult(ok=False, method="ssh", details="WINDOWS_SSH_TARGET is empty")
    try:
        result = subprocess.run(
            [
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "StrictHostKeyChecking=no",
                "-o",
                "ConnectTimeout=10",
                ssh_target,
                shutdown_command,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        output = (result.stdout or result.stderr or "").strip()
        if result.returncode == 0:
            return ShutdownResult(ok=True, method="ssh", details=output or "ssh shutdown command sent")
        return ShutdownResult(ok=False, method="ssh", details=output or f"ssh exited with {result.returncode}")
    except Exception as error:  # noqa: BLE001
        return ShutdownResult(ok=False, method="ssh", details=str(error))
