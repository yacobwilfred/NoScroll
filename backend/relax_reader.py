"""
Helpers to decide whether relax content is fully consumable in-app.

Relax items must be viewable entirely inside NoScroll — no external click-through.

Articles: stored body_text only (no live scrape at browse time).
Images:    direct URL on a trusted host (i.redd.it, comic CDNs) — never Reddit previews.
Videos:    YouTube embeds.
"""

import html
import re
from typing import Optional, Tuple
from urllib.parse import urlparse

from collect_content_metadata import clean_text

# Hosts known to serve hotlink-friendly full images/comics.
_TRUSTED_IMAGE_HOSTS = (
    "i.redd.it",
    "imgs.xkcd.com",
    "xkcd.com",
    "smbc-comics.com",
    "buttersafe.com",
    "loadingartist.com",
    "bugmartini.com",
)

# Reddit preview/thumbnail URLs block hotlinking or are too small to read.
_UNTRUSTED_IMAGE_MARKERS = (
    "preview.redd.it",
    "external-preview.redd.it",
    "thumbs.redditmedia.com",
)

MIN_BODY_CHARS = 400

# Teaser / paywall phrases often left in partial extractions.
_TEASER_RE = re.compile(
    r"(read\s+more|continue\s+reading|subscribe\s+to\s+(read|continue)|"
    r"sign\s+up\s+to\s+read|members\s+only|premium\s+content|"
    r"unlock\s+this\s+story|create\s+an?\s+account|"
    r"over\s+on\s+patreon|new\s+home\s+on\s+patreon|paid\s+subscribers?\s+only)",
    re.IGNORECASE,
)


def body_from_rss_html(raw_html: str, min_chars: int = MIN_BODY_CHARS) -> Optional[str]:
    """Return cleaned plain text if the RSS entry carries a full article body."""
    if not raw_html:
        return None
    text = html.unescape(clean_text(raw_html, max_len=50_000))
    if len(text) < min_chars:
        return None
    if _looks_like_teaser(text):
        return None
    return text


def _looks_like_teaser(text: str) -> bool:
    """Heuristic: very short tail or explicit read-more language."""
    if len(text) < MIN_BODY_CHARS:
        return True
    if _TEASER_RE.search(text):
        return True
    # Single short paragraph that ends abruptly (common RSS excerpt pattern).
    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    if len(paras) == 1 and len(text) < 700 and text.rstrip().endswith("..."):
        return True
    return False


def validate_article_url(url: str, timeout: int = 12) -> Tuple[bool, Optional[str]]:
    """
    Scrape an article URL. Returns (reader_ready, body_text or None).
    """
    try:
        import newspaper
        article = newspaper.Article(url, language="en")
        article.download()
        article.parse()
        body = (article.text or "").strip()
        if _looks_like_teaser(body):
            return False, None
        return True, body
    except Exception:
        return False, None


def is_trusted_image_url(url: Optional[str]) -> bool:
    """True when the image can be embedded directly in <img src>."""
    if not url:
        return False
    lower = url.lower()
    if any(marker in lower for marker in _UNTRUSTED_IMAGE_MARKERS):
        return False
    try:
        host = urlparse(url).netloc.lower()
        if host.startswith("www."):
            host = host[4:]
    except Exception:
        return False
    return any(host == h or host.endswith("." + h) for h in _TRUSTED_IMAGE_HOSTS)


def is_in_app_ready(item: dict) -> bool:
    """Strict gate: only content fully renderable inside the app."""
    ctype = item.get("content_type")
    if ctype == "video":
        return "youtube.com" in (item.get("url") or "") or "youtu.be" in (item.get("url") or "")
    if ctype == "image":
        return is_trusted_image_url(item.get("image_url"))
    if ctype == "article":
        body = (item.get("body_text") or "").strip()
        fmt = item.get("format") or "short read"
        if fmt == "poem":
            min_chars = 80
        elif fmt == "recipe":
            min_chars = 280
        elif fmt == "essay":
            min_chars = 400
        else:
            min_chars = MIN_BODY_CHARS
        return bool(body) and len(body) >= min_chars and not _looks_like_teaser(body)
    return False


def infer_reader_ready(item: dict) -> bool:
    return is_in_app_ready(item)
