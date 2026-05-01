"""Amazon Bedrock Runtime — Claude via Converse API."""

from __future__ import annotations

import json
import logging
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)


def run_bedrock_converse(
    *,
    region: str,
    model_id: str,
    system_prompt: str,
    user_text: str,
    max_tokens: int = 4096,
) -> str:
    client = boto3.client("bedrock-runtime", region_name=region)
    try:
        response = client.converse(
            modelId=model_id,
            messages=[
                {"role": "user", "content": [{"text": user_text}]},
            ],
            system=[{"text": system_prompt}],
            inferenceConfig={
                "maxTokens": max_tokens,
                "temperature": 0.2,
            },
        )
    except (ClientError, BotoCoreError) as e:
        logger.exception("Bedrock converse failed")
        raise RuntimeError(str(e)) from e

    text = _extract_output_text(response)
    if not text.strip():
        logger.warning("Bedrock returned empty text; raw keys: %s", response.keys())
    return text


def _extract_output_text(response: dict[str, Any]) -> str:
    out = response.get("output") or {}
    msg = out.get("message") or {}
    content = msg.get("content") or []
    parts: list[str] = []
    for block in content:
        if isinstance(block, dict) and "text" in block:
            parts.append(str(block["text"]))
    if parts:
        return "\n".join(parts)
    # Fallback for unexpected shapes (debugging)
    try:
        return json.dumps(response, default=str, indent=2)[:12000]
    except Exception:
        return str(response)[:8000]
