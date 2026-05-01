"""JSON body for generating a kubeconfig (token auth + embedded CA)."""

from __future__ import annotations

import base64
import re
from typing import Any

import yaml
from pydantic import BaseModel, Field, field_validator

_HTTPS = re.compile(r"^https://[a-zA-Z0-9.:\-]+(:\d+)?(/.*)?$")


class TokenKubeconfigRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=256)
    server: str = Field(..., description="Kubernetes API URL (https://...)")
    certificate_authority_data: str = Field(
        ...,
        description="Base64-encoded cluster CA (e.g. from aws eks describe-cluster)",
    )
    token: str = Field(..., min_length=8)
    cluster_name: str = Field(default="cluster", min_length=1, max_length=128)
    context_name: str = Field(default="context", min_length=1, max_length=128)
    user_name: str = Field(default="token-user", min_length=1, max_length=128)

    @field_validator("server")
    @classmethod
    def server_https(cls, v: str) -> str:
        s = v.strip()
        if not _HTTPS.match(s):
            raise ValueError("server must be a valid https:// URL")
        return s

    @field_validator("certificate_authority_data")
    @classmethod
    def ca_data_b64(cls, v: str) -> str:
        s = "".join(v.split())
        if not s:
            raise ValueError("certificate_authority_data is required")
        padded = s + "=" * (-len(s) % 4)
        try:
            base64.b64decode(padded, validate=True)
        except Exception as e:
            raise ValueError("certificate_authority_data must be valid base64") from e
        return s

    @field_validator("token")
    @classmethod
    def token_non_empty(cls, v: str) -> str:
        t = v.strip()
        if len(t) < 8:
            raise ValueError("token is too short")
        return t


def render_kubeconfig_token_auth(body: TokenKubeconfigRequest) -> str:
    cname = body.cluster_name.strip()
    ctx = body.context_name.strip()
    uname = body.user_name.strip()
    doc: dict[str, Any] = {
        "apiVersion": "v1",
        "kind": "Config",
        "clusters": [
            {
                "name": cname,
                "cluster": {
                    "certificate-authority-data": body.certificate_authority_data,
                    "server": body.server,
                },
            },
        ],
        "contexts": [
            {
                "name": ctx,
                "context": {
                    "cluster": cname,
                    "user": uname,
                },
            },
        ],
        "current-context": ctx,
        "users": [
            {
                "name": uname,
                "user": {
                    "token": body.token,
                },
            },
        ],
    }
    return yaml.safe_dump(doc, default_flow_style=False, sort_keys=False)
