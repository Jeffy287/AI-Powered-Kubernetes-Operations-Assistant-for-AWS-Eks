from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="EKS_ASSISTANT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    api_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    #: Executable name or absolute path for https://k8sgpt.ai/
    k8sgpt_binary: str = "k8sgpt"
    k8sgpt_timeout_seconds: int = 120

    #: SQLite database and kubeconfig file storage (created at startup)
    data_dir: Path = Path("data")

    #: When true, POST /remediation/execute may run allow-listed kubectl (use with extreme care)
    remediation_enabled: bool = False

    #: Amazon Bedrock — inference profile or model id (e.g. us.anthropic.claude-sonnet-4-6-...)
    #: Leave empty to disable POST /assistant/explain.
    bedrock_model_id: str = ""
    #: Region for Bedrock Runtime client (defaults to common Bedrock regions)
    bedrock_region: str = "us-east-1"


@lru_cache
def get_settings() -> Settings:
    return Settings()
