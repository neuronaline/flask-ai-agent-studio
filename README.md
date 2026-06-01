# Flask ChatBot: Multi-Provider + Tools + RAG + Multimodal + Canvas

> **AI-Assisted Development Notice:** This project was developed with AI assistance. All code, architecture decisions, and documentation have been written, reviewed, and validated by humans. Every line has passed human review before inclusion.

A feature-rich, single-page Flask chat application designed for advanced LLM interactions. It supports multiple providers (DeepSeek, OpenRouter, MiniMax), complex multi-step tool usage, Local RAG, persistent memory, multimodal inputs (Vision/OCR), and an interactive Canvas/Workspace environment. 

Unlike basic prompt/response wrappers, this app persists deep conversation states in SQLite, supports branch regeneration, streams reasoning/tool traces, and features a robust prompt-budgeting system.

---

## 🌟 Core Features

*   **Models & Routing:** Native support for DeepSeek and MiniMax, plus full OpenRouter integration (with proxy rotation, provider scoping, and model capability detection).
*   **Persistent Memory & RAG:** Conversation-scoped memory, persona-scoped memory, persistent scratchpads, and a local ChromaDB-backed RAG system for document and chat history retrieval.
*   **Multimodal & Attachments:** Document extraction (PDF, DOCX, CSV, Code) and Image processing via local OCR (PaddleOCR), Vision LLMs, or direct multimodal injection.
*   **Canvas & Workspace:** An interactive UI panel for the model to create, edit, search, and manage markdown or code documents. Includes project-mode for local file sandbox execution.
*   **Advanced Chat Controls:** Slash commands (`/check`), message editing/branching, automatic summarization, and entropy-aware context selection.
*   **SERP API Backend:** Web search, news, scholar, and URL fetching are now powered by a hosted [SERP REST API](https://github.com/neuronaline/serp-scraper) — no local Chrome browser or proxy configuration required. The API is free for anyone to use.
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
bash scripts/install.sh
```
*The interactive installer configures your environment, selects hardware profiles (CPU/CUDA), and downloads required models (like BGE-M3 for RAG).*

### Manual Setup
1. **Environment:**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. **Dependencies:**
   \`\`\`bash
   pip install -r requirements.txt
   \`\`\`
   *Optional features (RAG, OCR, YouTube): edit requirements.txt and uncomment the relevant section, then re-run pip install.*
3. **Configuration:**
   Copy `.env.example` to `.env` and add at least one API key:
   ```env
   DEEPSEEK_API_KEY=your-key
   OPENROUTER_API_KEY=your-key
   MINIMAX_API_KEY=your-key
   ```
4. **Run:**
   ```bash
   python core/app.py
   # Access at http://127.0.0.1:5000
   ```

---

## ⚙️ Configuration (Environment Variables)

Most app settings can be dynamically changed via the `/settings` UI and are stored in SQLite. The following environment variables dictate core infrastructure:

### Core & Security
| Variable | Default | Description |
| --- | --- | --- |
| `FLASK_SECRET_KEY` | required | Secret key for Flask sessions. |
| `LOGIN_PIN` | empty | Enables basic PIN-based authentication if set. |
| `FORCE_HTTPS` | `false` | Redirects HTTP to HTTPS (requires reverse proxy). |
| `AGENT_TRACE_LOG_ENABLED` | `true` | Enables JSON-lines trace logging. |

### Storage Directories
| Variable | Default | Description |
| --- | --- | --- |
| `IMAGE_STORAGE_DIR` | `./data/images` | Uploaded images. |
| `DOCUMENT_STORAGE_DIR`| `./data/documents` | Uploaded documents. |
| `PROJECT_WORKSPACE_ROOT`|`./data/workspaces`| Sandboxes for workspace tools. |
| `CHROMA_DB_PATH` | `./chroma_db` | RAG vector database persistence. |

### RAG & AI Features
| Variable | Default | Description |
| --- | --- | --- |
| `RAG_ENABLED` | `true` | Enables knowledge-base features. |
| `RAG_EMBED_MODEL` | `BAAI/bge-m3` | Embedding model to use. |
| `BGE_M3_DEVICE` | `auto` | Set to `cpu` or leave `auto` for CUDA. |
| `OCR_ENABLED` | `true` | Enables local PaddleOCR processing. |
| `YOUTUBE_TRANSCRIPTS_ENABLED` | `false` | Enables YouTube transcript extraction tool. |

*(Note: Prompt budgets, fetch limits, and UI parameters are manageable directly in the App's UI Settings page).*

---

## 🛠️ Available Tools (Agent Capabilities)

The LLM is equipped with a vast array of tools. Schemas are strictly validated before execution.
### Memory & Personalization
*   `save_to_conversation_memory` / `delete_conversation_memory_entry`: Manage short-term chat facts.
*   `save_to_persona_memory` / `delete_persona_memory_entry`: Manage cross-chat persona facts.
*   `append_scratchpad` / `replace_scratchpad` / `read_scratchpad`: Manage long-term durable user facts.
*   `ask_clarifying_question`: Halts execution to ask the user a structured question.
*   `image_explain`: Queries follow-up details about uploaded images.

### Knowledge Base & Search
*   `search_knowledge_base`: Semantic search over chats, docs, and tool results (RAG).
*   `search_web` / `search_news` / `search_news_google` / `search_scholar`: Web discovery and academic research — powered by the [SERP API](https://github.com/neuronaline/serp-scraper) (hosted backend, no local Chrome needed).
*   `fetch_url` / `fetch_url_summarized`: Fetch, clean, and summarize web pages.
*   `scroll_fetched_content` / `grep_fetched_content`: Browse and search previously fetched page content.

### Canvas & Document Editing
*   `create_canvas_document` / `delete_canvas_document` / `clear_canvas_viewport`: Document lifecycle.
*   `batch_canvas_edits` / `batch_read_canvas_documents`: Batch content and read operations.
*   `search_canvas_document`: Full-text search within canvas documents.
*   `set_canvas_viewport`: Pin a line range to the context window.

### Context & Memory Management
*   `list_context_summary` / `purge_context_nodes` / `merge_context_nodes` / `compress_context_node`: Inspect and manage the AI's context memory.
*   `expand_truncated_tool_result`: Request the full text of a truncated tool output.

---

## 🔌 HTTP API Endpoints

The backend provides a comprehensive REST API.

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
| `POST` | `/api/conversations/<id>/summarize` | Force history summarization. |
| `GET,POST` | `/api/conversations/<id>/export` | Export chat (MD, JSON, DOCX, PDF). |
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
| `GET` | `/api/rag/documents` | List ingested RAG documents. |
| `DELETE` | `/api/rag/documents/<key>` | Delete a RAG document. |
| `GET` | `/api/activity` | Paginated audit logs of LLM invocations. |
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
*   **Proxy Rotation Fails:** Ensure `proxies.txt` is formatted correctly (one per line, e.g., `http://ip:port`). Requires app restart.
*   **Image Uploads Blocked:** Ensure `OCR_ENABLED=true` OR that you have selected a Vision-capable model in the Settings page.

## License

MIT