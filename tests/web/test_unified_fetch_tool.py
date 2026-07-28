from __future__ import annotations

from agent import agent as agent_module


def test_fetch_url_content_mode_returns_fetched_content(monkeypatch):
    calls = []

    def fake_fetch(url, *, compress=True):
        calls.append((url, compress))
        return {"url": url, "title": "Example", "content": "page text"}

    monkeypatch.setattr(agent_module, "fetch_url_tool", fake_fetch)

    result, _ = agent_module._run_fetch_url(
        {"url": "https://example.com", "output_mode": "content", "compress": False},
        {},
    )

    assert result["content"] == "page text"
    assert calls == [("https://example.com", False)]


def test_fetch_url_summary_mode_uses_focused_summarizer(monkeypatch):
    monkeypatch.setattr(
        agent_module,
        "fetch_url_tool",
        lambda url, *, compress=True: {"url": url, "title": "Example", "content": "page text"},
    )
    monkeypatch.setattr(
        agent_module,
        "_summarize_fetched_page_result",
        lambda result, focus, **kwargs: (
            {"url": result["url"], "title": result["title"], "focus": focus, "summary": "focused summary"},
            "Page summarized",
        ),
    )

    result, summary = agent_module._run_fetch_url(
        {"url": "https://example.com", "output_mode": "summary", "focus": "risks"},
        {"agent_context": {"model": "test-model"}},
    )

    assert result["summary"] == "focused summary"
    assert result["focus"] == "risks"
    assert summary == "Page summarized"
