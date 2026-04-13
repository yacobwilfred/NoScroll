"""
Profile: saved items + collections.

Identity is token-based (UUID stored in the browser's localStorage).
No passwords or OAuth needed for the prototype.
"""

import sqlite3
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

DB_PATH = Path(__file__).parent / "data" / "noscroll.db"

router = APIRouter(prefix="/profile", tags=["profile"])

# ── Schema ────────────────────────────────────────────────────────────────────

PROFILE_SCHEMA = """
CREATE TABLE IF NOT EXISTS saved_items (
    id           TEXT PRIMARY KEY,
    user_token   TEXT NOT NULL,
    url          TEXT NOT NULL,
    title        TEXT NOT NULL,
    content_type TEXT NOT NULL,
    source       TEXT,
    summary      TEXT,
    thumbnail    TEXT,
    author       TEXT,
    caption      TEXT,
    duration_minutes  INTEGER,
    read_time_minutes INTEGER,
    saved_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_items(user_token);

CREATE TABLE IF NOT EXISTS collections (
    id          TEXT PRIMARY KEY,
    user_token  TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    is_public   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_col_user ON collections(user_token);

CREATE TABLE IF NOT EXISTS collection_items (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    saved_item_id TEXT NOT NULL REFERENCES saved_items(id)  ON DELETE CASCADE,
    added_at      TEXT NOT NULL,
    PRIMARY KEY (collection_id, saved_item_id)
);
"""


def _get_con() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def ensure_profile_schema() -> None:
    con = _get_con()
    try:
        con.executescript(PROFILE_SCHEMA)
        # Migrate: add caption column to existing tables that predate it
        try:
            con.execute("ALTER TABLE saved_items ADD COLUMN caption TEXT")
            con.commit()
        except sqlite3.OperationalError:
            pass  # column already exists
    finally:
        con.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Pydantic models ───────────────────────────────────────────────────────────

class SavedItemOut(BaseModel):
    id: str
    url: str
    title: str
    content_type: str
    source: Optional[str] = None
    summary: Optional[str] = None
    thumbnail: Optional[str] = None
    author: Optional[str] = None
    caption: Optional[str] = None
    duration_minutes: Optional[int] = None
    read_time_minutes: Optional[int] = None
    saved_at: str
    collection_ids: List[str] = []


class SaveItemRequest(BaseModel):
    user_token: str
    url: str
    title: str
    content_type: str
    source: Optional[str] = None
    summary: Optional[str] = None
    thumbnail: Optional[str] = None
    author: Optional[str] = None
    caption: Optional[str] = None
    duration_minutes: Optional[int] = None
    read_time_minutes: Optional[int] = None
    # If provided, the item is added to this collection atomically after saving
    collection_id: Optional[str] = None
    # If provided (and collection_id is None), a new collection with this name is created
    new_collection_name: Optional[str] = None


class CollectionOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    is_public: bool
    created_at: str
    updated_at: str
    item_count: int = 0


class CreateCollectionRequest(BaseModel):
    user_token: str
    name: str
    description: Optional[str] = None
    is_public: bool = True


class UpdateCollectionRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None


class AddToCollectionRequest(BaseModel):
    saved_item_id: str


class ExtractRequest(BaseModel):
    url: str


class ExtractResponse(BaseModel):
    url: str
    title: Optional[str] = None
    content_type: str = "article"
    source: Optional[str] = None
    summary: Optional[str] = None
    thumbnail: Optional[str] = None
    author: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(row)


def _collection_ids_for_item(con: sqlite3.Connection, saved_item_id: str) -> List[str]:
    rows = con.execute(
        "SELECT collection_id FROM collection_items WHERE saved_item_id = ?",
        (saved_item_id,),
    ).fetchall()
    return [r["collection_id"] for r in rows]


def _saved_item_out(row: sqlite3.Row, con: sqlite3.Connection) -> SavedItemOut:
    d = _row(row)
    d["collection_ids"] = _collection_ids_for_item(con, d["id"])
    return SavedItemOut(**d)


def _collection_out(row: sqlite3.Row, con: sqlite3.Connection) -> CollectionOut:
    d = _row(row)
    count = con.execute(
        "SELECT COUNT(*) FROM collection_items WHERE collection_id = ?", (d["id"],)
    ).fetchone()[0]
    return CollectionOut(
        id=d["id"],
        name=d["name"],
        description=d.get("description"),
        is_public=bool(d["is_public"]),
        created_at=d["created_at"],
        updated_at=d["updated_at"],
        item_count=count,
    )


