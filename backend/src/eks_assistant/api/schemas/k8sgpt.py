import re
from typing import Any

from pydantic import BaseModel, Field, field_validator

_NS_LABEL = re.compile(r"^[a-z0-9]([-a-z0-9]*[a-z0-9])?$")


class K8sGPTAnalyzeRequest(BaseModel):
    """Body for POST /diagnostics/k8sgpt/analyze."""

    namespace: str | None = Field(
        default=None,
        description="Kubernetes namespace to scope analysis (omit for cluster-wide).",
    )
    explain: bool = Field(
        default=False,
        description="If true, passes --explain to K8sGPT (requires AI backend configured for K8sGPT).",
    )
    filters: list[str] | None = Field(
        default=None,
        description='Optional resource filters, e.g. ["Pod", "Deployment"]. Passed as repeated --filter.',
    )

    @field_validator("namespace")
    @classmethod
    def namespace_ok(cls, v: str | None) -> str | None:
        if v is None or v == "":
            return None
        if len(v) > 63:
            raise ValueError("namespace must be at most 63 characters")
        if not _NS_LABEL.match(v):
            raise ValueError("invalid namespace")
        return v

    @field_validator("filters")
    @classmethod
    def filters_ok(cls, v: list[str] | None) -> list[str] | None:
        if not v:
            return None
        cleaned = [f.strip() for f in v if f.strip()]
        for f in cleaned:
            if len(f) > 128 or not re.match(r"^[A-Za-z][A-Za-z0-9]*$", f):
                raise ValueError(f"invalid filter value: {f!r}")
        return cleaned or None


class K8sGPTAnalyzeResponse(BaseModel):
    exit_code: int
    stderr: str | None = None
    result: dict[str, Any] | list[Any]
