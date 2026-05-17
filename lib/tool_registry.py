from __future__ import annotations

import copy
import json

from core.config import (
    CLARIFICATION_DEFAULT_MAX_QUESTIONS,
    CLARIFICATION_QUESTION_LIMIT_MAX,
    CLARIFICATION_QUESTION_LIMIT_MIN,
    CONVERSATION_MEMORY_ENABLED,
    DEFAULT_SEARCH_TOOL_QUERY_LIMIT,
    RAG_ENABLED,
    SEARCH_TOOL_QUERY_LIMIT_MAX,
    SEARCH_TOOL_QUERY_LIMIT_MIN,
    SCRATCHPAD_SECTION_METADATA,
    SCRATCHPAD_SECTION_ORDER,
)
from services.canvas_service import get_canvas_document_capabilities

SCRATCHPAD_SECTION_ENUM = list(SCRATCHPAD_SECTION_ORDER)
SCRATCHPAD_SECTION_DESCRIPTION = "Section to update: " + "; ".join(
    f"{section_id} = {SCRATCHPAD_SECTION_METADATA[section_id]['title']} ({SCRATCHPAD_SECTION_METADATA[section_id]['description']})"
    for section_id in SCRATCHPAD_SECTION_ORDER
)
CANVAS_LINE_ARRAY_DESCRIPTION = (
    "Each element is one line of text as a properly quoted JSON string with no trailing newline characters. "
    "Code content, including quotes, backslashes, and semicolons, must appear inside these strings and be properly escaped. "
    'Example: ["const char* ssid = \\"MyNet\\";", "const char* pass = \\"abc\\";"] . '
    "Never place code outside this array or as an argument key."
)


# Pre-computed constant instead of calling a function each time
CANVAS_EDIT_OPERATION_VARIANTS: list[dict] = [
    {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["replace"],
                "description": "Replace an inclusive 1-based line range.",
            },
            "start_line": {"type": "integer", "minimum": 1, "description": "1-based first line to replace."},
            "end_line": {"type": "integer", "minimum": 1, "description": "1-based last line to replace."},
            "lines": {"type": "array", "items": {"type": "string"}, "description": CANVAS_LINE_ARRAY_DESCRIPTION},
            "expected_start_line": {
                "type": "integer",
                "minimum": 1,
                "description": "Optional first line of the current snippet that must still match before applying the edit.",
            },
            "expected_lines": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional current lines that must still match before applying the edit.",
            },
        },
        "required": ["action", "start_line", "end_line", "lines"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["insert"],
                "description": "Insert new lines after a specific anchor line.",
            },
            "after_line": {
                "type": "integer",
                "minimum": 0,
                "description": "Insert after this line number. Use 0 to insert before line 1 at the top of the file.",
            },
            "lines": {"type": "array", "items": {"type": "string"}, "description": CANVAS_LINE_ARRAY_DESCRIPTION},
            "expected_start_line": {
                "type": "integer",
                "minimum": 1,
                "description": "Optional first line of the current snippet that must still match before applying the insert.",
            },
            "expected_lines": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional nearby current lines that must still match before applying the insert.",
            },
        },
        "required": ["action", "after_line", "lines"],
        "additionalProperties": False,
    },
    {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["delete"],
                "description": "Delete an inclusive 1-based line range.",
            },
            "start_line": {"type": "integer", "minimum": 1, "description": "1-based first line to delete."},
            "end_line": {"type": "integer", "minimum": 1, "description": "1-based last line to delete."},
            "expected_start_line": {
                "type": "integer",
                "minimum": 1,
                "description": "Optional first line of the current snippet that must still match before applying the delete.",
            },
            "expected_lines": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional current lines that must still match before applying the delete.",
            },
        },
        "required": ["action", "start_line", "end_line"],
        "additionalProperties": False,
    },
]