def _assert_token_owns_item(con: sqlite3.Connection, user_token: str, item_id: str) -> None:
    row = con.execute(
        "SELECT user_token FROM saved_items WHERE id = ?", (item_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Saved item not found.")
    if row["user_token"] != user_token:
        raise HTTPException(status_code=403, detail="Not your item.")


def _assert_token_owns_collection(con: sqlite3.Connection, user_token: str, col_id: str) -> None:
    row = con.execute(
        "SELECT user_token FROM collections WHERE id = ?", (col_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Collection not found.")
    if row["user_token"] != user_token:
        raise HTTPException(status_code=403, detail="Not your collection.")


# ── URL metadata extraction ───────────────────────────────────────────────────

def _get_youtube_id(url: str) -> Optional[str]:
    try:
        from urllib.parse import urlparse, parse_qs
        p = urlparse(url)
        if "youtu.be" in p.netloc:
            return p.path.lstrip("/").split("/")[0]
        if "youtube.com" in p.netloc:
            return parse_qs(p.query).get("v", [None])[0]
    except Exception:
        pass
    return None


def _extract_og_tags(html: str) -> Dict[str, Optional[str]]:
    def og(prop: str) -> Optional[str]:
        m = re.search(
            rf'<meta[^>]+property=["\']og:{prop}["\'][^>]+content=["\']([^"\']+)["\']',
            html, re.I,
        ) or re.search(
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:{prop}["\']',
            html, re.I,
        )
        return m.group(1) if m else None

    def meta(name: str) -> Optional[str]:
        m = re.search(
            rf'<meta[^>]+name=["\']({name})["\'][^>]+content=["\']([^"\']+)["\']',
            html, re.I,
        ) or re.search(
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']({name})["\']',
            html, re.I,
        )
        return m.group(2) if m else None

    title_m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
    return {
        "title":       og("title") or (title_m.group(1).strip() if title_m else None),
        "description": og("description") or meta("description"),
        "image":       og("image"),
        "site_name":   og("site_name"),
        "type":        og("type"),
    }


def extract_url_metadata(url: str) -> ExtractResponse:
    yt_id = _get_youtube_id(url)
    if yt_id:
        try:
            oembed_url = f"https://www.youtube.com/oembed?url={url}&format=json"
            req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
            import json
            with urllib.request.urlopen(req, timeout=8) as r:
                data = json.loads(r.read())
            return ExtractResponse(
                url=url,
                title=data.get("title"),
                content_type="video",
                source="YouTube",
                author=data.get("author_name"),
                thumbnail=f"https://img.youtube.com/vi/{yt_id}/hqdefault.jpg",
            )
        except Exception:
            pass

    if "arxiv.org" in url:
        m = re.search(r"arxiv\.org/(?:abs|pdf)/([^\s/?#]+)", url)
        if m:
            arxiv_id = m.group(1)
            try:
                api_url = f"http://export.arxiv.org/api/query?id_list={arxiv_id}"
                req = urllib.request.Request(api_url, headers={"User-Agent": "Mozilla/5.0"})
                import xml.etree.ElementTree as ET
                with urllib.request.urlopen(req, timeout=8) as r:
                    root = ET.fromstring(r.read())
                ns = {"atom": "http://www.w3.org/2005/Atom"}
                entry = root.find("atom:entry", ns)
                if entry is not None:
                    title = (entry.findtext("atom:title", namespaces=ns) or "").strip()
                    summary = (entry.findtext("atom:summary", namespaces=ns) or "").strip()
                    authors = [
                        (a.findtext("atom:name", namespaces=ns) or "").strip()
                        for a in entry.findall("atom:author", ns)
                    ]
                    return ExtractResponse(
                        url=url,
                        title=title,
                        content_type="paper",
                        source="arXiv",
                        summary=summary[:400] if summary else None,
                        author=", ".join(authors[:3]) if authors else None,
                    )
            except Exception:
                pass

    # Generic OG/meta scrape
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            html = r.read(80_000).decode("utf-8", errors="replace")
        og = _extract_og_tags(html)
        og_type = (og.get("type") or "").lower()
        if "video" in og_type:
            ct = "video"
        elif "music" in og_type or "audio" in og_type:
            ct = "podcast"
        else:
            ct = "article"
        try:
            source = url.split("/")[2].replace("www.", "")
        except Exception:
            source = None
        return ExtractResponse(
            url=url,
            title=og.get("title"),
            content_type=ct,
            source=source,
            summary=og.get("description"),
            thumbnail=og.get("image"),
        )
    except Exception:
        try:
            source = url.split("/")[2].replace("www.", "")
        except Exception:
            source = None
        return ExtractResponse(url=url, content_type="article", source=source)


# ── Routes ────────────────────────────────────────────────────────────────────

# -- Saved items --

@router.post("/{token}/saved", response_model=SavedItemOut)
def save_item(token: str, body: SaveItemRequest):
    if body.user_token != token:
        raise HTTPException(status_code=403, detail="Token mismatch.")
    con = _get_con()
    try:
        # Check if URL already saved by this user; if so, update caption and return
        existing = con.execute(
            "SELECT * FROM saved_items WHERE user_token = ? AND url = ?",
            (token, body.url),
        ).fetchone()

        now = _now()

        if existing:
            item_id = existing["id"]
            # Update caption if provided
            if body.caption is not None:
                con.execute(
                    "UPDATE saved_items SET caption = ? WHERE id = ?",
                    (body.caption, item_id),
                )
                con.commit()
        else:
            item_id = str(uuid.uuid4())
            con.execute(
                """
                INSERT INTO saved_items
                  (id, user_token, url, title, content_type, source, summary,
                   thumbnail, author, caption, duration_minutes, read_time_minutes, saved_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    item_id, token, body.url, body.title, body.content_type,
                    body.source, body.summary, body.thumbnail, body.author,
                    body.caption, body.duration_minutes, body.read_time_minutes, now,
                ),
            )
            con.commit()

        # Resolve collection: use provided id, or create a new one
        col_id = body.collection_id
        if not col_id and body.new_collection_name and body.new_collection_name.strip():
            col_id = str(uuid.uuid4())
            con.execute(
                "INSERT INTO collections (id, user_token, name, description, is_public, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                (col_id, token, body.new_collection_name.strip(), None, 1, now, now),
            )
            con.commit()

        # Add to collection if one was resolved
        if col_id:
            col_row = con.execute("SELECT user_token FROM collections WHERE id = ?", (col_id,)).fetchone()
            if col_row and col_row["user_token"] == token:
                already = con.execute(
                    "SELECT 1 FROM collection_items WHERE collection_id = ? AND saved_item_id = ?",
                    (col_id, item_id),
                ).fetchone()
                if not already:
                    con.execute(
                        "INSERT INTO collection_items (collection_id, saved_item_id, added_at) VALUES (?,?,?)",
                        (col_id, item_id, now),
                    )
                    con.execute(
                        "UPDATE collections SET updated_at = ? WHERE id = ?", (now, col_id)
                    )
                    con.commit()

        row = con.execute("SELECT * FROM saved_items WHERE id = ?", (item_id,)).fetchone()
        return _saved_item_out(row, con)
    finally:
        con.close()


@router.delete("/{token}/saved/{item_id}", status_code=204)
def unsave_item(token: str, item_id: str):
    con = _get_con()
    try:
        _assert_token_owns_item(con, token, item_id)
        con.execute("DELETE FROM saved_items WHERE id = ?", (item_id,))
        con.commit()
    finally:
        con.close()


@router.get("/{token}/saved", response_model=List[SavedItemOut])
def list_saved(token: str):
    con = _get_con()
    try:
        rows = con.execute(
            "SELECT * FROM saved_items WHERE user_token = ? ORDER BY saved_at DESC",
            (token,),
        ).fetchall()
        return [_saved_item_out(r, con) for r in rows]
    finally:
        con.close()


# -- Collections --

@router.post("/{token}/collections", response_model=CollectionOut)
def create_collection(token: str, body: CreateCollectionRequest):
    if body.user_token != token:
        raise HTTPException(status_code=403, detail="Token mismatch.")
    con = _get_con()
    try:
        col_id = str(uuid.uuid4())
        now = _now()
        con.execute(
            """
            INSERT INTO collections (id, user_token, name, description, is_public, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?)
            """,
            (col_id, token, body.name.strip(), body.description, int(body.is_public), now, now),
        )
        con.commit()
        row = con.execute("SELECT * FROM collections WHERE id = ?", (col_id,)).fetchone()
        return _collection_out(row, con)
    finally:
        con.close()


@router.get("/{token}/collections", response_model=List[CollectionOut])
def list_collections(token: str):
    con = _get_con()
    try:
        rows = con.execute(
            "SELECT * FROM collections WHERE user_token = ? ORDER BY updated_at DESC",
            (token,),
        ).fetchall()
        return [_collection_out(r, con) for r in rows]
    finally:
        con.close()


@router.patch("/{token}/collections/{col_id}", response_model=CollectionOut)
def update_collection(token: str, col_id: str, body: UpdateCollectionRequest):
    con = _get_con()
    try:
        _assert_token_owns_collection(con, token, col_id)
        updates = {}
        if body.name is not None:
            updates["name"] = body.name.strip()
        if body.description is not None:
            updates["description"] = body.description
        if body.is_public is not None:
            updates["is_public"] = int(body.is_public)
        if updates:
            updates["updated_at"] = _now()
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            con.execute(
                f"UPDATE collections SET {set_clause} WHERE id = ?",
                list(updates.values()) + [col_id],
            )
            con.commit()
        row = con.execute("SELECT * FROM collections WHERE id = ?", (col_id,)).fetchone()
        return _collection_out(row, con)
    finally:
        con.close()


@router.delete("/{token}/collections/{col_id}", status_code=204)
def delete_collection(token: str, col_id: str):
    con = _get_con()
    try:
        _assert_token_owns_collection(con, token, col_id)
        con.execute("DELETE FROM collections WHERE id = ?", (col_id,))
        con.commit()
    finally:
        con.close()


# -- Collection items --

@router.post("/{token}/collections/{col_id}/items", status_code=201)
def add_to_collection(token: str, col_id: str, body: AddToCollectionRequest):
    con = _get_con()
    try:
        _assert_token_owns_collection(con, token, col_id)
        _assert_token_owns_item(con, token, body.saved_item_id)
        existing = con.execute(
            "SELECT 1 FROM collection_items WHERE collection_id = ? AND saved_item_id = ?",
            (col_id, body.saved_item_id),
        ).fetchone()
        if not existing:
            con.execute(
                "INSERT INTO collection_items (collection_id, saved_item_id, added_at) VALUES (?,?,?)",
                (col_id, body.saved_item_id, _now()),
            )
            con.execute(
                "UPDATE collections SET updated_at = ? WHERE id = ?", (_now(), col_id)
            )
            con.commit()
    finally:
        con.close()
    return {"ok": True}


@router.delete("/{token}/collections/{col_id}/items/{item_id}", status_code=204)
def remove_from_collection(token: str, col_id: str, item_id: str):
    con = _get_con()
    try:
        _assert_token_owns_collection(con, token, col_id)
        con.execute(
            "DELETE FROM collection_items WHERE collection_id = ? AND saved_item_id = ?",
            (col_id, item_id),
        )
        con.execute(
            "UPDATE collections SET updated_at = ? WHERE id = ?", (_now(), col_id)
        )
        con.commit()
    finally:
        con.close()


@router.get("/{token}/collections/{col_id}/items", response_model=List[SavedItemOut])
def list_collection_items(token: str, col_id: str):
    con = _get_con()
    try:
        # Owner sees private collections; anyone with the id sees public ones
        col = con.execute("SELECT * FROM collections WHERE id = ?", (col_id,)).fetchone()
        if not col:
            raise HTTPException(status_code=404, detail="Collection not found.")
        if not col["is_public"] and col["user_token"] != token:
            raise HTTPException(status_code=403, detail="This collection is private.")
        rows = con.execute(
            """
            SELECT s.* FROM saved_items s
            JOIN collection_items ci ON ci.saved_item_id = s.id
            WHERE ci.collection_id = ?
            ORDER BY ci.added_at DESC
            """,
            (col_id,),
        ).fetchall()
        return [_saved_item_out(r, con) for r in rows]
    finally:
        con.close()


# -- Public collection view (no token required) --

@router.get("/c/{col_id}", response_model=CollectionOut)
def get_public_collection(col_id: str):
    con = _get_con()
    try:
        row = con.execute(
            "SELECT * FROM collections WHERE id = ? AND is_public = 1", (col_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Collection not found or is private.")
        return _collection_out(row, con)
    finally:
        con.close()


@router.get("/c/{col_id}/items", response_model=List[SavedItemOut])
def get_public_collection_items(col_id: str):
    con = _get_con()
    try:
        col = con.execute(
            "SELECT * FROM collections WHERE id = ? AND is_public = 1", (col_id,)
        ).fetchone()
        if not col:
            raise HTTPException(status_code=404, detail="Collection not found or is private.")
        rows = con.execute(
            """
            SELECT s.* FROM saved_items s
            JOIN collection_items ci ON ci.saved_item_id = s.id
            WHERE ci.collection_id = ?
            ORDER BY ci.added_at DESC
            """,
            (col_id,),
        ).fetchall()
        return [_saved_item_out(r, con) for r in rows]
    finally:
        con.close()


# -- Profile stats --

@router.get("/{token}/stats")
def get_profile_stats(token: str):
    con = _get_con()
    try:
        saved_count = con.execute(
            "SELECT COUNT(*) FROM saved_items WHERE user_token = ?", (token,)
        ).fetchone()[0]
        collection_count = con.execute(
            "SELECT COUNT(*) FROM collections WHERE user_token = ?", (token,)
        ).fetchone()[0]
        last_saved = con.execute(
            "SELECT saved_at FROM saved_items WHERE user_token = ? ORDER BY saved_at DESC LIMIT 1",
            (token,),
        ).fetchone()
        return {
            "saved_count": saved_count,
            "collection_count": collection_count,
            "last_saved_at": last_saved["saved_at"] if last_saved else None,
        }
    finally:
        con.close()


# -- External URL extraction --

@router.post("/extract", response_model=ExtractResponse)
def extract_url(body: ExtractRequest):
    if not body.url.startswith("http"):
        raise HTTPException(status_code=400, detail="Must be a full URL starting with http.")
    return extract_url_metadata(body.url)
