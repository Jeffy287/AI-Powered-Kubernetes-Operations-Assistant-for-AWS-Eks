"""
Thin abstraction over cluster access.

Implement using kubernetes-asyncio or official client loaded from in-cluster config /
kubeconfig. Keep read-only verbs for production assistant flows.
"""


class KubernetesGateway:
    """Placeholder — inject real client when cluster connectivity is configured."""

    async def ping(self) -> bool:
        return False