TOOL_SPECS = [
    {
        "name": "append_scratchpad",
        "description": (
            "Append one or more rare durable general facts to one section of the persistent scratchpad. "
            "Reserve this for cross-conversation memory only. If the detail is mainly about the current chat or task, save it to conversation memory instead. "
            "Do not store temporary task details, sensitive secrets, one-off requests, or speculative inferences."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "section": {
                    "type": "string",
                    "enum": SCRATCHPAD_SECTION_ENUM,
                    "description": SCRATCHPAD_SECTION_DESCRIPTION,
                },
                "notes": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of short durable facts to append. Each item must be a single standalone fact — do not bundle multiple facts into one item. Minimum 1 item.",
                    "minItems": 1,
                },
            },
            "required": ["section", "notes"],
        },
        "prompt": {
            "purpose": "Saves one or more short durable cross-conversation memory lines into a specific scratchpad section only when they are likely to matter later.",
            "inputs": {
                "section": "target section id such as preferences, profile, lessons, tasks, problems, notes, or domain",
                "notes": "list of single short durable memory lines — one fact per item",
            },
            "guidance": (
                "Use sparingly. Save only durable facts likely to matter in future conversations. "
                "If the information mainly belongs to the current chat, use conversation memory instead. "
                "Each item in `notes` must be a single short standalone fact."
            ),
        },
    },
    {
        "name": "replace_scratchpad",
        "description": (
            "Completely replace one section of the persistent scratchpad. "
            "Use this to rewrite, reorganize, or remove outdated durable general facts in a single section. "
            "Reserve scratchpad edits for cross-conversation memory, not current-chat state."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "section": {
                    "type": "string",
                    "enum": SCRATCHPAD_SECTION_ENUM,
                    "description": SCRATCHPAD_SECTION_DESCRIPTION,
                },
                "new_content": {
                    "type": "string",
                    "description": "The new content that will fully replace the selected scratchpad section.",
                },
            },
            "required": ["section", "new_content"],
        },
        "prompt": {
            "purpose": "Completely rewrites one structured scratchpad section.",
            "inputs": {
                "section": "target section id",
                "new_content": "the new complete content for that one section",
            },
            "guidance": (
                "Use carefully to prune or reorganize existing facts in one section. "
                "Keep the text compact. If the content is mainly about the current chat, use conversation memory instead."
            ),
        },
    },
    {
        "name": "read_scratchpad",
        "description": (
            "Read the current persistent scratchpad content across all sections exactly as stored. "
            "Use this when you need to inspect the live structured scratchpad before editing it."
        ),
        "parameters": {
            "type": "object",
            "properties": {},
            "required": [],
        },
        "prompt": {
            "purpose": "Reads the current structured scratchpad memory for inspection before editing.",
            "inputs": {},
            "guidance": (
                "Use this when you need to verify or quote the current durable memory before appending or replacing it. "
                "Prefer this before replace_scratchpad when you want to preserve existing facts."
            ),
        },
    },
    {
        "name": "ask_clarifying_question",
        "description": (
            "Ask the user one or more structured clarification questions and stop answering until they reply. "
            "Use this when key requirements are missing, ambiguous, or mutually dependent and you should not guess. "
            "If the user explicitly asks you to ask questions first before answering, use this tool instead of asking inline."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "intro": {"type": "string", "description": "Short lead-in shown before the questions."},
                "questions": {
                    "type": "array",
                    "description": "List of clarification questions.",
                    "minItems": 1,
                    "maxItems": CLARIFICATION_QUESTION_LIMIT_MAX,
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string", "description": "The question shown to the user."},
                            "options": {
                                "type": "array",
                                "description": "Selectable options. If omitted, user enters free text.",
                                "items": {"type": "string"},
                            },
                        },
                        "required": ["label"],
                    },
                },
                "submit_label": {"type": "string", "description": "Optional button label shown in the UI."},
            },
            "required": ["questions"],
        },
        "prompt": {
            "purpose": "Collects missing user requirements before continuing the answer.",
            "inputs": {
                "intro": "optional short lead-in",
                "questions": "structured questions",
                "submit_label": "optional button label",
            },
            "guidance": (
                "Use this instead of guessing when important requirements are missing. "
                "Ask only the smallest set of questions needed to continue. "
                "When the user asks you to ask questions first, this is the required tool. "
                "Put the actual question text only in the tool arguments, not in the assistant text. "
                "Keep the assistant-visible reply short and brief, and let the UI render the questions. "
                "When you call this tool, it must be the only tool call in that assistant message and you must wait for the user's reply before answering. "
                "Prefer single_select or multi_select when the likely answers are known, keep question ids short and unique, and use required=false for optional follow-ups. "
                "Use depends_on only for short follow-up branches that should stay hidden until a previous answer makes them relevant. "
                'Each questions item must be an object with id, label, and input_type; example: {"id":"scope","label":"Which scope?","input_type":"text"}. '
                "Use plain UI text only for intro, labels, placeholders, and options. Do not include Q:/A: prefixes, markdown bullets, XML/tag wrappers, code fences, or markers like <| and |>."
            ),
        },
    },
    {
        "name": "transcribe_youtube_video",
        "description": (
            "Normalize a YouTube URL, transcribe the video's speech locally, and return a prompt-ready transcript context block. "
            "Use this only when the user explicitly asks for a YouTube transcription or video-summary workflow and a URL is provided."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "YouTube URL to transcribe (watch, short, embed, or youtu.be format).",
                }
            },
            "required": ["url"],
        },
        "prompt": {
            "purpose": "Transcribes a YouTube video and returns transcript text plus a context block ready for prompt injection.",
            "inputs": {
                "url": "full YouTube URL",
            },
            "guidance": (
                "Call this when the user wants transcript-driven analysis from a YouTube link and no transcript is already available in the current turn. "
                "Do not call it for non-YouTube URLs. "
                "If the runtime reports missing dependencies or disabled feature flags, surface that error clearly and continue with alternatives."
            ),
        },
    },
    {
        "name": "search_knowledge_base",
        "description": (
            "Search the internal knowledge base indexed with RAG. "
            "Use this when the answer may exist in synced conversation history, stored tool outputs, or uploaded documents and you cannot answer reliably from the current context. "
            "Optionally filter by category. Use this for conversation, tool_result, or uploaded_document content. "
            "Avoid repeating semantically overlapping searches when one good result set already answers the question; unnecessary searches waste tokens."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Semantic search query for the knowledge base.",
                },
                "category": {
                    "type": "string",
                    "description": "Optional category filter: conversation, tool_result, or uploaded_document.",
                },
                "top_k": {
                    "type": "integer",
                    "description": "Maximum number of chunks to retrieve (1-12).",
                    "minimum": 1,
                    "maximum": 12,
                },
                "min_similarity": {
                    "type": "number",
                    "description": "Optional minimum similarity threshold between 0.0 and 1.0. Higher values trade recall for precision.",
                    "minimum": 0.0,
                    "maximum": 1.0,
                },
            },
            "required": ["query"],
        },
        "prompt": {
            "purpose": "Searches the internal RAG knowledge base built from files, URLs, notes, and conversations.",
            "inputs": {
                "query": "semantic search query",
                "category": "optional category",
                "top_k": "1-12 results",
                "min_similarity": "optional threshold 0.0-1.0",
            },
            "guidance": "Use category when the likely source type is clear, and use at most a few focused searches. Synthesize from returned chunks instead of retrying near-duplicate queries. If the current context is already sufficient, do not search again; unnecessary searches waste tokens.",
        },
    },
    {
        "name": "search_web",
        "description": (
            "Search the web using DuckDuckGo. Use this only when you need current information, external verification, or facts that are not already answerable from the current conversation. "
            "Provide one or more search queries. Do not pass max_results or other result-limit controls; the runtime already applies the search result cap."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "queries": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": f"List of search queries to run (1–{DEFAULT_SEARCH_TOOL_QUERY_LIMIT} queries).",
                    "minItems": 1,
                    "maxItems": DEFAULT_SEARCH_TOOL_QUERY_LIMIT,
                }
            },
            "additionalProperties": False,
            "required": ["queries"],
        },
        "prompt": {
            "purpose": "Runs a general web search and returns recent results.",
            "inputs": {"queries": f"1-{DEFAULT_SEARCH_TOOL_QUERY_LIMIT} search queries"},
            "guidance": (
                "search_web accepts only the queries array. Do not pass max_results, top_k, limit, or any other control arguments; the runtime already caps results. "
                f"Never pass more than {DEFAULT_SEARCH_TOOL_QUERY_LIMIT} queries in a single call. If you need more search terms, split them across multiple search_web calls. "
                "If the answer is already available from the current context or does not require external verification, do not search."
            ),
        },
    },
    {
        "name": "fetch_url",
        "description": (
            "Fetch and read the content of a specific web page. Returns cleaned text, metadata, and a page outline. "
            "Use after search_web when you actually need the page's exact content or source wording. "
            "For very large pages the content may be clipped to fit the token budget; "
            "when that happens the result includes an outline of the page sections plus preserved leading, middle, and trailing excerpts when space allows. "
            "If you need omitted sections or an exact passage from a clipped page, use scroll_fetched_content or grep_fetched_content after this tool."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Full URL of the page (must start with http:// or https://).",
                }
            },
            "required": ["url"],
        },
        "prompt": {
            "purpose": "Reads the cleaned content of a specific URL.",
            "inputs": {"url": "full http/https URL"},
            "guidance": (
                "Large pages are automatically clipped to stay within the token budget. "
                "When content is clipped the result shows a Page Outline of the section headings. "
                "The tool also tries to preserve a middle excerpt so important details are not biased toward only the start or end of the page. "
                "Do not fetch a page unless you actually need its exact content or source wording. "
                "Do not repeat the same URL in the same turn. "
                "If a long page will remain useful across later turns, fetch_url keeps the raw page text available for later scroll_fetched_content and grep_fetched_content calls without importing it into Canvas. "
                "Use scroll_fetched_content to browse omitted sections and grep_fetched_content to locate exact text in a clipped page. "
                "To recall content from a previously fetched URL across turns, store it in conversation memory."
            ),
        },
    },
    {
        "name": "fetch_url_summarized",
        "description": (
            "Fetch a specific web page, send the cleaned page text to a dedicated summarizer model, and return only the resulting clean summary. "
            "Use this when the parent assistant needs a concise distilled page summary instead of raw page text. "
            "The returned tool result intentionally hides the full fetched content from the parent assistant and favors dense sectioned summaries over raw excerpts."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Full URL of the page (must start with http:// or https://).",
                },
                "focus": {
                    "type": "string",
                    "description": "Optional question, angle, or topic to focus the summary on.",
                },
            },
            "required": ["url"],
        },
        "prompt": {
            "purpose": "Reads a URL and returns only an AI-generated summary of the page.",
            "inputs": {"url": "full http/https URL", "focus": "optional focus or question"},
            "guidance": (
                "Use this when you want the page distilled before it reaches you, such as long articles where only the key points matter. "
                "If focus is given, the summary should prioritize that question or angle. "
                "Expect short labeled sections with key facts, constraints, and any unresolved uncertainty the source still leaves open. "
                "Use fetch_url instead when you need raw extracted text, metadata, page outline details, exact wording from the source page, or later browsing via scroll_fetched_content / grep_fetched_content."
            ),
        },
    },
    {
        "name": "scroll_fetched_content",
        "description": (
            "Read a window of lines from the content of a previously fetched URL. "
            "Prefers already-fetched raw page text, but can also re-fetch the page live when cached content is unavailable. "
            "Use this to browse omitted sections of a long or clipped page without importing it into Canvas."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL whose fetched content should be browsed; cached content is preferred and live refetch can be used when needed.",
                },
                "start_line": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Optional 1-based first line to show (default 1).",
                },
                "window_lines": {
                    "type": "integer",
                    "minimum": 20,
                    "maximum": 400,
                    "description": "Number of lines to return (20–400, default 120).",
                },
                "refresh_if_missing": {
                    "type": "boolean",
                    "description": "When true, automatically re-fetch the URL live if cached raw content is unavailable (default true).",
                },
            },
            "required": ["url"],
        },
        "prompt": {
            "purpose": "Browses a previously fetched page by returning a specific line window from its cached content.",
            "inputs": {
                "url": "URL to browse; cached content is preferred and live refetch can be used when needed",
                "start_line": "optional 1-based first line to show",
                "window_lines": "optional 20-400 line window size",
                "refresh_if_missing": "whether to re-fetch the page live when cached raw content is missing",
            },
            "guidance": (
                "Use this after fetch_url when the returned page text was clipped or when you want to inspect a large fetched source incrementally across later turns. "
                "Start with start_line=1 when you need the top of the page, then continue with the next window when the result reports more content below. "
                "Use grep_fetched_content first when you need to jump directly to a keyword, heading, code snippet, or exact passage instead of browsing sequentially. "
                "Use refresh_if_missing=false only when you explicitly need cache-only behavior."
            ),
        },
    },
    {
        "name": "grep_fetched_content",
        "description": (
            "Search for a keyword, phrase, or regex pattern inside the content of a previously fetched URL. "
            "Prefers already-fetched raw page text, but can also re-fetch the page live when cached content is unavailable. "
            "Returns matching lines with surrounding context. "
            "Use this instead of re-fetching the same URL when you need to find a specific value, code snippet, heading, or term."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL whose content to search; the tool can use cached content or re-fetch the page live when needed.",
                },
                "pattern": {
                    "type": "string",
                    "description": "Keyword, phrase, or Python regex pattern to search for (case-insensitive).",
                },
                "context_lines": {
                    "type": "integer",
                    "description": "Number of lines of context to include before and after each match (0–5, default 2).",
                    "minimum": 0,
                    "maximum": 5,
                },
                "max_matches": {
                    "type": "integer",
                    "description": "Maximum number of matches to return (1–30, default 20).",
                    "minimum": 1,
                    "maximum": 30,
                },
                "refresh_if_missing": {
                    "type": "boolean",
                    "description": "When true, automatically re-fetch the URL live if cached raw content is unavailable (default true).",
                },
            },
            "required": ["url", "pattern"],
        },
        "prompt": {
            "purpose": "Searches cached fetch_url content for a keyword, phrase, or regex.",
            "inputs": {
                "url": "URL to search; cached content is preferred and live refetch can be used when needed",
                "pattern": "keyword or regex",
                "context_lines": "0-5 lines of context (default 2)",
                "max_matches": "1-30 max results (default 20)",
                "refresh_if_missing": "whether to re-fetch the page live when cached raw content is missing",
            },
            "guidance": (
                "Prefer this over repeating fetch_url when you need exact wording from a page you already inspected. "
                "If raw cached content is missing, the tool can refresh the page live unless you explicitly disable refresh_if_missing. "
                "Use simple keywords for broad matches or anchored regex (e.g. r'price:\\s*\\d+') for precise values. "
                "Use refresh_if_missing=false only when you explicitly need cache-only behavior."
            ),
        },
    },
    {
        "name": "search_news_ddgs",
        "description": (
            "Search recent news articles using DuckDuckGo News. Returns title, link, publication time and source for each article. "
            "Use this only when the request needs current news coverage, external verification, or broad news discovery. "
            "Optionally filter by time range and language. If you need the full article text, follow up with fetch_url on the returned links."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "queries": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": f"List of news search queries (1–{DEFAULT_SEARCH_TOOL_QUERY_LIMIT}).",
                    "minItems": 1,
                    "maxItems": DEFAULT_SEARCH_TOOL_QUERY_LIMIT,
                },
                "lang": {
                    "type": "string",
                    "enum": ["tr", "en"],
                    "description": "Search language/region. 'tr' for Turkish results, 'en' for English.",
                },
                "when": {
                    "type": "string",
                    "enum": ["d", "w", "m", "y"],
                    "description": "Optional time filter: 'd'=last day, 'w'=last week, 'm'=last month, 'y'=last year.",
                },
            },
            "required": ["queries"],
        },
        "prompt": {
            "purpose": "Searches news headlines/links/dates/sources with DuckDuckGo News.",
            "inputs": {
                "queries": f"1-{DEFAULT_SEARCH_TOOL_QUERY_LIMIT} news queries",
                "lang": "tr|en",
                "when": "d|w|m|y",
            },
            "guidance": (
                "Use this for broad recent-news discovery when you actually need headlines, sources, and timestamps before reading full articles. "
                "Prefer this over search_news_google for generic international topics or the first pass on a topic. "
                f"Never pass more than {DEFAULT_SEARCH_TOOL_QUERY_LIMIT} queries in one call. If you need article details, follow up with fetch_url on the most relevant links instead of widening the same news query repeatedly. "
                "If the answer is already known or does not require current news verification, do not search."
            ),
        },
    },
    {
        "name": "search_news_google",
        "description": (
            "Search Google News via RSS feed. Returns title, link, publication time and source for each article. "
            "Use this only when the request needs current news coverage or current news verification and Google News coverage is specifically preferred, especially for Turkish financial news, local outlets, or when DuckDuckGo News yields weak coverage. "
            "Optionally filter by time range and language. If you need the full article text, follow up with fetch_url on the returned links."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "queries": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": f"List of news search queries (1–{DEFAULT_SEARCH_TOOL_QUERY_LIMIT}).",
                    "minItems": 1,
                    "maxItems": DEFAULT_SEARCH_TOOL_QUERY_LIMIT,
                },
                "lang": {
                    "type": "string",
                    "enum": ["tr", "en"],
                    "description": "Search language/region. 'tr' for Turkish results, 'en' for English.",
                },
                "when": {
                    "type": "string",
                    "enum": ["d", "w", "m", "y"],
                    "description": "Optional time filter: 'd'=last day, 'w'=last week, 'm'=last month, 'y'=last year.",
                },
            },
            "required": ["queries"],
        },
        "prompt": {
            "purpose": "Searches news headlines/links/dates/sources with Google News RSS.",
            "inputs": {
                "queries": f"1-{DEFAULT_SEARCH_TOOL_QUERY_LIMIT} news queries",
                "lang": "tr|en",
                "when": "d|w|m|y",
            },
            "guidance": (
                "Use this when Google News coverage is likely stronger than DuckDuckGo News for the topic or locale and the request genuinely needs current news verification. "
                f"Never pass more than {DEFAULT_SEARCH_TOOL_QUERY_LIMIT} queries in one call. After scanning the feed, fetch only the few links that are actually needed."
            ),
        },
    },
    {
        "name": "batch_read_canvas_documents",
        "description": (
            "Read multiple canvas documents or line ranges in one call. "
            "Use this to load full documents or specific line ranges for context."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "documents": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 12,
                    "description": "List of canvas documents or line ranges to read.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "document_id": {"type": "string", "description": "Optional target canvas document id."},
                            "document_path": {
                                "type": "string",
                                "description": "Optional target project-relative path. Prefer this in project mode.",
                            },
                            "start_line": {
                                "type": "integer",
                                "description": "Optional 1-based start line. Provide with end_line to read only a range.",
                            },
                            "end_line": {
                                "type": "integer",
                                "description": "Optional 1-based end line. Provide with start_line to read only a range.",
                            },
                            "max_lines": {
                                "type": "integer",
                                "description": "Optional max line budget for this request.",
                            },
                        },
                    },
                }
            },
            "required": ["documents"],
        },
        "prompt": {
            "purpose": "Loads several canvas documents or targeted ranges in a single tool call.",
            "inputs": {"documents": "array of document selectors with optional start_line/end_line/max_lines"},
            "guidance": (
                "Use this when reasoning depends on several open files at once. "
                "For each entry, omit start_line and end_line to expand the document excerpt, or provide both to read only a focused range. "
                "In project mode, prefer document_path over document_id when possible."
            ),
        },
    },
    {
        "name": "search_canvas_document",
        "description": (
            "Search the active canvas document, or all open canvas documents, for literal text or a regex pattern. "
            "Use this before batch_read_canvas_documents when you first need to locate the relevant region."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Query string to search for, interpreted according to match_type."},
                "document_id": {
                    "type": "string",
                    "description": "Optional target canvas document id. Defaults to the active document when all_documents is false.",
                },
                "document_path": {
                    "type": "string",
                    "description": "Optional target project-relative path. Prefer this in project mode.",
                },
                "all_documents": {
                    "type": "boolean",
                    "description": "Search across all open canvas documents instead of only the active or explicitly targeted one.",
                },
                "match_type": {
                    "type": "string",
                    "enum": ["text", "regex", "glob", "find"],
                    "description": "How to interpret the query: 'text' for literal substring, 'regex' for regex pattern, 'glob' for fnmatch-style wildcard, 'find' for line-start match.",
                },
                "case_sensitive": {"type": "boolean", "description": "Whether the search should be case-sensitive."},
                "context_lines": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 10,
                    "description": "Optional number of context lines to include above and below each match. Defaults to 0.",
                },
                "offset": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "Optional match offset for pagination. Defaults to 0.",
                },
                "max_results": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 50,
                    "description": "Maximum number of matches to return. Defaults to 10.",
                },
            },
            "required": ["query"],
        },
        "prompt": {
            "purpose": "Finds where text or patterns appear inside canvas documents without loading more lines than necessary.",
            "inputs": {
                "query": "search query string",
                "document_id": "optional target id",
                "document_path": "optional target project-relative path",
                "all_documents": "optional boolean to search all open canvas documents",
                "match_type": "text, regex, glob, or find",
                "case_sensitive": "optional boolean",
                "max_results": "optional result limit",
            },
            "guidance": (
                "Use this first when the user asks you to find something inside a large canvas or when you do not yet know which lines matter. "
                "After locating the right lines, use batch_read_canvas_documents with start_line and end_line for the smallest relevant window. "
                "In project mode, prefer document_path over document_id when you know the file path."
            ),
        },
    },
    {
        "name": "create_canvas_document",
        "description": (
            "Create a canvas document for the current conversation. Use one document per file or editable artifact."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Required document title shown in the canvas panel. Never omit it. If path is set, this should usually match the filename or basename.",
                },
                "content": {
                    "type": "string",
                    "description": (
                        "Full document content. "
                        "For format='code' documents this is raw source code without any markdown wrapper — no triple-backtick fences. "
                        "For format='markdown' documents this is the markdown body."
                    ),
                },
                "format": {
                    "type": "string",
                    "enum": ["markdown", "code"],
                    "description": "Canvas document format. Use code for a raw code document without markdown wrappers.",
                },
                "language": {
                    "type": "string",
                    "description": "Optional dominant code language for the document, such as python, javascript, or sql.",
                },
                "path": {
                    "type": "string",
                    "description": "Optional project-relative path such as src/app.py, README.md, or tests/test_app.py.",
                },
                "role": {
                    "type": "string",
                    "enum": ["source", "config", "dependency", "docs", "test", "script", "note"],
                    "description": "Optional semantic role for the document inside a project workspace.",
                },
                "summary": {
                    "type": "string",
                    "description": "Optional short semantic summary of the document's responsibility.",
                },
                "imports": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional imported modules, files, or config keys referenced by this document.",
                },
                "exports": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional exported entry points, functions, classes, or files produced by this document.",
                },
                "symbols": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional important symbols defined in this document.",
                },
                "dependencies": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional package or file dependencies associated with this document.",
                },
                "project_id": {
                    "type": "string",
                    "description": "Optional stable project identifier grouping related canvas documents.",
                },
                "workspace_id": {
                    "type": "string",
                    "description": "Optional stable workspace identifier grouping related canvas documents.",
                },
            },
            "required": ["title", "content"],
        },
        "prompt": {
            "purpose": "Creates an editable canvas document attached to the conversation, optionally as part of a project workspace.",
            "inputs": {
                "title": "required document title; if path is known, usually reuse its basename or filename label",
                "content": "full document body (raw source code for code format; markdown body for markdown format — no fences around code)",
                "format": "markdown or code — set code for source files, scripts, configs, and any file with a code extension",
                "language": "dominant code language e.g. python, cpp, javascript, bash, sql; auto-inferred from path extension if omitted",
                "path": "optional project-relative file path e.g. src/app.py, sketch.ino, config.yaml",
                "role": "optional semantic document role",
                "summary": "optional short responsibility summary",
                "imports": "optional referenced modules, files, or config keys",
                "exports": "optional exported entry points or files",
                "symbols": "optional key symbols defined in the document",
                "dependencies": "optional package or file dependencies",
                "project_id": "optional project identifier",
                "workspace_id": "optional workspace identifier",
            },
            "guidance": (
                "Always include title. Never omit it. "
                "If path is provided, set title from that path's basename or user-facing file label (for example src/app.py -> app.py). "
                "If there is no path yet, still provide a concise artifact name such as README.md, Release Plan, or Draft Notes. "
                "For source code files, always set format='code' and language so the document renders with syntax highlighting. "
                "If path is provided (e.g. sketch.ino, src/main.py), format and language are inferred automatically — you can omit them. "
                "The content field must contain raw code — do NOT wrap it in triple-backtick fences. "
                "Prefer creating the document before line-level edits. "
                "Keep one file or artifact per canvas document instead of bundling multiple files together. "
                "Once the document exists, prefer localized line edits for partial changes. "
                "In project mode, set path, role, and ideally summary so the workspace manifest stays coherent."
            ),
        },
    },
    {
        "name": "batch_canvas_edits",
        "description": "Apply multiple non-overlapping line edit operations to one canvas document in a single call.",
        "parameters": {
            "type": "object",
            "properties": {
                "document_id": {
                    "type": "string",
                    "description": "Optional target canvas document id. Defaults to the active document when document_path is omitted.",
                },
                "document_path": {
                    "type": "string",
                    "description": "Optional target project-relative path. Prefer this over document_id in project mode.",
                },
                "operations": {
                    "type": "array",
                    "description": "Ordered list of non-overlapping replace, insert, or delete operations to apply against the same document snapshot.",
                    "minItems": 1,
                    "items": {"oneOf": CANVAS_EDIT_OPERATION_VARIANTS},
                },
                "targets": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Optional multi-document mode. Each target must include operations and may include document_id or document_path.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "document_id": {"type": "string", "description": "Optional target canvas document id."},
                            "document_path": {
                                "type": "string",
                                "description": "Optional target project-relative path. Prefer this in project mode.",
                            },
                            "operations": {
                                "type": "array",
                                "minItems": 1,
                                "items": {"oneOf": CANVAS_EDIT_OPERATION_VARIANTS},
                                "description": "Ordered list of non-overlapping replace, insert, or delete operations for this target.",
                            },
                        },
                        "required": ["operations"],
                    },
                },
                "atomic": {
                    "type": "boolean",
                    "description": "When true, restore the original document or documents if any operation in the batch fails.",
                },
            },
            "anyOf": [{"required": ["operations"]}, {"required": ["targets"]}],
        },
        "prompt": {
            "purpose": "Applies multiple disjoint line edits to one or more canvas documents in a single call.",
            "inputs": {
                "document_id": "optional target id",
                "document_path": "optional target project-relative path",
                "operations": "ordered edit operations for one document",
                "targets": "optional multi-document target array",
                "atomic": "optional rollback flag",
            },
            "guidance": (
                "Use this when you already know several non-overlapping edits for one document or multiple documents. "
                "Every operation must target a disjoint region or insertion anchor. "
                "Every operation must be a plain JSON object with an action field set to replace, insert, or delete. "
                "Do not nest a single operation inside an extra array or wrapper object. "
                "For replace use start_line, end_line, and lines. For insert use after_line and lines. For delete use start_line and end_line. "
                "Line numbers are interpreted against the pre-batch document and adjusted automatically for earlier operations in the same batch. "
                "When you are editing from a previously seen snippet, include expected_lines and expected_start_line on each operation so stale edits are rejected safely. "
                "Use targets when multiple files should change together. In project mode, prefer document_path when possible."
            ),
        },
    },
    {
        "name": "set_canvas_viewport",
        "description": "Pin a text line range from a text-addressable canvas document so it is automatically injected into later prompts for a limited number of turns.",
        "parameters": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string", "description": "Optional target canvas document id."},
                "document_path": {
                    "type": "string",
                    "description": "Optional target project-relative path. Prefer this over document_id in project mode.",
                },
                "start_line": {"type": "integer", "minimum": 1, "description": "1-based first line to pin."},
                "end_line": {"type": "integer", "minimum": 1, "description": "1-based last line to pin."},
                "ttl_turns": {
                    "type": "integer",
                    "minimum": 0,
                    "description": "How many future turns to keep the viewport pinned. Use 0 to keep it pinned until explicitly cleared. Ignored when permanent=true.",
                },
                "permanent": {
                    "type": "boolean",
                    "description": "When true, pin the viewport until explicitly cleared and ignore ttl_turns.",
                },
                "auto_unpin_on_edit": {
                    "type": "boolean",
                    "description": "When true, automatically clear the viewport if an overlapping edit changes that region.",
                },
            },
            "required": ["start_line", "end_line"],
        },
        "prompt": {
            "purpose": "Pins a canvas range for automatic reuse in subsequent prompts.",
            "inputs": {
                "document_id": "optional target id",
                "document_path": "optional target project-relative path",
                "start_line": "viewport start",
                "end_line": "viewport end",
                "ttl_turns": "number of future turns to keep it pinned",
                "permanent": "pin until explicitly cleared",
                "auto_unpin_on_edit": "whether overlapping edits clear it automatically",
            },
            "guidance": "Use this only for text-addressable canvas documents when you expect to keep working in the same known line range for multiple turns and want to avoid repeated scroll or expand calls. Use permanent=true when the range should stay pinned until you explicitly clear it.",
        },
    },
    {
        "name": "clear_canvas_viewport",
        "description": "Clear one pinned canvas viewport or all pinned viewports.",
        "parameters": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string", "description": "Optional target canvas document id."},
                "document_path": {
                    "type": "string",
                    "description": "Optional target project-relative path. When omitted with document_id, clears all viewports.",
                },
            },
        },
        "prompt": {
            "purpose": "Removes one or all pinned canvas viewports.",
            "inputs": {"document_id": "optional target id", "document_path": "optional target project-relative path"},
            "guidance": "Use this when a pinned viewport is no longer useful or should stop consuming prompt space. If both document_id and document_path are omitted, the tool clears all pinned viewports.",
        },
    },
    {
        "name": "delete_canvas_document",
        "description": "Delete one or more canvas documents, including obsolete or superseded ones. Use the documents array for batch delete, or provide document_id/document_path for a single delete. Defaults to the active document when document_id is omitted.",
        "parameters": {
            "type": "object",
            "properties": {
                "documents": {
                    "type": "array",
                    "description": "Array of documents to delete. Each entry should have document_id and/or document_path.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "document_id": {"type": "string", "description": "Canvas document id."},
                            "document_path": {"type": "string", "description": "Project-relative path."},
                        },
                    },
                },
                "document_id": {
                    "type": "string",
                    "description": "Optional target canvas document id. Defaults to the active document when documents is not provided.",
                },
                "document_path": {
                    "type": "string",
                    "description": "Optional target project-relative path. Prefer this over document_id in project mode.",
                },
            },
        },
        "prompt": {
            "purpose": "Deletes one or more canvas documents from the current conversation.",
            "inputs": {"documents": "optional array of {document_id, document_path}", "document_id": "optional target id", "document_path": "optional target project-relative path"},
            "guidance": "Use documents array for batch delete when multiple documents need to be removed. Use single document_id/document_path for single document deletion. Deletion is irreversible for the current conversation state.",
        },
    },
    {
        "name": "expand_truncated_tool_result",
        "description": "Retrieves the full uncropped content of a previously executed tool call that may have been truncated in the conversation history. Use this when you need complete details from an earlier tool execution whose result was cut off.",
        "parameters": {
            "type": "object",
            "properties": {
                "message_id": {
                    "type": "string",
                    "description": "The message ID of the assistant message that issued the tool call.",
                },
                "tool_call_id": {
                    "type": "string",
                    "description": "The tool call ID of the specific tool result to expand.",
                },
            },
            "required": ["message_id", "tool_call_id"],
        },
        "prompt": {
            "purpose": "Retrieves the full content of a previously executed tool call whose result was truncated.",
            "inputs": {"message_id": "the assistant message id", "tool_call_id": "the tool call id to expand"},
            "guidance": "Use this when a previous tool result was truncated and you need the complete output to proceed.",
        },
    },
]

