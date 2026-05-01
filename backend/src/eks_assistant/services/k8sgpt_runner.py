"""Invoke the K8sGPT CLI (non-shell) for cluster analysis."""

from __future__ import annotations

import asyncio
import json
import shutil
from dataclasses import dataclass
from typing import Any


class K8sGPTNotInstalledError(FileNotFoundError):
    """Raised when the configured K8sGPT binary is not on PATH."""


class K8sGPTExplainUnavailableError(RuntimeError):
    """Explain mode produced no usable output (usually missing AI backend / auth)."""


@dataclass(frozen=True)
class K8sGPTVersionResult:
    exit_code: int
    stdout: str
    stderr: str


@dataclass(frozen=True)
class K8sGPTAnalyzeResult:
    exit_code: int
    stdout: str
    stderr: str
    parsed: dict[str, Any] | list[Any]


def resolve_binary(binary_name: str) -> str:
    path = shutil.which(binary_name)
    if path is None:
        raise K8sGPTNotInstalledError(
            f"K8sGPT binary not found: {binary_name!r}. Install K8sGPT and ensure it is on PATH.",
        )
    return path


async def run_version(
    binary: str, timeout: float, *, env: dict[str, str] | None = None
) -> K8sGPTVersionResult:
    exe = resolve_binary(binary)
    proc = await asyncio.create_subprocess_exec(
        exe,
        "version",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    stdout = out_b.decode(errors="replace").strip()
    stderr = err_b.decode(errors="replace").strip()
    return K8sGPTVersionResult(exit_code=proc.returncode or 0, stdout=stdout, stderr=stderr)


async def run_analyze(
    binary: str,
    *,
    timeout: float,
    namespace: str | None,
    explain: bool,
    filters: list[str] | None,
    env: dict[str, str] | None = None,
) -> K8sGPTAnalyzeResult:
    exe = resolve_binary(binary)
    args: list[str] = [exe, "analyze", "--output", "json"]
    if namespace:
        args.extend(["--namespace", namespace])
    if explain:
        args.append("--explain")
    if filters:
        for f in filters:
            args.extend(["--filter", f])

    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    stdout_raw = out_b.decode(errors="replace")
    stderr = err_b.decode(errors="replace").strip()
    exit_code = proc.returncode if proc.returncode is not None else -1
    stdout = stdout_raw.strip()

    if exit_code != 0:
        raise ValueError(
            f"k8sgpt analyze exited with status {exit_code}. stderr: {stderr or '(empty)'}",
        )

    if not stdout:
        if explain:
            raise K8sGPTExplainUnavailableError(
                "K8sGPT returned no JSON output with --explain. "
                "Configure an AI backend inside the container (e.g. "
                "`k8sgpt auth add` with OPENAI_API_KEY / compatible provider, "
                "set env vars the provider needs, then retry). "
                "You can still run Analyze without “Explain with AI”.",
            )
        parsed: dict[str, Any] | list[Any] = []

    else:
        parsed = {}
        try:
            parsed = json.loads(stdout)
        except json.JSONDecodeError as e:
            preview = stdout[:400].replace("\n", "\\n")
            raise ValueError(
                "K8sGPT did not return valid JSON on stdout. "
                f"stderr: {stderr or '(empty)'}; parse error: {e}; "
                f"stdout preview: {preview!r}",
            ) from e

    return K8sGPTAnalyzeResult(
        exit_code=exit_code,
        stdout=stdout,
        stderr=stderr,
        parsed=parsed,
    )
