from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

from core.config import (
    DOCUMENT_MAX_TEXT_CHARS,
    YOUTUBE_TRANSCRIPTS_DISABLED_FEATURE_ERROR,
    YOUTUBE_TRANSCRIPTS_ENABLED,
)

_YOUTUBE_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YOUTUBE_ALLOWED_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
}


def _normalize_youtube_host(hostname: str | None) -> str:
    return str(hostname or "").strip().lower()


def extract_youtube_video_id(url: str) -> str | None:
    parsed = urlparse(str(url or "").strip())
    host = _normalize_youtube_host(parsed.hostname)
    if host not in _YOUTUBE_ALLOWED_HOSTS:
        return None

    if host in {"youtu.be", "www.youtu.be"}:
        candidate = parsed.path.strip("/").split("/", 1)[0]
        return candidate if _YOUTUBE_VIDEO_ID_RE.match(candidate) else None

    if parsed.path == "/watch":
        candidate = parse_qs(parsed.query).get("v", [""])[0].strip()
        return candidate if _YOUTUBE_VIDEO_ID_RE.match(candidate) else None

    path_parts = [part for part in parsed.path.split("/") if part]
    if len(path_parts) >= 2 and path_parts[0] in {"shorts", "embed", "live"}:
        candidate = path_parts[1].strip()
        return candidate if _YOUTUBE_VIDEO_ID_RE.match(candidate) else None

    return None


def normalize_youtube_url(url: str) -> str:
    video_id = extract_youtube_video_id(url)
    if not video_id:
        raise ValueError("Enter a valid YouTube URL.")
    return f"https://www.youtube.com/watch?v={video_id}"


def read_youtube_video_reference(raw_url: str) -> tuple[str, str]:
    if not YOUTUBE_TRANSCRIPTS_ENABLED:
        raise RuntimeError(YOUTUBE_TRANSCRIPTS_DISABLED_FEATURE_ERROR)

    normalized_url = normalize_youtube_url(raw_url)
    video_id = extract_youtube_video_id(normalized_url)
    if not video_id:
        raise ValueError("No valid YouTube video ID was found.")
    return normalized_url, video_id


def _format_duration(duration_seconds: int | None) -> str:
    if not isinstance(duration_seconds, int) or duration_seconds <= 0:
        return ""
    minutes, seconds = divmod(duration_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:d}:{seconds:02d}"


def build_video_transcript_context_block(
    title: str,
    transcript_text: str,
    *,
    source_url: str = "",
    transcript_language: str = "",
    duration_seconds: int | None = None,
) -> tuple[str, bool]:
    normalized_title = str(title or "").strip() or "YouTube video"
    normalized_text = str(transcript_text or "").strip()
    if not normalized_text:
        raise ValueError("Video transcript is empty.")

    truncated = len(normalized_text) > DOCUMENT_MAX_TEXT_CHARS
    clipped_text = normalized_text[:DOCUMENT_MAX_TEXT_CHARS] if truncated else normalized_text
    header = f"[YouTube video transcript: {normalized_title}]"
    if truncated:
        header += " (truncated to first 50,000 characters)"

    detail_lines = []
    if source_url:
        detail_lines.append(f"Source: {source_url}")
    if transcript_language:
        detail_lines.append(f"Detected language: {transcript_language}")
    formatted_duration = _format_duration(duration_seconds)
    if formatted_duration:
        detail_lines.append(f"Duration: {formatted_duration}")

    parts = [header]
    if detail_lines:
        parts.append("\n".join(detail_lines))
    parts.append(clipped_text)
    return "\n\n".join(part for part in parts if part).strip(), truncated


def transcribe_youtube_video(source_url: str) -> dict:
    normalized_url, video_id = read_youtube_video_reference(source_url)

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError as exc:
        raise RuntimeError(
            "The `youtube-transcript-api` package must be installed for YouTube transcripts. "
            "Install it with: pip install youtube-transcript-api"
        ) from exc

    try:
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
    except Exception as exc:
        raise ValueError(
            f"Could not list transcripts for video {video_id}: {exc}"
        ) from exc

    # Try to find a manually created transcript first, then fallback to generated
    transcript_data = None
    detected_language = ""
    is_generated = False

    try:
        # Prefer manually created transcripts from common languages
        transcript = transcript_list.find_transcript(["en", "tr", "es", "fr", "de", "ja", "ko", "pt", "it", "ru"])
        transcript_data = transcript.fetch()
        detected_language = transcript.language_code
        is_generated = transcript.is_generated
    except Exception:
        pass

    # Fallback: try any available transcript
    if transcript_data is None:
        available_transcripts = list(transcript_list)
        if not available_transcripts:
            raise ValueError(
                f"No transcript available for video {video_id}. "
                f"This video may not have captions enabled."
            )
        # Get any available transcript
        transcript = available_transcripts[0]
        transcript_data = transcript.fetch()
        detected_language = transcript.language_code
        is_generated = transcript.is_generated

    # Combine text from all segments
    transcript_lines: list[str] = []
    for segment in transcript_data:
        text = str(getattr(segment, "text", "") or "").strip()
        if text:
            transcript_lines.append(text)

    transcript_text = " ".join(transcript_lines).strip()
    if not transcript_text:
        raise ValueError("A readable speech transcript could not be extracted from the video.")

    # Get video metadata
    title = f"YouTube video {video_id}"
    duration_seconds = None

    try:
        # Try to get video metadata via pytube or similar lightweight method
        # For now, we'll estimate from transcript segments
        if transcript_data:
            try:
                start = getattr(transcript_data[-1], "start", 0) if transcript_data else 0
                duration_attr = getattr(transcript_data[-1], "duration", 0) if transcript_data else 0
                if start and duration_attr:
                    duration_seconds = int(start + duration_attr)
            except Exception:
                pass
    except Exception:
        pass

    return {
        "platform": "youtube",
        "source_url": normalized_url,
        "source_video_id": video_id,
        "title": title,
        "duration_seconds": duration_seconds,
        "transcript_text": transcript_text,
        "transcript_language": detected_language,
        "transcript_generated": is_generated,
    }