TOOL_SPEC_BY_NAME = {tool["name"]: tool for tool in TOOL_SPECS}
SEARCH_QUERY_LIMITED_TOOL_NAMES = {"search_web", "search_news_ddgs", "search_news_google"}

_TOOL_RUNTIME_DEFAULTS = {
    "read_only": False,
    "parallel_safe": False,
    "exclusive_turn": False,
    "session_cacheable": False,
    "prompt_visible": True,
    "ui_hidden": False,
    "depends_on_tool_outputs": False,
    "state_domains": (),
    "requires_canvas_document": False,
    "requires_text_addressable_canvas": False,
    "requires_editable_canvas": False,
}

_TOOL_RUNTIME_METADATA_OVERRIDES = {
    "ask_clarifying_question": {
        "exclusive_turn": True,
        "state_domains": ("clarification",),
    },
    "set_conversation_title": {
        "ui_hidden": True,
        "prompt_visible": True,
        "state_domains": ("conversation",),
    },
    "list_context_summary": {
        "ui_hidden": True,
    },
    "purge_context_nodes": {
        "ui_hidden": True,
    },
    "archive_context_nodes": {
        "ui_hidden": True,
    },
    "get_context_node_detail": {
        "ui_hidden": True,
    },
    "transcribe_youtube_video": {
        "state_domains": ("video",),
    },
    "search_knowledge_base": {
        "read_only": True,
        "parallel_safe": True,
        "depends_on_tool_outputs": True,
        "state_domains": ("memory", "rag"),
    },
    "search_web": {
        "read_only": True,
        "parallel_safe": True,
        "session_cacheable": True,
        "state_domains": ("web",),
        "prompt_visible": False,
    },
    "fetch_url": {
        "read_only": True,
        "parallel_safe": True,
        "session_cacheable": True,
        "state_domains": ("web",),
    },
    "fetch_url_summarized": {
        "read_only": True,
        "parallel_safe": True,
        "state_domains": ("web",),
    },
    "scroll_fetched_content": {
        "read_only": True,
        "parallel_safe": True,
        "state_domains": ("web",),
    },
    "grep_fetched_content": {
        "read_only": True,
        "parallel_safe": True,
        "session_cacheable": True,
        "state_domains": ("web",),
    },
    "search_news_ddgs": {
        "read_only": True,
        "parallel_safe": True,
        "session_cacheable": True,
        "state_domains": ("web",),
    },
    "search_news_google": {
        "read_only": True,
        "parallel_safe": True,
        "session_cacheable": True,
        "state_domains": ("web",),
    },
    "batch_read_canvas_documents": {
        "read_only": True,
        "parallel_safe": True,
        "state_domains": ("canvas",),
        "requires_canvas_document": True,
        "requires_text_addressable_canvas": True,
    },
    "search_canvas_document": {
        "read_only": True,
        "parallel_safe": True,
        "state_domains": ("canvas",),
        "requires_canvas_document": True,
        "requires_text_addressable_canvas": True,
    },
    "batch_canvas_edits": {
        "state_domains": ("canvas",),
        "requires_canvas_document": True,
        "requires_text_addressable_canvas": True,
        "requires_editable_canvas": True,
    },
    "set_canvas_viewport": {
        "state_domains": ("canvas",),
        "requires_canvas_document": True,
        "requires_text_addressable_canvas": True,
    },
    "clear_canvas_viewport": {
        "state_domains": ("canvas",),
        "requires_canvas_document": True,
    },
    "delete_canvas_document": {
        "state_domains": ("canvas",),
        "requires_canvas_document": True,
    },
    "read_scratchpad": {
        "read_only": True,
        "parallel_safe": True,
        "state_domains": ("memory",),
    },
}


