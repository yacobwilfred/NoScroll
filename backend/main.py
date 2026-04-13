import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import urllib.request
import xml.etree.ElementTree as ET

import db
import session as session_manager
import user_profile as profile_router
import identity as identity_router
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

app = FastAPI(
    title="NoScroll API",
    description="Mindful content discovery through multidirectional navigation.",
    version="0.1.0",
)


@app.on_event("startup")
def startup_event():
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
    if not body.prompt or not body.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt must not be empty.")
    try:
        session_id, center_node, directions = session_manager.start_session(body.prompt.strip())
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
    )


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


@app.get("/content/{content_id}/reader", response_model=ReaderViewResponse)
def get_reader_view(content_id: str):
    item = db.get_content_by_id(content_id)
    if item is None:
        raise HTTPException(status_code=404, detail=f"Content '{content_id}' not found.")

    url = item.get("url", "")
    fallback_summary = item.get("summary") or None

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
