from __future__ import annotations

import os
import socket
import sys
import warnings
from pathlib import Path

import pytest
import requests

warnings.filterwarnings(
    "ignore",
    message=r"urllib3 .* doesn't match a supported version!",
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
project_root_str = str(PROJECT_ROOT)

if project_root_str not in sys.path:
    sys.path.insert(0, project_root_str)

from lib import request_security

from tests.support.mocks import FakeChromaClient, fake_embed_texts

# Ensure `rag_service` can be used as a bare module alias in test patches
# (e.g. ``patch("rag_service.RAG_ENABLED", ...)``) even though the actual
# module lives at ``services.rag_service``.
import services.rag_service as _rag_svc
sys.modules.setdefault("rag_service", _rag_svc)

# Same alias for ``activity_service`` which lives at ``services.activity_service``.
import services.activity_service as _act_svc
sys.modules.setdefault("activity_service", _act_svc)

# Same alias for ``db`` which lives at ``core.db``.
import core.db as _db_mod
sys.modules.setdefault("db", _db_mod)

# Reload prompts from the project-root prompts.yaml so tests see the latest prompt texts.
from core import prompts as _prompts_mod
_prompts_mod.reload_prompts()


@pytest.fixture(autouse=True)
def test_environment(monkeypatch):
    import core.config as config

    monkeypatch.setenv("RAG_ENABLED", "true")
    monkeypatch.setattr(config, "RAG_ENABLED", True)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "")
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    monkeypatch.setenv("OPENAI_API_KEY", "")


@pytest.fixture(autouse=True)
def block_external_network(monkeypatch):
    def _blocked_requests(*args, **kwargs):
        raise AssertionError("External network access is disabled in tests.")

    def _blocked_socket_connect(*args, **kwargs):
        raise AssertionError("External network access is disabled in tests.")

    monkeypatch.setattr(requests.sessions.Session, "request", _blocked_requests)
    monkeypatch.setattr(socket.socket, "connect", _blocked_socket_connect)


@pytest.fixture(autouse=True)
def isolate_test_state(monkeypatch):
    import core.config as config
    import lib.model_registry as model_registry
    import rag.store as rag_store
    import routes.conversations

    # Ensure RAG_ENABLED is True in all relevant modules
    monkeypatch.setattr(config, "RAG_ENABLED", True)
    config._RUNTIME_BASE_VALUES["RAG_ENABLED"] = True  # override fallback used by apply_persisted_runtime_settings
    monkeypatch.setattr(routes.conversations, "RAG_ENABLED", True)
    # Patch RAG_ENABLED in any module already imported that copied the value at import time
    _RAG_ENABLED_MODULES = {
        "rag_service",
        "messages",
        "routes.pages",
        "routes.chat",
        "tool_registry",
        "db",
    }
    for _mod_name in _RAG_ENABLED_MODULES:
        _mod = sys.modules.get(_mod_name)
        if _mod is not None and hasattr(_mod, "RAG_ENABLED"):
            monkeypatch.setattr(_mod, "RAG_ENABLED", True)

    fake_client = FakeChromaClient()
    rag_store._client = None
    rag_store._collection_cache = {}
    monkeypatch.setattr(rag_store, "get_client", lambda: fake_client)
    monkeypatch.setattr(rag_store, "embed_texts", fake_embed_texts)
    model_registry.get_provider_client.cache_clear()
    # Populate the LRU cache with a test client so that resolve_model_target()
    # (used by agent/agent.py and routes/conversations.py) returns a real client
    # object without network access.  The module-level `client` aliases in
    # agent.agent and routes.conversations are legacy and no longer referenced
    # by production code paths, so we do NOT patch them.
    model_registry.get_provider_client(model_registry.DEEPSEEK_PROVIDER)
    yield
    rag_store._client = None
    rag_store._collection_cache = {}
    model_registry.get_provider_client.cache_clear()


@pytest.fixture
def app(tmp_path, monkeypatch):
    from core.app import create_app

    # Re-patch RAG_ENABLED — the module-level app = create_app() at core/app.py
    # (triggered by the import above) resets patches applied by earlier fixtures.
    import core.config as _config
    import routes.conversations as _conversations

    monkeypatch.setattr(_config, "RAG_ENABLED", True)
    monkeypatch.setattr(_conversations, "RAG_ENABLED", True)

    monkeypatch.setattr(_config, "LOGIN_PIN", "")
    app_instance = create_app(database_path=str(tmp_path / "test.db"), load_persisted_runtime_settings=False)
    app_instance.config.update(TESTING=True)
    return app_instance


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def create_conversation(client):
    def _factory(title: str = "Test Chat") -> int:
        response = client.post(
            "/api/conversations",
            json={"title": title, "model": "deepseek-chat"},
        )
        assert response.status_code == 201
        payload = response.get_json()
        assert isinstance(payload, dict)
        return int(payload["id"])

    return _factory


@pytest.fixture
def session_csrf_token(client) -> str:
    client.get("/")
    with client.session_transaction() as session_data:
        return str(session_data.get(request_security.CSRF_TOKEN_SESSION_KEY) or "")