def _normalize_runtime_tool_name_list(values) -> list[str]:
    normalized: list[str] = []
    for raw_value in values or []:
        tool_name = str(raw_value or "").strip()
        if tool_name and tool_name not in normalized:
            normalized.append(tool_name)
    return normalized


def _coerce_runtime_tool_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if value in (None, ""):
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _build_tool_runtime_metadata() -> dict[str, dict]:
    metadata: dict[str, dict] = {}
    for tool in TOOL_SPECS:
        tool_name = str(tool.get("name") or "").strip()
        if not tool_name:
            continue
        entry = dict(_TOOL_RUNTIME_DEFAULTS)
        entry.update(_TOOL_RUNTIME_METADATA_OVERRIDES.get(tool_name, {}))
        entry["state_domains"] = tuple(dict.fromkeys(entry.get("state_domains") or ()))
        metadata[tool_name] = entry
    return metadata


TOOL_RUNTIME_METADATA = _build_tool_runtime_metadata()
WEB_TOOL_NAMES = frozenset(
    tool_name for tool_name, metadata in TOOL_RUNTIME_METADATA.items() if "web" in metadata.get("state_domains", ())
)
PARALLEL_SAFE_TOOL_NAMES = frozenset(
    tool_name for tool_name, metadata in TOOL_RUNTIME_METADATA.items() if metadata.get("parallel_safe") is True
)
PARALLEL_SAFE_READ_ONLY_TOOL_NAMES = tuple(
    tool_name
    for tool_name, metadata in TOOL_RUNTIME_METADATA.items()
    if metadata.get("parallel_safe") is True and metadata.get("read_only") is True
)
SESSION_CACHEABLE_TOOL_NAMES = frozenset(
    tool_name for tool_name, metadata in TOOL_RUNTIME_METADATA.items() if metadata.get("session_cacheable") is True
)
CANVAS_READ_BARRIER_TOOL_NAMES = frozenset(
    tool_name
    for tool_name, metadata in TOOL_RUNTIME_METADATA.items()
    if metadata.get("read_only") is True and "canvas" in metadata.get("state_domains", ())
)


