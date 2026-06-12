"""
Collect relax-mode content: regular YouTube videos (2–8 min, no Shorts), light essays, webcomics.

Photo essays are excluded — everything must render in-app. Reddit is not collected.

    python3 collect_relax_content.py --target 1000 --max-min 8
    python3 load_to_db.py --input relax_content_metadata.json

Requires YOUTUBE_API_KEY in backend/.env for video collection.
"""

import argparse
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from collect_content_metadata import (
    http_get_text,
    normalize_xml_text,
    clean_text,
    fetch_youtube_items,
    local_name,
    child_text,
    child_link,
)
from relax_reader import (
    MIN_BODY_CHARS,
    body_from_rss_html,
    validate_article_url,
    infer_reader_ready,
    is_trusted_image_url,
    is_in_app_ready,
)

import xml.etree.ElementTree as ET

DEFAULT_OUT = Path(__file__).parent / "relax_content_metadata.json"
DEFAULT_MAX_MIN = 8
DEFAULT_PER_SOURCE = 60
DEFAULT_TARGET = 1000
RELAX_CLUSTER = "relax_pool"
MAX_ESSAY_CHARS = 5_500   # keep essays light — skip long reads

_IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)
_PAYWALL_MARKERS = re.compile(
    r"(subscribe to read|paid subscribers|this post is for paid|unlock full|"
    r"over on patreon|new home on patreon|culture study.+patreon)",
    re.IGNORECASE,
)

_MIN_BY_FORMAT = {
    "poem": 80,
    "recipe": 280,
    "essay": 400,
    "short read": MIN_BODY_CHARS,
}

# ── Webcomics (direct image URLs) ─────────────────────────────────────────────
WEBCOMIC_SOURCES: List[Dict[str, str]] = [
    {"url": "https://xkcd.com/rss.xml",              "category": "Art & Whimsy"},
    {"url": "https://www.smbc-comics.com/comic/rss", "category": "Art & Whimsy"},
    {"url": "https://loadingartist.com/feed/",        "category": "Art & Whimsy"},
    {"url": "https://buttersafe.com/feed/",           "category": "Art & Whimsy"},
    {"url": "https://www.bugmartini.com/feed/",       "category": "Art & Whimsy"},
    {"url": "https://www.phdcomics.com/gradfeed.php", "category": "Art & Whimsy"},
]

# ── Light essays — Substack / WordPress RSS with full content:encoded ─────────
ESSAY_SOURCES: List[Dict[str, str]] = [
    {"url": "https://defector.com/rss",                 "category": "Comedy"},
    {"url": "https://post.substack.com/feed",           "category": "Art & Whimsy"},
    {"url": "https://www.honest-broker.com/feed",      "category": "Music"},
    {"url": "https://tedgioia.substack.com/feed",        "category": "Music"},
    {"url": "https://smittenkitchen.com/feed/",         "category": "Food"},
    {"url": "https://calnewport.com/feed/",             "category": "Human Interest"},
    {"url": "https://seths.blog/feed/",                 "category": "Human Interest"},
    {"url": "https://platformer.news/feed",             "category": "Human Interest"},
    {"url": "https://www.mcsweeneys.net/rss",           "category": "Comedy"},
    {"url": "https://feeds.feedburner.com/mcsweeneys",  "category": "Comedy"},
    {"url": "https://www.thebrowser.com/feed/",         "category": "Travel"},
    {"url": "https://griefbacon.substack.com/feed",     "category": "Human Interest"},
    {"url": "https://www.experimental-history.com/feed", "category": "Human Interest"},
    {"url": "https://www.slowboring.com/feed",          "category": "Human Interest"},
]

