"""
User identity, friendship system, and friends feed.

Identity is lightweight: users pick a handle + display name once.
The token in localStorage is the auth credential — no passwords.

Friendship is symmetrical (mutual accept required, like Facebook).
"""

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

DB_PATH = Path(__file__).parent / "data" / "noscroll.db"

router = APIRouter(prefix="/identity", tags=["identity"])

# ── Schema ─────────────────────────────────────────────────────────────────────

IDENTITY_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    token        TEXT PRIMARY KEY,
    handle       TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    bio          TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);

CREATE TABLE IF NOT EXISTS friendships (
    id              TEXT PRIMARY KEY,
    requester_token TEXT NOT NULL,
    recipient_token TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE(requester_token, recipient_token)
);
CREATE INDEX IF NOT EXISTS idx_fs_requester ON friendships(requester_token);
CREATE INDEX IF NOT EXISTS idx_fs_recipient ON friendships(recipient_token);
"""


def _get_con() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def ensure_identity_schema() -> None:
    con = _get_con()
    try:
        con.executescript(IDENTITY_SCHEMA)
        con.commit()
    finally:
        con.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Pydantic models ────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    token: str
    handle: str
    display_name: str
    bio: Optional[str] = None
    created_at: str


class PublicUserOut(BaseModel):
    handle: str
    display_name: str
    bio: Optional[str] = None
    created_at: str


class SetupRequest(BaseModel):
    token: str
    handle: str = Field(..., min_length=2, max_length=30)
    display_name: str = Field(..., min_length=1, max_length=60)
    bio: Optional[str] = None


class FriendshipOut(BaseModel):
    id: str
    status: str           # pending | accepted
    direction: str        # sent | received
    other_handle: str
    other_display_name: str
    created_at: str


class FeedItemOut(BaseModel):
    saved_item_id: str
    url: str
    title: str
    content_type: str
    source: Optional[str] = None
    summary: Optional[str] = None
    thumbnail: Optional[str] = None
    note: Optional[str] = None        # caption from the recommender
    recommended_by_handle: str
    recommended_by_name: str
    collection_id: Optional[str] = None
    collection_name: Optional[str] = None
    saved_at: str


# ── Helpers ────────────────────────────────────────────────────────────────────

_HANDLE_RE = __import__("re").compile(r"^[a-zA-Z0-9_.-]+$")


def _validate_handle(handle: str) -> str:
    h = handle.strip().lower()
    if not _HANDLE_RE.match(h):
        raise HTTPException(
            status_code=400,
            detail="Handle may only contain letters, numbers, underscores, hyphens, and dots.",
        )
    return h


def _get_user(con: sqlite3.Connection, token: str) -> Optional[sqlite3.Row]:
    return con.execute("SELECT * FROM users WHERE token = ?", (token,)).fetchone()


def _require_user(con: sqlite3.Connection, token: str) -> sqlite3.Row:
    user = _get_user(con, token)
    if not user:
        raise HTTPException(status_code=404, detail="User profile not found. Please set up your profile first.")
    return user


def _friendship_for_pair(
    con: sqlite3.Connection, token_a: str, token_b: str
) -> Optional[sqlite3.Row]:
    return con.execute(
        """
        SELECT * FROM friendships
        WHERE (requester_token = ? AND recipient_token = ?)
           OR (requester_token = ? AND recipient_token = ?)
        """,
        (token_a, token_b, token_b, token_a),
    ).fetchone()


def _friend_tokens(con: sqlite3.Connection, token: str) -> List[str]:
    rows = con.execute(
        """
        SELECT CASE WHEN requester_token = ? THEN recipient_token ELSE requester_token END AS other
        FROM friendships
        WHERE (requester_token = ? OR recipient_token = ?) AND status = 'accepted'
        """,
        (token, token, token),
    ).fetchall()
    return [r["other"] for r in rows]


# ── Routes — identity ──────────────────────────────────────────────────────────

@router.post("/setup", response_model=UserOut)
def setup_identity(body: SetupRequest):
    """Create or update a user's display name, handle, and bio."""
    handle = _validate_handle(body.handle)
    con = _get_con()
    try:
        now = _now()
        existing = _get_user(con, body.token)
        if existing:
            # Check handle uniqueness (allow keeping own handle)
            clash = con.execute(
                "SELECT token FROM users WHERE handle = ? AND token != ?",
                (handle, body.token),
            ).fetchone()
            if clash:
                raise HTTPException(status_code=409, detail="That handle is already taken.")
            con.execute(
                """
                UPDATE users SET handle=?, display_name=?, bio=?, updated_at=?
                WHERE token=?
                """,
                (handle, body.display_name.strip(), body.bio, now, body.token),
            )
        else:
            clash = con.execute(
                "SELECT token FROM users WHERE handle = ?", (handle,)
            ).fetchone()
            if clash:
                raise HTTPException(status_code=409, detail="That handle is already taken.")
            con.execute(
                "INSERT INTO users (token, handle, display_name, bio, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                (body.token, handle, body.display_name.strip(), body.bio, now, now),
            )
        con.commit()
        row = con.execute("SELECT * FROM users WHERE token = ?", (body.token,)).fetchone()
        return UserOut(**dict(row))
    finally:
        con.close()