def get_tool_runtime_metadata(tool_name: str) -> dict:
    normalized_tool_name = str(tool_name or "").strip()
    metadata = TOOL_RUNTIME_METADATA.get(normalized_tool_name)
    if metadata is None:
        return dict(_TOOL_RUNTIME_DEFAULTS)
    return dict(metadata)


def is_tool_parallel_safe(tool_name: str, tool_args: dict | None = None) -> bool:
    normalized_tool_name = str(tool_name or "").strip()
    metadata = TOOL_RUNTIME_METADATA.get(normalized_tool_name)
    if not metadata or metadata.get("parallel_safe") is not True:
        return False
    return True


def is_tool_session_cacheable(tool_name: str) -> bool:
    return get_tool_runtime_metadata(tool_name).get("session_cacheable") is True


def get_parallel_safe_tool_names(tool_names=None, *, read_only_only: bool = False) -> list[str]:
    normalized_tool_names = _normalize_runtime_tool_name_list(tool_names)
    if not normalized_tool_names:
        normalized_tool_names = list(TOOL_RUNTIME_METADATA.keys())
    return [
        tool_name
        for tool_name in normalized_tool_names
        if is_tool_parallel_safe(tool_name)
        and (not read_only_only or get_tool_runtime_metadata(tool_name).get("read_only") is True)
    ]