# ── YouTube regular videos (2–8 min, no Shorts) ─────────────────────────────
RELAX_YOUTUBE_QUERIES: List[Dict[str, str]] = [
    # Comedy
    {"category": "Comedy",         "query": "stand up comedy clip full"},
    {"category": "Comedy",         "query": "snl sketch classic"},
    {"category": "Comedy",         "query": "improv comedy performance"},
    {"category": "Comedy",         "query": "wholesome funny video"},
    {"category": "Comedy",         "query": "conan o'brien funny clip"},
    {"category": "Comedy",         "query": "dry humor sketch"},
    # Music
    {"category": "Music",          "query": "npr tiny desk concert"},
    {"category": "Music",          "query": "acoustic live session"},
    {"category": "Music",          "query": "street musician amazing"},
    {"category": "Music",          "query": "cover song acoustic live"},
    {"category": "Music",          "query": "classical music relaxing performance"},
    # Pets
    {"category": "Pets & Animals", "query": "funny dogs compilation"},
    {"category": "Pets & Animals", "query": "cute cats funny"},
    {"category": "Pets & Animals", "query": "animal friendship heartwarming"},
    # Travel
    {"category": "Travel",         "query": "walking tour city 4k"},
    {"category": "Travel",         "query": "hidden gem travel vlog"},
    {"category": "Travel",         "query": "street food tour"},
    # Howto
    {"category": "Howto & Style",  "query": "easy diy craft tutorial"},
    {"category": "Howto & Style",  "query": "life hack satisfying"},
    {"category": "Howto & Style",  "query": "quick cooking tip"},
    # Nature
    {"category": "Nature",         "query": "nature relaxing 4k"},
    {"category": "Nature",         "query": "ocean waves relaxing"},
    # Human interest
    {"category": "Human Interest", "query": "heartwarming story documentary"},
    {"category": "Human Interest", "query": "random acts of kindness"},
    # Food
    {"category": "Food",           "query": "easy recipe cooking tutorial"},
    {"category": "Food",           "query": "baking tutorial beginner"},
    # Extra queries to bulk-fill the relax pool with regular videos
    {"category": "Comedy",         "query": "key and peele sketch"},
    {"category": "Comedy",         "query": "monty python sketch"},
    {"category": "Comedy",         "query": "late night comedy monologue"},
    {"category": "Comedy",         "query": "british comedy panel show"},
    {"category": "Music",          "query": "live jazz performance club"},
    {"category": "Music",          "query": "piano cover popular song"},
    {"category": "Music",          "query": "indie band live session"},
    {"category": "Music",          "query": "cello performance beautiful"},
    {"category": "Pets & Animals", "query": "puppy playing video"},
    {"category": "Pets & Animals", "query": "baby animals cute"},
    {"category": "Pets & Animals", "query": "wildlife documentary clip"},
    {"category": "Travel",         "query": "japan street walk 4k"},
    {"category": "Travel",         "query": "italy food market tour"},
    {"category": "Travel",         "query": "national park scenic drive"},
    {"category": "Nature",         "query": "rainforest ambience 4k"},
    {"category": "Nature",         "query": "mountain sunrise timelapse"},
    {"category": "Nature",         "query": "birds singing forest"},
    {"category": "Howto & Style",  "query": "watercolor painting tutorial beginner"},
    {"category": "Howto & Style",  "query": "origami tutorial easy"},
    {"category": "Human Interest", "query": "community coming together story"},
    {"category": "Human Interest", "query": "teacher surprise student emotional"},
    {"category": "Food",           "query": "italian pasta recipe homemade"},
    {"category": "Food",           "query": "sourdough bread baking guide"},
    {"category": "Comedy",         "query": "ellen funny moments guests"},
    {"category": "Music",          "query": "guitar fingerstyle performance"},
    {"category": "Pets & Animals", "query": "rescue dog transformation"},
    {"category": "Travel",         "query": "paris walking tour morning"},
    {"category": "Human Interest", "query": "reunion surprise emotional"},
]


def _load_env_file() -> None:
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


_load_env_file()


def _min_chars(fmt: str) -> int:
    return _MIN_BY_FORMAT.get(fmt, MIN_BODY_CHARS)


def _extract_image_url(raw_summary: str) -> Optional[str]:
    if not raw_summary:
        return None
    m = _IMG_RE.search(raw_summary)
    return m.group(1) if m else None


def _relax_cognitive_load(content_type: str, fmt: str, duration_minutes: Optional[int]) -> float:
    if content_type == "video":
        mins = max(duration_minutes or 3, 1)
        return round((mins / 60.0) * (1.0 + 0.1 * 0.5), 3)  # media k=0.1 style
    by_format = {
        "webcomic": 0.03, "poem": 0.03, "short read": 0.06,
        "essay": 0.08, "recipe": 0.10,
    }
    return by_format.get(fmt, 0.05)


def _read_time_for_format(fmt: str) -> Optional[int]:
    return {"webcomic": 2, "poem": 3, "short read": 4, "essay": 7, "recipe": 6}.get(fmt)


