import os
import re
import json
import sqlite3
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Literal
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

import db
import session as session_manager
from relax_reader import is_in_app_ready
import user_profile as profile_router
import identity as identity_router
import google_health
from models import (
    ContentNode,
    Direction,
    SessionExpandRequest,
    SessionExpandResponse,
    SessionStartRequest,
    SessionStartResponse,
)


class StartFromContentRequest(BaseModel):
    content_id: str


class StartFromExternalRequest(BaseModel):
    url: str
    title: str
    content_type: str
    summary: Optional[str] = None
    author: Optional[str] = None
    source: Optional[str] = None
    thumbnail: Optional[str] = None


class ReaderViewResponse(BaseModel):
    content_id: str
    title: Optional[str] = None
    author: Optional[str] = None
    published_at: Optional[str] = None
    body_html: Optional[str] = None
    body_text: Optional[str] = None
    top_image: Optional[str] = None
    success: bool
    fallback_summary: Optional[str] = None


class ArxivReaderResponse(BaseModel):
    format: Literal["html", "pdf"]
    url: str


# New-style (2305.08493v2) and legacy category paths (astro-ph/0410258v1)
ARXIV_ID_RE = re.compile(
    r"^(\d+\.\d+(v\d+)?|[a-z][\w-]*/\d+(v\d+)?)$",
    re.IGNORECASE,
)

app = FastAPI(
    title="NoScroll API",
    description="Mindful content discovery through multidirectional navigation.",
    version="0.1.0",
)

def _sync_bundled_content_corpus() -> None:
    """Merge bundled gzip seed into live DB when CONTENT_DB_SEED_VERSION bumps."""
    from sync_content_from_seed import maybe_sync_from_bundled_seed

    version = os.environ.get("CONTENT_DB_SEED_VERSION", "")
    seed_gz = Path(__file__).parent / "data" / "noscroll.seed.db.gz"
    marker = db.DB_PATH.parent / ".content_db_seed_version"
    maybe_sync_from_bundled_seed(db.DB_PATH, seed_gz, version, marker)


def _ensure_content_corpus_loaded() -> None:
    """
    On fresh/ephemeral deploys, load bundled metadata into SQLite so
    prompt exploration has content immediately.
    Safe to call repeatedly: only loads when contents is empty.
    """
    con = sqlite3.connect(db.DB_PATH)
    try:
        row = con.execute("SELECT COUNT(*) FROM contents").fetchone()
        contents_count = row[0] if row else 0
    finally:
        con.close()
    if contents_count > 0:
        return

    seed_input = os.environ.get("CONTENT_SEED_FILE", "/app/creative_content_metadata.json")
    if not os.path.exists(seed_input):
        print(f"[startup] seed file not found: {seed_input}")
        return

    print(f"[startup] contents empty; loading seed corpus from {seed_input}")
    subprocess.run(
        [
            "python",
            "/app/load_to_db.py",
            "--input",
            seed_input,
            "--db",
            str(db.DB_PATH),
        ],
        check=False,
    )


@app.on_event("startup")
def startup_event():
    db.ensure_content_schema()
    db.ensure_embeddings_table()
    _sync_bundled_content_corpus()
    _ensure_content_corpus_loaded()
    db.ensure_fts_index()
    profile_router.ensure_profile_schema()
    identity_router.ensure_identity_schema()
    if os.environ.get("SEED_FRIENDS_ON_STARTUP", "").lower() in ("1", "true", "yes"):
        try:
            import seed_friends

            seed_friends.run()
        except Exception as e:
            print(f"[startup] seed_friends: {e}")