def get_prompt_visible_tool_names(tool_names=None) -> list[str]:
    normalized_tool_names = _normalize_runtime_tool_name_list(tool_names)
    return [
        tool_name
        for tool_name in normalized_tool_names
        if get_tool_runtime_metadata(tool_name).get("prompt_visible") is not False
    ]


def get_ui_hidden_tool_names(tool_names=None) -> list[str]:
    normalized_tool_names = _normalize_runtime_tool_name_list(tool_names)
    return [
        tool_name
        for tool_name in normalized_tool_names
        if get_tool_runtime_metadata(tool_name).get("ui_hidden") is True
    ]


def _normalize_clarification_max_questions(value: int | None) -> int:
    try:
        normalized = int(value) if value is not None else CLARIFICATION_DEFAULT_MAX_QUESTIONS
    except (TypeError, ValueError):
        normalized = CLARIFICATION_DEFAULT_MAX_QUESTIONS
    return max(CLARIFICATION_QUESTION_LIMIT_MIN, min(CLARIFICATION_QUESTION_LIMIT_MAX, normalized))


def _normalize_search_tool_query_limit(value: int | None) -> int:
    try:
        normalized = int(value) if value is not None else DEFAULT_SEARCH_TOOL_QUERY_LIMIT
    except (TypeError, ValueError):
        normalized = DEFAULT_SEARCH_TOOL_QUERY_LIMIT
    return max(SEARCH_TOOL_QUERY_LIMIT_MIN, min(SEARCH_TOOL_QUERY_LIMIT_MAX, normalized))