def _entry_full_html(entry_elem: ET.Element) -> str:
    """Prefer content:encoded / full content over short description."""
    for child in list(entry_elem):
        lname = local_name(child.tag)
        if lname in ("encoded", "content"):
            text = (child.text or "").strip()
            if text:
                return text
    return child_text(entry_elem, ["description", "summary"])


def _extract_feed_items(root: ET.Element) -> List[Dict[str, Any]]:
    """Like extract_feed_entries but keeps raw HTML for body extraction."""
    items: List[Dict[str, Any]] = []
    for elem in root.iter():
        if local_name(elem.tag) not in {"item", "entry"}:
            continue
        title = child_text(elem, ["title"])
        url = child_link(elem) or child_text(elem, ["guid", "id"])
        if not title or not url:
            continue
        raw_html = _entry_full_html(elem)
        items.append({
            "title": title,
            "url": url,
            "summary": raw_html,
            "author": child_text(elem, ["author", "creator", "dc:creator", "name"]),
            "published_at": child_text(elem, ["pubdate", "published", "updated"]),
        })
    return items


def _body_from_html(raw_html: str, fmt: str) -> Optional[str]:
    if not raw_html:
        return None
    if _PAYWALL_MARKERS.search(raw_html):
        return None
    text = body_from_rss_html(raw_html, min_chars=_min_chars(fmt))
    if not text:
        return None
    if fmt == "essay" and len(text) > MAX_ESSAY_CHARS:
        return None
    return text


def _finalize_item(
    item: Dict[str, Any],
    *,
    validate_scrape: bool,
    scrape_delay: float,
) -> Optional[Dict[str, Any]]:
    ctype = item.get("content_type")
    if ctype == "video":
        if is_in_app_ready(item):
            item["reader_ready"] = True
            return item
        return None
    if ctype == "image":
        if is_trusted_image_url(item.get("image_url")):
            item["reader_ready"] = True
            return item
        return None
    if item.get("body_text"):
        item.pop("_raw_summary", None)
        if is_in_app_ready(item):
            item["reader_ready"] = True
            return item
        return None
    raw = item.pop("_raw_summary", None) or ""
    inline = _body_from_html(raw, item.get("format") or "short read")
    if inline:
        item["body_text"] = inline
        if is_in_app_ready(item):
            item["reader_ready"] = True
            return item
        return None
    if not validate_scrape or ctype != "article":
        return None
    ok, body = validate_article_url(item["url"])
    if scrape_delay:
        time.sleep(scrape_delay)
    if not ok or not body:
        return None
    item["body_text"] = body
    return item if is_in_app_ready(item) else None