@router.get("/me/{token}", response_model=UserOut)
def get_my_identity(token: str):
    con = _get_con()
    try:
        row = _get_user(con, token)
        if not row:
            raise HTTPException(status_code=404, detail="Profile not set up yet.")
        return UserOut(**dict(row))
    finally:
        con.close()


@router.get("/by-handle/{handle}", response_model=PublicUserOut)
def get_by_handle(handle: str):
    con = _get_con()
    try:
        row = con.execute(
            "SELECT * FROM users WHERE handle = ?", (handle.lower(),)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found.")
        return PublicUserOut(**dict(row))
    finally:
        con.close()


# ── Routes — friendships ───────────────────────────────────────────────────────

class FriendRequestBody(BaseModel):
    handle: str


@router.post("/{token}/friends/request")
def send_friend_request(token: str, body: FriendRequestBody):
    """Send a friend request by handle."""
    target_handle = body.handle.strip().lower()
    if not target_handle:
        raise HTTPException(status_code=400, detail="handle is required.")
    con = _get_con()
    try:
        _require_user(con, token)
        target = con.execute(
            "SELECT * FROM users WHERE handle = ?", (target_handle,)
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="No user with that handle.")
        if target["token"] == token:
            raise HTTPException(status_code=400, detail="You can't friend yourself.")

        existing = _friendship_for_pair(con, token, target["token"])
        if existing:
            status = existing["status"]
            if status == "accepted":
                raise HTTPException(status_code=409, detail="You're already friends.")
            if status == "pending":
                if existing["requester_token"] == token:
                    raise HTTPException(status_code=409, detail="Friend request already sent.")
                else:
                    # They already sent us a request — auto-accept
                    now = _now()
                    con.execute(
                        "UPDATE friendships SET status='accepted', updated_at=? WHERE id=?",
                        (now, existing["id"]),
                    )
                    con.commit()
                    return {"status": "accepted", "message": "They already sent you a request — you're now friends!"}

        fs_id = str(uuid.uuid4())
        now = _now()
        con.execute(
            "INSERT INTO friendships (id, requester_token, recipient_token, status, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (fs_id, token, target["token"], "pending", now, now),
        )
        con.commit()
        return {"status": "pending", "friendship_id": fs_id}
    finally:
        con.close()


@router.post("/{token}/friends/{fs_id}/accept")
def accept_friend_request(token: str, fs_id: str):
    con = _get_con()
    try:
        _require_user(con, token)
        row = con.execute("SELECT * FROM friendships WHERE id = ?", (fs_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Friend request not found.")
        if row["recipient_token"] != token:
            raise HTTPException(status_code=403, detail="Not your request to accept.")
        if row["status"] != "pending":
            raise HTTPException(status_code=400, detail="Request is not pending.")
        con.execute(
            "UPDATE friendships SET status='accepted', updated_at=? WHERE id=?",
            (_now(), fs_id),
        )
        con.commit()
        return {"status": "accepted"}
    finally:
        con.close()


@router.post("/{token}/friends/{fs_id}/decline")
def decline_friend_request(token: str, fs_id: str):
    con = _get_con()
    try:
        _require_user(con, token)
        row = con.execute("SELECT * FROM friendships WHERE id = ?", (fs_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Friend request not found.")
        if row["recipient_token"] != token:
            raise HTTPException(status_code=403, detail="Not your request to decline.")
        con.execute("DELETE FROM friendships WHERE id = ?", (fs_id,))
        con.commit()
        return {"status": "declined"}
    finally:
        con.close()


@router.delete("/{token}/friends/{fs_id}")
def unfriend(token: str, fs_id: str):
    con = _get_con()
    try:
        row = con.execute("SELECT * FROM friendships WHERE id = ?", (fs_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Friendship not found.")
        if row["requester_token"] != token and row["recipient_token"] != token:
            raise HTTPException(status_code=403, detail="Not your friendship.")
        con.execute("DELETE FROM friendships WHERE id = ?", (fs_id,))
        con.commit()
        return {"status": "removed"}
    finally:
        con.close()


@router.get("/{token}/friends", response_model=List[FriendshipOut])
def list_friends(token: str):
    con = _get_con()
    try:
        rows = con.execute(
            """
            SELECT f.*,
                   u.handle AS other_handle,
                   u.display_name AS other_display_name
            FROM friendships f
            JOIN users u ON u.token = CASE
                WHEN f.requester_token = ? THEN f.recipient_token
                ELSE f.requester_token
            END
            WHERE (f.requester_token = ? OR f.recipient_token = ?)
              AND f.status = 'accepted'
            ORDER BY f.updated_at DESC
            """,
            (token, token, token),
        ).fetchall()
        return [
            FriendshipOut(
                id=r["id"],
                status=r["status"],
                direction="sent" if r["requester_token"] == token else "received",
                other_handle=r["other_handle"],
                other_display_name=r["other_display_name"],
                created_at=r["created_at"],
            )
            for r in rows
        ]
    finally:
        con.close()


@router.get("/{token}/friends/requests", response_model=List[FriendshipOut])
def list_friend_requests(token: str):
    """Pending requests received by this user."""
    con = _get_con()
    try:
        rows = con.execute(
            """
            SELECT f.*,
                   u.handle AS other_handle,
                   u.display_name AS other_display_name
            FROM friendships f
            JOIN users u ON u.token = f.requester_token
            WHERE f.recipient_token = ? AND f.status = 'pending'
            ORDER BY f.created_at DESC
            """,
            (token,),
        ).fetchall()
        return [
            FriendshipOut(
                id=r["id"],
                status="pending",
                direction="received",
                other_handle=r["other_handle"],
                other_display_name=r["other_display_name"],
                created_at=r["created_at"],
            )
            for r in rows
        ]
    finally:
        con.close()


@router.get("/{token}/friends/status/{handle}")
def friendship_status_with(token: str, handle: str):
    """Return the friendship status between this user and the one with :handle."""
    con = _get_con()
    try:
        target = con.execute(
            "SELECT token FROM users WHERE handle = ?", (handle.lower(),)
        ).fetchone()
        if not target:
            return {"status": "not_found"}
        if target["token"] == token:
            return {"status": "self"}
        row = _friendship_for_pair(con, token, target["token"])
        if not row:
            return {"status": "none"}
        return {
            "status": row["status"],
            "friendship_id": row["id"],
            "direction": "sent" if row["requester_token"] == token else "received",
        }
    finally:
        con.close()


# ── Routes — feed ──────────────────────────────────────────────────────────────

@router.get("/{token}/feed", response_model=List[FeedItemOut])
def get_friends_feed(token: str, limit: int = 30):
    """
    Recent saves from accepted friends that are in at least one public collection.
    Shows the caption as the friend's recommendation note.
    """
    con = _get_con()
    try:
        friend_tokens = _friend_tokens(con, token)
        if not friend_tokens:
            return []

        placeholders = ",".join("?" * len(friend_tokens))
        rows = con.execute(
            f"""
            SELECT
                s.id           AS saved_item_id,
                s.url,
                s.title,
                s.content_type,
                s.source,
                s.summary,
                s.thumbnail,
                s.caption      AS note,
                s.saved_at,
                u.handle       AS recommended_by_handle,
                u.display_name AS recommended_by_name,
                c.id           AS collection_id,
                c.name         AS collection_name
            FROM saved_items s
            JOIN users u ON u.token = s.user_token
            JOIN collection_items ci ON ci.saved_item_id = s.id
            JOIN collections c ON c.id = ci.collection_id AND c.is_public = 1
            WHERE s.user_token IN ({placeholders})
            GROUP BY s.id
            ORDER BY s.saved_at DESC
            LIMIT ?
            """,
            (*friend_tokens, limit),
        ).fetchall()
        return [FeedItemOut(**dict(r)) for r in rows]
    finally:
        con.close()


# ── Public profile (collections + recent saves) ────────────────────────────────

@router.get("/public/{handle}/collections")
def get_public_collections(handle: str):
    """Public collections for a user profile page."""
    con = _get_con()
    try:
        user = con.execute(
            "SELECT * FROM users WHERE handle = ?", (handle.lower(),)
        ).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found.")
        rows = con.execute(
            """
            SELECT c.*, (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
            FROM collections c
            WHERE c.user_token = ? AND c.is_public = 1
            ORDER BY c.updated_at DESC
            """,
            (user["token"],),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()