def _build_clarification_spec(tool: dict, clarification_max_questions: int | None = None) -> dict:
    spec = copy.deepcopy(tool)
    if spec.get("name") != "ask_clarifying_question":
        return spec

    limit = _normalize_clarification_max_questions(clarification_max_questions)
    parameters = spec.get("parameters") if isinstance(spec.get("parameters"), dict) else {}
    properties = parameters.get("properties") if isinstance(parameters.get("properties"), dict) else {}
    questions_schema = properties.get("questions") if isinstance(properties.get("questions"), dict) else {}
    questions_schema["maxItems"] = limit
    questions_schema["description"] = f"List of 1-{limit} clarification questions."
    properties["questions"] = questions_schema
    parameters["properties"] = properties
    spec["parameters"] = parameters

    prompt = spec.get("prompt") if isinstance(spec.get("prompt"), dict) else {}
    prompt_inputs = prompt.get("inputs") if isinstance(prompt.get("inputs"), dict) else {}
    prompt_inputs["questions"] = f"1-{limit} structured questions"
    prompt["inputs"] = prompt_inputs

    guidance = str(prompt.get("guidance") or "").strip()
    limit_note = f" Ask at most {limit} question(s) in a single call."
    if limit_note.strip() not in guidance:
        guidance = f"{guidance}{limit_note}".strip()
    prompt["guidance"] = guidance
    spec["prompt"] = prompt
    return spec


