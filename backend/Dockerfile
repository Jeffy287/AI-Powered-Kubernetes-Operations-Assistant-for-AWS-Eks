# eks-operations-assistant-api
# Includes K8sGPT CLI from https://github.com/k8sgpt-ai/k8sgpt/releases (see ARG K8SGPT_VERSION).
FROM python:3.12-slim-bookworm

# Default matches linux/amd64 when TARGETARCH is unset (classic docker build).
ARG TARGETARCH=amd64
ARG K8SGPT_VERSION=v0.4.32
ARG KUBECTL_VERSION=v1.32.2

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    EKS_ASSISTANT_DATA_DIR=/app/data

RUN mkdir -p /app/data

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && set -eux \
    && case "${TARGETARCH}" in \
         amd64) K8S_ARCH=x86_64 ;; \
         arm64) K8S_ARCH=arm64 ;; \
         *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
       esac \
    && mkdir -p /tmp/k8sgpt-dist \
    && curl -fsSL "https://github.com/k8sgpt-ai/k8sgpt/releases/download/${K8SGPT_VERSION}/k8sgpt_Linux_${K8S_ARCH}.tar.gz" \
         | tar -xzf - -C /tmp/k8sgpt-dist \
    && install -m 0755 /tmp/k8sgpt-dist/k8sgpt /usr/local/bin/k8sgpt \
    && rm -rf /tmp/k8sgpt-dist \
    && k8sgpt version \
    && case "${TARGETARCH}" in \
         amd64) KCTL_ARCH=amd64 ;; \
         arm64) KCTL_ARCH=arm64 ;; \
         *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
       esac \
    && curl -fsSL -o /usr/local/bin/kubectl \
         "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${KCTL_ARCH}/kubectl" \
    && chmod +x /usr/local/bin/kubectl \
    && kubectl version --client=true

COPY backend/pyproject.toml backend/README.md ./
COPY backend/src ./src

RUN pip install --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -e .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/v1/health || exit 1

CMD ["uvicorn", "eks_assistant.main:app", "--host", "0.0.0.0", "--port", "8000"]
