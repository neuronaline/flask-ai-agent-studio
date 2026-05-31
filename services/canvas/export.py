"""
Canvas document export utilities.

Provides markdown, HTML, and PDF download generation for canvas documents.
"""

from __future__ import annotations

from html import escape
from io import BytesIO

import markdown as markdown_lib

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib import colors

from services.canvas.normalize import (
    normalize_canvas_document,
    _normalize_line_endings,
)

from utils.export_styles import MONO_FONT, build_print_pdf_styles
from lib.markdown_rendering import append_markdown_pdf_story


KATEX_VERSION = "0.16.9"


def build_markdown_download(document: dict) -> bytes:
    normalized = normalize_canvas_document(document)
    if not normalized:
        raise ValueError("Canvas document is invalid.")
    content = _normalize_line_endings(normalized["content"])
    if normalized.get("format") == "code":
        language = normalized.get("language") or "text"
        return f"```{language}\n{content}\n```\n".encode("utf-8")
    return content.encode("utf-8")


def build_html_download(document: dict) -> bytes:
    normalized = normalize_canvas_document(document)
    if not normalized:
        raise ValueError("Canvas document is invalid.")

    content = _normalize_line_endings(normalized["content"])
    if normalized.get("format") == "code":
        language = escape(normalized.get("language") or "text")
        rendered = f'<pre><code class="language-{language}">{escape(content)}</code></pre>'
    else:
        rendered = markdown_lib.markdown(
            content,
            extensions=["extra", "fenced_code", "tables", "sane_lists"],
        )

    title = escape(normalized["title"])
    katex_cdn = f"https://cdn.jsdelivr.net/npm/katex@{KATEX_VERSION}/dist"
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <link rel="stylesheet" href="{katex_cdn}/katex.min.css" />
    <style>
        :root {{
            color-scheme: light;
            --bg: #f6f7fb;
            --surface: #ffffff;
            --text: #162033;
            --muted: #52607a;
            --border: #d8dfeb;
            --accent: #3157d5;
            --code-bg: #eef2fb;
        }}
        * {{ box-sizing: border-box; }}
        body {{
            margin: 0;
            background: linear-gradient(180deg, #eef2ff 0%, var(--bg) 220px);
            color: var(--text);
            font: 16px/1.7 "Segoe UI", Arial, sans-serif;
        }}
        main {{
            width: min(900px, calc(100vw - 32px));
            margin: 32px auto;
            padding: 32px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 20px;
            box-shadow: 0 24px 70px rgba(22, 32, 51, 0.08);
        }}
        h1, h2, h3, h4 {{ line-height: 1.25; color: #0f1728; }}
        p, li, blockquote {{ color: var(--text); }}
        blockquote {{ border-left: 4px solid var(--accent); margin: 1rem 0; padding: 0.1rem 0 0.1rem 1rem; color: var(--muted); }}
        pre {{ background: var(--code-bg); border: 1px solid var(--border); border-radius: 14px; padding: 14px; overflow-x: auto; }}
        code {{ background: var(--code-bg); border-radius: 6px; padding: 0.15em 0.35em; font-family: "Cascadia Code", Consolas, monospace; }}
        pre code {{ background: transparent; padding: 0; }}
                .katex-display {{ overflow-x: auto; overflow-y: hidden; padding: 0.35em 0; }}
        table {{ width: 100%; border-collapse: collapse; margin: 1rem 0; }}
        th, td {{ border: 1px solid var(--border); padding: 10px 12px; text-align: left; vertical-align: top; }}
        th {{ background: #f3f6fd; }}
        a {{ color: var(--accent); }}
    </style>
        <script defer src="{katex_cdn}/katex.min.js"></script>
        <script defer src="{katex_cdn}/contrib/auto-render.min.js"></script>
</head>
<body>
    <main>
        <article>
            {rendered}
        </article>
    </main>
        <script>
            window.addEventListener('DOMContentLoaded', () => {{
                if (window.renderMathInElement) {{
                    window.renderMathInElement(document.querySelector('article'), {{
                        delimiters: [
                            {{ left: '$$', right: '$$', display: true }},
                            {{ left: '$', right: '$', display: false }},
                        ]
                    }});
                }}
            }});
        </script>
</body>
</html>
"""
    return html.encode("utf-8")


def _count_pdf_pages(pdf_bytes: bytes) -> int | None:
    if not pdf_bytes:
        return None
    try:
        import pdfplumber
    except Exception:
        return None

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            return len(pdf.pages)
    except Exception:
        return None


def _build_canvas_pdf_meta_text(document: dict, *, page_count: int | None = None) -> str:
    parts = []
    line_count = int(document.get("line_count") or 0)
    normalized_page_count = int(page_count or document.get("page_count") or 0)

    if line_count > 0:
        parts.append(f"Lines: <b>{line_count}</b>")
    if normalized_page_count > 0:
        parts.append(f"Pages: <b>{normalized_page_count}</b>")
    return " • ".join(parts)


def _build_canvas_pdf_title_card(
    document: dict, width: float, title_style, meta_style, *, page_count: int | None = None
):
    rows = [[Paragraph(escape(document["title"]), title_style)]]
    meta_text = _build_canvas_pdf_meta_text(document, page_count=page_count)
    if meta_text:
        rows.append([Paragraph(meta_text, meta_style)])

    table = Table(rows, colWidths=[width], hAlign="LEFT")
    style_commands = [
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#d8e1f0")),
        ("LINEBEFORE", (0, 0), (0, -1), 4, colors.HexColor("#3157d5")),
        ("LEFTPADDING", (0, 0), (-1, -1), 18),
        ("RIGHTPADDING", (0, 0), (-1, -1), 18),
        ("TOPPADDING", (0, 0), (-1, -1), 16),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]
    if len(rows) > 1:
        style_commands.append(("LINEABOVE", (0, 1), (-1, 1), 0.45, colors.HexColor("#e7edf7")))
    table.setStyle(TableStyle(style_commands))
    return table


def _build_canvas_pdf_page_chrome(title: str):
    def _draw(canvas, doc):
        canvas.saveState()
        page_width, page_height = A4
        canvas.setFillColor(colors.HexColor("#3157d5"))
        canvas.rect(0, page_height - 8, page_width, 8, stroke=0, fill=1)
        canvas.setStrokeColor(colors.HexColor("#dfe6f2"))
        canvas.setLineWidth(0.8)
        canvas.line(doc.leftMargin, page_height - 18, page_width - doc.rightMargin, page_height - 18)
        canvas.restoreState()

    return _draw


def build_pdf_download(document: dict) -> bytes:
    normalized = normalize_canvas_document(document)
    if not normalized:
        raise ValueError("Canvas document is invalid.")

    pdf_styles = build_print_pdf_styles(
        "CanvasExport",
        title_font_size=21,
        title_leading=26,
        body_font_size=10.6,
        body_leading=15.8,
        heading1_font_size=17.0,
        heading1_leading=22.0,
    )
    title_style = pdf_styles["title"]
    body_style = pdf_styles["body"]
    heading1_style = pdf_styles["heading1"]
    heading_style = pdf_styles["heading"]
    subheading_style = pdf_styles["subheading"]
    meta_style = pdf_styles["meta"]
    code_style = pdf_styles["code"]
    quote_style = pdf_styles["quote"]
    math_style = pdf_styles["math"]
    table_header_style = pdf_styles["table_header"]
    table_body_style = pdf_styles["table_body"]

    _left_margin = 22 * mm
    _right_margin = 22 * mm
    _content_width = A4[0] - _left_margin - _right_margin
    page_chrome = _build_canvas_pdf_page_chrome(normalized["title"])

    def _build_story(page_count: int | None) -> list:
        story = [
            _build_canvas_pdf_title_card(normalized, _content_width, title_style, meta_style, page_count=page_count),
            Spacer(1, 14),
        ]
        if normalized.get("format") == "code":
            story.append(Preformatted(_normalize_line_endings(normalized["content"]), code_style))
            return story

        append_markdown_pdf_story(
            story,
            normalized["content"],
            body_style=body_style,
            heading1_style=heading1_style,
            heading_style=heading_style,
            subheading_style=subheading_style,
            code_style=code_style,
            quote_style=quote_style,
            math_style=math_style,
            table_header_style=table_header_style,
            table_body_style=table_body_style,
            mono_font_name=MONO_FONT,
            heading_level_offset=0,
        )
        return story

    page_count = int(normalized.get("page_count") or 0) or None
    output = BytesIO()
    doc = SimpleDocTemplate(
        output,
        pagesize=A4,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        leftMargin=_left_margin,
        rightMargin=_right_margin,
    )

    if page_count is None:
        preview_output = BytesIO()
        preview_doc = SimpleDocTemplate(
            preview_output,
            pagesize=A4,
            topMargin=20 * mm,
            bottomMargin=20 * mm,
            leftMargin=_left_margin,
            rightMargin=_right_margin,
        )
        preview_doc.build(_build_story(None), onFirstPage=page_chrome, onLaterPages=page_chrome)
        page_count = _count_pdf_pages(preview_output.getvalue()) or 1

    for _ in range(5):
        output.seek(0)
        output.truncate(0)
        doc.build(_build_story(page_count), onFirstPage=page_chrome, onLaterPages=page_chrome)
        rendered_page_count = _count_pdf_pages(output.getvalue()) or page_count or 1
        if rendered_page_count == page_count:
            break
        page_count = rendered_page_count

    return output.getvalue()