def fetch_webcomics(per_source: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for src in WEBCOMIC_SOURCES:
        try:
            root = ET.fromstring(normalize_xml_text(http_get_text(src["url"])))
        except Exception as exc:
            print(f"[warn] webcomic feed failed: {src['url']} ({exc})")
            continue
        count = 0
        for entry in _extract_feed_items(root)[: per_source * 2]:
            raw = entry.get("summary") or ""
            image_url = _extract_image_url(raw)
            if not is_trusted_image_url(image_url):
                continue
            draft = {
                "title": entry["title"],
                "url": entry["url"],
                "content_type": "image",
                "cluster_id": RELAX_CLUSTER,
                "source": src["url"],
                "summary": clean_text(raw)[:400] or None,
                "author": entry.get("author"),
                "published_at": entry.get("published_at"),
                "vibe": "relax",
                "category": src["category"],
                "format": "webcomic",
                "image_url": image_url,
                "cognitive_load": _relax_cognitive_load("image", "webcomic", None),
                "read_time_minutes": 2,
            }
            fin = _finalize_item(draft, validate_scrape=False, scrape_delay=0)
            if fin:
                out.append(fin)
                count += 1
            if count >= per_source:
                break
        print(f"[ok] {count:3d}  {src['category']:<15} webcomic     {src['url']}")
    return out


def fetch_substack_essays(per_source: int, validate_scrape: bool, scrape_delay: float) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for src in ESSAY_SOURCES:
        try:
            root = ET.fromstring(normalize_xml_text(http_get_text(src["url"])))
        except Exception as exc:
            print(f"[warn] substack/rss failed: {src['url']} ({exc})")
            continue
        count = 0
        for entry in _extract_feed_items(root)[: per_source * 3]:
            fmt = "essay"
            raw = entry.get("summary") or ""
            body = _body_from_html(raw, fmt)
            if not body:
                continue
            draft = {
                "title": entry["title"],
                "url": entry["url"],
                "content_type": "article",
                "cluster_id": RELAX_CLUSTER,
                "source": src["url"],
                "summary": body[:600],
                "author": entry.get("author"),
                "published_at": entry.get("published_at"),
                "vibe": "relax",
                "category": src["category"],
                "format": fmt,
                "body_text": body,
                "cognitive_load": _relax_cognitive_load("article", fmt, None),
                "read_time_minutes": _read_time_for_format(fmt),
            }
            fin = _finalize_item(draft, validate_scrape=validate_scrape, scrape_delay=scrape_delay)
            if fin:
                out.append(fin)
                count += 1
            if count >= per_source:
                break
        print(f"[ok] {count:3d}  {src['category']:<15} essay        {src['url']}")
    return out


def fetch_relax_youtube(max_min: int, per_query: int = 25) -> List[Dict[str, Any]]:
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        print("[warn] YOUTUBE_API_KEY not set in backend/.env — skipping all YouTube collection")
        return []

    out: List[Dict[str, Any]] = []
    for q in RELAX_YOUTUBE_QUERIES:
        items = fetch_youtube_items(
            RELAX_CLUSTER,
            q["query"],
            api_key,
            max_results=50,
            min_duration_seconds=120,
            max_duration_seconds=max_min * 60,
            exclude_shorts=True,
        )
        count = 0
        for it in items:
            dur = it.get("duration_minutes")
            draft = {
                **it,
                "vibe": "relax",
                "category": q["category"],
                "format": "video",
                "image_url": None,
                "read_time_minutes": None,
                "cognitive_load": _relax_cognitive_load("video", "video", dur),
            }
            if is_in_app_ready(draft):
                draft["reader_ready"] = True
                out.append(draft)
                count += 1
            if count >= per_query:
                break
        print(f"[ok] {count:3d}  {q['category']:<15} video        yt:'{q['query']}'")
    return out


def dedupe(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    result = []
    for it in items:
        u = (it.get("url") or "").strip().rstrip("/")
        if not u or u in seen:
            continue
        seen.add(u)
        it.pop("_raw_summary", None)
        result.append(it)
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description="Collect relax-mode content metadata.")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--target", type=int, default=DEFAULT_TARGET)
    ap.add_argument("--max-min", type=int, default=DEFAULT_MAX_MIN, help="Max video minutes.")
    ap.add_argument("--per-source", type=int, default=DEFAULT_PER_SOURCE)
    ap.add_argument("--validate-scrape", action="store_true", default=False)
    ap.add_argument("--scrape-delay", type=float, default=0.25)
    args = ap.parse_args()

    items: List[Dict[str, Any]] = []

    # 1. YouTube first (largest share when API key is set)
    items.extend(fetch_relax_youtube(args.max_min, per_query=40))
    items = dedupe(items)
    print(f"[info] after YouTube: {len(items)}")

    # 2. Light essays from Substack / full-text RSS
    if len(items) < args.target:
        items.extend(fetch_substack_essays(
            args.per_source, args.validate_scrape, args.scrape_delay,
        ))
        items = dedupe(items)
    print(f"[info] after essays: {len(items)}")

    # 3. Webcomics
    if len(items) < args.target:
        items.extend(fetch_webcomics(min(30, args.per_source)))
        items = dedupe(items)
    print(f"[info] after webcomics: {len(items)}")

    items = dedupe(items)[: args.target]
    ready = sum(1 for it in items if infer_reader_ready(it))

    by_cat: Dict[str, int] = {}
    by_format: Dict[str, int] = {}
    for it in items:
        by_cat[it["category"]] = by_cat.get(it["category"], 0) + 1
        by_format[it.get("format", "?")] = by_format.get(it.get("format", "?"), 0) + 1

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "vibe": "relax",
        "target_total": args.target,
        "actual_total": len(items),
        "reader_ready_total": ready,
        "by_category": by_cat,
        "by_format": by_format,
        "items": items,
    }

    out_path = Path(args.out)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"\n[done] {len(items)} relax items ({ready} in-app-ready) → {out_path}")
    print(f"[done] by category: {by_cat}")
    print(f"[done] by format:   {by_format}")


if __name__ == "__main__":
    main()
