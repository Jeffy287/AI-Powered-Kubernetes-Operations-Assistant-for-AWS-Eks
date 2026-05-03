"""Assistant / Bedrock explain payloads."""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class PodTarget(BaseModel):
    namespace: str = Field(..., min_length=1, max_length=253)
    name: str = Field(..., min_length=1, max_length=253)


class ExplainRequest(BaseModel):
    """Pod/node/extra_context give cluster signal; question alone is allowed for general Q&A."""

    question: str | None = Field(None, max_length=8000)
    pod: PodTarget | None = None
    node_name: str | None = Field(None, max_length=253)
    extra_context: str | None = Field(None, max_length=48000)

    @model_validator(mode="after")
    def at_least_one_signal(self) -> ExplainRequest:
        has_pod = self.pod is not None
        has_node = bool(self.node_name and self.node_name.strip())
        has_extra = bool(self.extra_context and self.extra_context.strip())
        has_question = bool(self.question and self.question.strip())
        if not has_pod and not has_node and not has_extra and not has_question:
            raise ValueError(
                "Provide a question and/or one of: pod, node_name, extra_context",
            )
        return self


class ExplainResponse(BaseModel):
    explanation: str
    model_id: str
