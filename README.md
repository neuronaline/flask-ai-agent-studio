# Flask AI Agent Studio: Multi-Provider + Tools + RAG + Multimodal + Canvas

> **AI-Assisted Development Notice:** This project was developed with AI assistance. All code, architecture decisions, and documentation have been written, reviewed, and validated by humans. Every line has passed human review before inclusion.

A feature-rich, single-page Flask chat application designed for advanced LLM interactions. It supports multiple providers (DeepSeek, OpenRouter), complex multi-step tool usage, Local RAG, persistent memory, multimodal inputs (Vision/OCR), and an interactive Canvas/Workspace environment.

Unlike basic prompt/response wrappers, this app persists deep conversation states in SQLite, supports branch regeneration, streams reasoning/tool traces, and features a robust prompt-budgeting system.

---

## 🌟 Core Features

*   **Models & Routing:** Native support for DeepSeek, plus full OpenRouter integration (with proxy rotation, provider scoping, and model capability detection).
*   **Persistent Memory & RAG:** Conversation-scoped memory, persona-scoped memory, persistent scratchpads, and a local ChromaDB-backed RAG system for document and chat history retrieval.
*   **Multimodal & Attachments:** Document extraction (PDF, DOCX, CSV, Code) and Image processing via local OCR (PaddleOCR), Vision LLMs, or direct multimodal injection.
*   **Canvas & Workspace:** An interactive UI panel for the model to create, edit, search, and manage markdown or code documents. Includes project-mode for local file sandbox execution.
*   **Advanced Chat Controls:** Slash commands (`/check`), message editing/branching, automatic summarization, and entropy-aware context selection.
*   **Web Research:** Google and scholar discovery use Bright Data SERP; URL content extraction uses [PageFetch](https://github.com/neuronaline/pagefetch), configurable for HTTP, browser, or automatic mode.
*   **Observability:** Detailed usage panels, provider vs. local token estimates, caching diagnostics, and rotating agent trace logs.

## 📸 Screenshots

* [Tool execution](screenshots/Screenshot_2026-04-09_18-04-09.png)
* [Long-term memory (RAG)](screenshots/Screenshot_2026-04-09_18-05-21.png)
* [Canvas view](screenshots/Screenshot_2026-04-09_18-05-58.png)
* [Settings page](screenshots/Screenshot_2026-04-09_18-07-19.png)

---

## 🚀 Installation

### Quick Start
```bash
./scripts/install.sh
```
Installs a Python 3.9+ virtual environment, all dependencies, and prompts for API keys if `.env` placeholders are found. Add `--model` to also download the BGE-M3 RAG embedding model:
```bash
./scripts/install.sh --model
```

### Manual Setup
1. **Environment:**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. **Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
3. **Configuration:**
   Copy `.env.example` to `.env`, set a strong Flask secret, and add at least one model-provider key:
   ```env
   FLASK_SECRET_KEY=generate-a-long-random-value
   DEEPSEEK_API_KEY=your-key
   OPENROUTER_API_KEY=your-key
   ```
4. **Run:**
   ```bash
   python core/app.py
   # Access at http://127.0.0.1:5000
   ```

### Uninstall
```bash
./scripts/uninstall.sh        # Remove virtual environment, keep data
./scripts/uninstall.sh --full # Remove everything (models, database, workspaces)
```

### Systemd Service
```bash
sudo ./scripts/install_systemd_service.sh
```
Requires a completed installation and virtual environment. Creates and enables a systemd service on port 5000.

> **Note:** The deprecated `run.sh` script has been removed. Use `python core/app.py` directly.

---

## ⚙️ Configuration

Copy `.env.example` to `.env` and set a Flask secret plus at least one model-provider key. `LOGIN_PIN` is optional. All non-secret application preferences belong in the `/settings` UI and are stored in SQLite.

### Web Research

Web-search tools require a Bright Data SERP API key and zone. URL fetching is a separate PageFetch integration; it works without Bright Data credentials but always applies the app's SSRF protections.

```env
BRIGHT_DATA_API_KEY=your-bright-data-api-key
BRIGHT_DATA_SERP_ZONE=your-serp-zone
```

Set Bright Data search language, country, and timeout from **Settings → Tools**. PageFetch mode, proxy provider (Decodo / DataImpulse), credentials, and tuning options are configured in `proxy.yaml`; copy `proxy.example.yaml` to get started.

---

## 🛠️ Available Tools (Agent Capabilities)

The LLM is equipped with a vast array of tools. Schemas are strictly validated before execution.
### Memory & Personalization
*   `save_to_conversation_memory` / `delete_conversation_memory_entry`: Manage short-term chat facts.
*   `save_to_persona_memory` / `delete_persona_memory_entry`: Manage cross-chat persona facts.
*   `append_scratchpad` / `replace_scratchpad` / `read_scratchpad`: Manage long-term durable user facts.
*   `ask_clarifying_question`: Halts execution to ask the user a structured question.

### Knowledge Base & Search
*   `search_knowledge_base`: Semantic search over chats, docs, and tool results (RAG).
*   `search_web` / `search_scholar`: Google and academic discovery through Bright Data SERP.
*   `fetch_url`: Fetch cleaned URL content or a focused AI summary through [PageFetch](https://github.com/neuronaline/pagefetch).

### Canvas & Document Editing
*   `create_canvas_document` / `delete_canvas_document`: Document lifecycle.
*   `batch_canvas_edits`: Full-content replacement and localized replace, insert, or delete operations.
*   `read_canvas_document` / `batch_read_canvas_documents`: Single and batch document reads.
*   `search_canvas_document`: Full-text search within canvas documents.

### Code & File Operations
*   `delegate_task`: Delegate a sub-task to a sub-agent with isolated context.

### YouTube & Media
*   `transcribe_youtube_video`: Extract transcript from YouTube videos.

### Context & Memory Management
*   `expand_truncated_tool_result`: Request the full text of a truncated tool output.

---

## 🔌 HTTP API Endpoints

The backend exposes the following application endpoints. State-changing requests use the app's session and CSRF protections.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/chat` | Main streamed chat endpoint (NDJSON format). |
| `POST` | `/api/chat-runs/<id>/cancel` | Gracefully halt streaming generation. |
| `POST` | `/api/fix-text` | Fix/improve selected text via LLM. |
| `GET` | `/api/conversations` | List all conversations. |
| `GET` | `/api/conversations/<id>` | Load specific conversation history. |
| `POST` | `/api/conversations` | Create a new conversation. |
| `PATCH` | `/api/conversations/<id>` | Update conversation metadata. |
| `DELETE` | `/api/conversations/<id>` | Delete a conversation. |
| `POST` | `/api/conversations/<id>/compact-context` | Explicitly replace the active context ledger with a validated compact state. |
| `POST` | `/api/conversations/<id>/generate-title` | Generate a conversation title. |
| `GET,POST` | `/api/conversations/<id>/export` | Export chat (MD, JSON, DOCX, PDF). |
| `GET` | `/api/conversations/<id>/canvas/export` | Export a canvas document. |
| `POST,PATCH,DELETE` | `/api/conversations/<id>/canvas` | Create, update, or delete canvas documents. |
| `PATCH` | `/api/messages/<id>` | Edit/rewrite a message. |
| `DELETE` | `/api/messages/<id>` | Delete a message. |
| `GET,POST` | `/login` | PIN-based authentication page. |
| `POST` | `/logout` | End authenticated session. |
| `GET` | `/api/settings` | Read all runtime settings. |
| `PATCH` | `/api/settings` | Update runtime settings. |
| `GET` | `/api/personas` | List all personas. |
| `POST` | `/api/personas` | Create a new persona. |
| `GET` | `/api/rag/search` | Search ChromaDB via REST. |
| `POST` | `/api/rag/ingest` | Upload external documents to RAG. |
| `POST` | `/api/rag/upload-metadata` | Suggest metadata for an RAG upload. |
| `POST` | `/api/rag/sync-conversations` | Synchronize conversation content to RAG. |
| `GET` | `/api/rag/documents` | List ingested RAG documents. |
| `DELETE` | `/api/rag/documents/<key>` | Delete a RAG document. |
| `GET` | `/api/activity` | Paginated audit logs of LLM invocations. |
| `GET` | `/api/activity/<id>` | Read an activity record. |
| `POST` | `/api/activity/purge-expired` | Remove expired activity records. |

---

## 🏗️ Architecture & Storage

*   **Caching Strategy:** Context is structured to keep system prompts static at the top, volatile data (time, tool traces) at the bottom. This maximizes provider-side prompt caching (Anthropic, DeepSeek, Gemini).
*   **Databases:** 
    *   **SQLite** (`chatbot.db`): Stores conversations, messages, settings, user profiles, assets, and tool memory.
    *   **ChromaDB**: Stores embeddings for RAG document retrieval.
*   **Assets:** Images and parsed documents are stored safely in `./data/`.
*   **Workspaces:** Project files managed by the LLM are stored in `./data/workspaces/`.

---

## 🛡️ Security & Operations

*   **Production Deployment:** It is highly recommended to run behind a reverse proxy (Nginx/Caddy) with HTTPS. Set `FORCE_HTTPS=true` and `SESSION_COOKIE_SECURE=true`.
*   **Rate Limiting:** Supports local memory limiting, or shared state via `SECURITY_RATE_LIMIT_REDIS_ENABLED`.
*   **SSRF Protection:** Web fetching tools (`fetch_url`) block localhost and private IP addresses by default.
*   **Sanitization:** Markdown and HTML outputs are sanitized before browser rendering.

---

## ❓ Troubleshooting

*   **CUDA/GPU Errors:** If RAG or OCR crashes due to GPU issues, set `BGE_M3_DEVICE=cpu` and ensure `OCR_ENABLED=false` (or install the CPU version of PaddlePaddle).
*   **PageFetch Proxy Fails:** Check your proxy settings in `proxy.yaml`. For provider-specific issues, verify the `decodo_url` or `dataimpulse_url` value.
*   **Image Uploads Blocked:** Ensure `OCR_ENABLED=true` OR that you have selected a Vision-capable model in the Settings page.

## License

MIT