def _build_search_query_limit_spec(tool: dict, search_tool_query_limit: int | None = None) -> dict:
    spec = copy.deepcopy(tool)
    tool_name = str(spec.get("name") or "").strip()
    if tool_name not in SEARCH_QUERY_LIMITED_TOOL_NAMES:
        return spec

    limit = _normalize_search_tool_query_limit(search_tool_query_limit)
    limit_range = f"1-{limit}"
    parameters = spec.get("parameters") if isinstance(spec.get("parameters"), dict) else {}
    properties = parameters.get("properties") if isinstance(parameters.get("properties"), dict) else {}
    queries_schema = properties.get("queries") if isinstance(properties.get("queries"), dict) else {}
    queries_schema["maxItems"] = limit

    if tool_name == "search_web":
        queries_schema["description"] = f"List of search queries to run ({limit_range} queries)."
    else:
        queries_schema["description"] = f"List of news search queries ({limit_range})."

    properties["queries"] = queries_schema
    parameters["properties"] = properties
    spec["parameters"] = parameters

    prompt = spec.get("prompt") if isinstance(spec.get("prompt"), dict) else {}
    prompt_inputs = prompt.get("inputs") if isinstance(prompt.get("inputs"), dict) else {}
    if tool_name == "search_web":
        prompt_inputs["queries"] = f"{limit_range} search queries"
    elif tool_name in {"search_news_ddgs", "search_news_google"}:
        prompt_inputs["queries"] = f"{limit_range} news queries"
    prompt["inputs"] = prompt_inputs

    guidance = str(prompt.get("guidance") or "").strip()
    replacements = {
        "search_web": (
            "Never pass more than 5 queries in a single call. If you need more search terms, split them across multiple search_web calls. ",
            f"Never pass more than {limit} queries in a single call. If you need more search terms, split them across multiple search_web calls. ",
        ),
        "search_news_ddgs": (
            "Never pass more than 5 queries in one call. If you need article details, follow up with fetch_url on the most relevant links instead of widening the same news query repeatedly. ",
            f"Never pass more than {limit} queries in one call. If you need article details, follow up with fetch_url on the most relevant links instead of widening the same news query repeatedly. ",
        ),
        "search_news_google": (
            "Never pass more than 5 queries in one call. After scanning the feed, fetch only the few links that are actually needed.",
            f"Never pass more than {limit} queries in one call. After scanning the feed, fetch only the few links that are actually needed.",
        ),
    }
    old_text, new_text = replacements.get(tool_name, ("", ""))
    if old_text and old_text in guidance:
        guidance = guidance.replace(old_text, new_text)
    else:
        limit_note = f" Stay within the configured {limit_range} query limit for a single call."
        if limit_note.strip() not in guidance:
            guidance = f"{guidance}{limit_note}".strip()
    prompt["guidance"] = guidance
    spec["prompt"] = prompt
    return spec


def get_enabled_tool_specs(
    active_tool_names: list[str],
    clarification_max_questions: int | None = None,
    search_tool_query_limit: int | None = None,
) -> list[dict]:
    active_set = set(active_tool_names or [])
    specs = [tool for tool in TOOL_SPECS if tool["name"] in active_set]
    if not RAG_ENABLED:
        specs = [tool for tool in specs if tool["name"] != "search_knowledge_base"]
    if not CONVERSATION_MEMORY_ENABLED:
        specs = [
            tool
            for tool in specs
            if tool["name"] not in {"save_to_conversation_memory", "delete_conversation_memory_entry"}
        ]
    return [
        _build_search_query_limit_spec(
            _build_clarification_spec(tool, clarification_max_questions),
            search_tool_query_limit,
        )
        for tool in specs
    ]


def resolve_runtime_tool_names(
    active_tool_names: list[str],
    canvas_documents: list[dict] | None = None,
    *,
    disabled_tool_names: list[str] | None = None,
) -> list[str]:
    """Return the subset of active_tool_names that are available given current runtime state.

    Applies two types of gating:
    - Hard preconditions: Canvas document requirements.
    - User constraints: Tools explicitly disabled by user negative constraints.

    Tools disabled by user constraints are removed from the callable list entirely,
    rather than being handled via backend override errors.
    """
    names = list(active_tool_names or [])
    if not names:
        return []

    disabled_set = set(disabled_tool_names or [])

    has_canvas_documents = bool(canvas_documents)
    has_text_addressable_canvas_documents = any(
        get_canvas_document_capabilities(document)["line_addressable"]
        for document in (canvas_documents or [])
        if isinstance(document, dict)
    )
    has_editable_canvas_documents = any(
        get_canvas_document_capabilities(document)["editable"]
        for document in (canvas_documents or [])
        if isinstance(document, dict)
    )
    runtime_names: list[str] = []
    for name in names:
        # User constraint: skip tools explicitly disabled by user
        if name in disabled_set:
            continue

        metadata = TOOL_RUNTIME_METADATA.get(name) or _TOOL_RUNTIME_DEFAULTS
        if metadata.get("requires_canvas_document") is True and not has_canvas_documents:
            continue
        if metadata.get("requires_text_addressable_canvas") is True and not has_text_addressable_canvas_documents:
            continue
        if metadata.get("requires_editable_canvas") is True and not has_editable_canvas_documents:
            continue
        runtime_names.append(name)
    return runtime_names


def get_openai_tool_specs(
    active_tool_names: list[str],
    canvas_documents: list[dict] | None = None,
    clarification_max_questions: int | None = None,
    search_tool_query_limit: int | None = None,
) -> list[dict]:
    specs = []
    runtime_tool_names = resolve_runtime_tool_names(
        active_tool_names,
        canvas_documents=canvas_documents,
    )
    for tool in get_enabled_tool_specs(
        runtime_tool_names,
        clarification_max_questions=clarification_max_questions,
        search_tool_query_limit=search_tool_query_limit,
    ):
        parameters = copy.deepcopy(tool.get("parameters") or {})
        if parameters.get("type") == "object":
            parameters.setdefault("additionalProperties", False)
        specs.append(
            {
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool.get("description") or "",
                    "parameters": parameters,
                },
            }
        )
    return specs


def _compact_arg_type(arg_props: dict) -> str:
    arg_type = arg_props.get("type", "string")
    if arg_type == "array":
        item_type = (arg_props.get("items") or {}).get("type", "")
        if item_type:
            return f"array[{item_type}]"
    return arg_type


def get_prompt_tool_context(
    active_tool_names: list[str],
    canvas_documents: list[dict] | None = None,
    clarification_max_questions: int | None = None,
    search_tool_query_limit: int | None = None,
) -> list[dict] | None:
    tools = []
    runtime_tool_names = resolve_runtime_tool_names(
        active_tool_names,
        canvas_documents=canvas_documents,
    )
    for tool in get_enabled_tool_specs(
        runtime_tool_names,
        clarification_max_questions=clarification_max_questions,
        search_tool_query_limit=search_tool_query_limit,
    ):
        parameters = tool.get("parameters") if isinstance(tool.get("parameters"), dict) else {}
        properties = parameters.get("properties") if isinstance(parameters.get("properties"), dict) else {}
        required = parameters.get("required") if isinstance(parameters.get("required"), list) else []
        prompt = tool.get("prompt") if isinstance(tool.get("prompt"), dict) else {}
        use_for = str(prompt.get("purpose") or "").strip()
        if not use_for:
            use_for = str(tool.get("description") or "").strip().split(". ")[0].strip()

        entry = {"name": tool["name"]}
        if use_for:
            entry["use_for"] = use_for
        if properties:
            args = {}
            for arg_name, arg_props in properties.items():
                parts = [_compact_arg_type(arg_props)]
                if arg_name in required:
                    parts.append("required")
                enum_values = arg_props.get("enum")
                if enum_values:
                    parts.append("one of " + json.dumps(enum_values, ensure_ascii=False))
                desc = str(arg_props.get("description") or "").strip()
                compact = ", ".join(parts)
                if desc:
                    compact += f" — {desc}"
                args[arg_name] = compact
            entry["arguments"] = args
        guidance = str(prompt.get("guidance") or "").strip()
        if guidance:
            entry["guidance"] = guidance
        tools.append(entry)
    return tools or None