app.include_router(profile_router.router)
app.include_router(identity_router.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/session/start", response_model=SessionStartResponse)
def start_session(body: SessionStartRequest):
    mode = getattr(body, "mode", "deep") or "deep"
    if mode != "relax" and (not body.prompt or not body.prompt.strip()):
        raise HTTPException(status_code=400, detail="Prompt must not be empty.")
    try:
        session_id, center_node, directions = session_manager.start_session(
            (body.prompt or "").strip(), mode=mode
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return SessionStartResponse(
        session_id=session_id,
        center_node=center_node,
        directions=directions,
    )


@app.post("/session/expand", response_model=SessionExpandResponse)
def expand_session(body: SessionExpandRequest):
    if not body.session_id or not body.current_node_id or not body.chosen_cluster_id:
        raise HTTPException(status_code=400, detail="session_id, current_node_id, and chosen_cluster_id are required.")
    try:
        new_center, directions, breadcrumb = session_manager.expand_session(
            session_id=body.session_id,
            current_node_id=body.current_node_id,
            chosen_cluster_id=body.chosen_cluster_id,
            chosen_content_id=body.chosen_content_id,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    return SessionExpandResponse(
        session_id=body.session_id,
        center_node=new_center,
        directions=directions,
        breadcrumb=breadcrumb,
    )


@app.get("/content/{content_id}", response_model=ContentNode)
def get_content(content_id: str):
    item = db.get_content_by_id(content_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Content '{content_id}' not found.")
    return ContentNode(
        id=item["id"],
        title=item["title"],
        url=item["url"],
        content_type=item["content_type"],
        cluster_id=item["cluster_id"],
        source=item.get("source"),
        summary=item.get("summary"),
        author=item.get("author"),
        published_at=item.get("published_at"),
        duration_minutes=item.get("duration_minutes"),
        read_time_minutes=item.get("read_time_minutes"),
        language=item.get("language", "en"),
        cognitive_load=item.get("cognitive_load"),
        vibe=item.get("vibe") or "deep",
        category=item.get("category"),
        format=item.get("format"),
        image_url=item.get("image_url"),
    )


@app.get("/health/today")
def get_health_today():
    """
    Return today's biometrics (HRV, resting HR, sleep) from the Google Health
    API for the connected Fitbit Charge 6, mapped to the Cognitive Meter model.
    Credentials are read server-side from backend/.env.
    """
    try:
        return google_health.get_today()
    except google_health.GoogleHealthError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Google Health API error: {str(e)}")


@app.get("/session/{session_id}/breadcrumb")
def get_breadcrumb(session_id: str):
    crumb = session_manager.get_session_breadcrumb(session_id)
    return {"session_id": session_id, "breadcrumb": crumb}


@app.post("/session/start-from-content", response_model=SessionStartResponse)
def start_from_content(body: StartFromContentRequest):
    """Start a session directly from a known NoScroll content ID."""
    try:
        session_id, center_node, directions = session_manager.start_session_from_content(
            body.content_id
        )
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return SessionStartResponse(
        session_id=session_id,
        center_node=center_node,
        directions=directions,
    )


@app.post("/session/start-from-external", response_model=SessionStartResponse)
def start_from_external(body: StartFromExternalRequest):
    """Ingest an external URL into the DB (if not already present) and start a session."""
    try:
        session_id, center_node, directions = session_manager.ingest_external_and_start_session(
            url=body.url,
            title=body.title,
            content_type=body.content_type,
            summary=body.summary,
            author=body.author,
            source=body.source,
            thumbnail=body.thumbnail,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return SessionStartResponse(
        session_id=session_id,
        center_node=center_node,
        directions=directions,
    )


@app.get("/content/{content_id}/audio-url")
def get_audio_url(content_id: str):
    """
    Resolves a podcast episode's direct audio (MP3/M4A) URL by fetching the
    show's RSS feed and matching the stored episode page URL to its enclosure.
    """
    item = db.get_content_by_id(content_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Content '{content_id}' not found.")
    if item.get("content_type") != "podcast":
        raise HTTPException(status_code=400, detail="Content is not a podcast.")

    episode_url = item.get("url", "")
    feed_url = item.get("source", "")

    # If the stored URL is already a direct audio file, return it immediately
    if any(episode_url.lower().endswith(ext) for ext in (".mp3", ".m4a", ".ogg")):
        return {"audio_url": episode_url, "resolved": False}

    if not feed_url or not feed_url.startswith("http"):
        raise HTTPException(status_code=422, detail="No RSS feed URL available for this episode.")

    try:
        req = urllib.request.Request(
            feed_url,
            headers={"User-Agent": "Mozilla/5.0 (NoScroll RSS resolver/1.0)"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()

        root = ET.fromstring(raw)
        ns = {"itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd"}

        # Walk every <item> in the feed looking for a URL/guid match
        episode_url_stripped = episode_url.rstrip("/")
        for item_el in root.iter("item"):
            link_el = item_el.find("link")
            guid_el = item_el.find("guid")
            enclosure_el = item_el.find("enclosure")

            candidates = []
            if link_el is not None and link_el.text:
                candidates.append(link_el.text.strip().rstrip("/"))
            if guid_el is not None and guid_el.text:
                candidates.append(guid_el.text.strip().rstrip("/"))

            match = any(c == episode_url_stripped or episode_url_stripped in c or c in episode_url_stripped
                        for c in candidates)

            if match and enclosure_el is not None:
                audio_url = enclosure_el.get("url", "")
                if audio_url:
                    return {"audio_url": audio_url, "resolved": True}

        raise HTTPException(status_code=404, detail="Could not find a matching episode in the RSS feed.")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch or parse RSS feed: {e}")


def _arxiv_pdf_url(arxiv_id: str) -> str:
    return f"https://arxiv.org/pdf/{arxiv_id}"


def _arxiv_html_available(arxiv_id: str) -> bool:
    html_url = f"https://arxiv.org/html/{arxiv_id}"
    req = urllib.request.Request(
        html_url,
        method="HEAD",
        headers={"User-Agent": "NoScroll/1.0 (paper-reader)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


@app.get("/arxiv/reader", response_model=ArxivReaderResponse)
def get_arxiv_reader(arxiv_id: str):
    """Prefer arXiv HTML when available; otherwise fall back to PDF."""
    arxiv_id = arxiv_id.strip().strip("/")
    if not ARXIV_ID_RE.match(arxiv_id):
        raise HTTPException(status_code=400, detail="Invalid arXiv ID")

    pdf_url = _arxiv_pdf_url(arxiv_id)
    if _arxiv_html_available(arxiv_id):
        return ArxivReaderResponse(format="html", url=f"https://arxiv.org/html/{arxiv_id}")
    return ArxivReaderResponse(format="pdf", url=pdf_url)


@app.get("/content/{content_id}/reader", response_model=ReaderViewResponse)
def get_reader_view(content_id: str):
    item = db.get_content_by_id(content_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Content '{content_id}' not found.")

    url = item.get("url", "")
    fallback_summary = item.get("summary") or None

    # Pre-stored body (Reddit self-posts, full RSS entries) — no scrape needed.
    stored_body = (item.get("body_text") or "").strip()
    if stored_body and len(stored_body) >= 100:
        if (
            item.get("content_type") == "article"
            and is_in_app_ready(item)
            and not item.get("reader_ready")
        ):
            db.mark_content_reader_ready(content_id, stored_body)
        return ReaderViewResponse(
            content_id=content_id,
            title=item["title"],
            author=item.get("author"),
            published_at=item.get("published_at"),
            body_html=None,
            body_text=stored_body,
            top_image=item.get("image_url"),
            success=True,
            fallback_summary=fallback_summary,
        )

    try:
        import newspaper
        article = newspaper.Article(url)
        article.download()
        article.parse()

        body_text = (article.text or "").strip()
        body_html = None

        if not body_text or len(body_text) < 100:
            return ReaderViewResponse(
                content_id=content_id,
                title=item["title"],
                author=item.get("author"),
                published_at=item.get("published_at"),
                body_html=None,
                body_text=None,
                top_image=None,
                success=False,
                fallback_summary=fallback_summary,
            )

        candidate = {**item, "body_text": body_text}
        if item.get("content_type") == "article" and is_in_app_ready(candidate):
            db.mark_content_reader_ready(content_id, body_text)

        return ReaderViewResponse(
            content_id=content_id,
            title=article.title or item["title"],
            author=", ".join(article.authors) if article.authors else item.get("author"),
            published_at=(
                article.publish_date.isoformat() if article.publish_date else item.get("published_at")
            ),
            body_html=body_html,
            body_text=body_text,
            top_image=article.top_image or None,
            success=True,
            fallback_summary=fallback_summary,
        )
    except Exception:
        return ReaderViewResponse(
            content_id=content_id,
            title=item["title"],
            author=item.get("author"),
            published_at=item.get("published_at"),
            body_html=None,
            body_text=None,
            top_image=None,
            success=False,
            fallback_summary=fallback_summary,
        )
