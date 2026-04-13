import re
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import numpy as np
    _NUMPY_AVAILABLE = True
except ImportError:
    _NUMPY_AVAILABLE = False

DB_PATH = Path(__file__).parent / "data" / "noscroll.db"

_FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS contents_fts USING fts5(
    content_id,
    title,
    summary,
    tokenize='unicode61'
);
"""


def get_connection() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


def row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return dict(row)


# ── FTS index ─────────────────────────────────────────────────────────────────

def ensure_fts_index() -> None:
    """
    Create the FTS5 virtual table if absent, then (re)populate it whenever
    the row counts diverge (e.g. after a new ingestion run).
    Safe to call on every app startup — cheap when already in sync.
    """
    con = get_connection()
    try:
        con.executescript(_FTS_SCHEMA)

        fts_count = con.execute("SELECT COUNT(*) FROM contents_fts").fetchone()[0]
        src_count = con.execute("SELECT COUNT(*) FROM contents").fetchone()[0]

        if fts_count != src_count:
            con.execute("DELETE FROM contents_fts")
            con.execute("""
                INSERT INTO contents_fts (content_id, title, summary)
                SELECT id, COALESCE(title, ''), COALESCE(summary, '')
                FROM contents
            """)
            con.commit()
            print(f"[fts] index rebuilt: {src_count} rows")
    finally:
        con.close()


def _sanitize_fts_keywords(keywords: List[str]) -> str:
    """
    Build a safe FTS5 query string.
    Each keyword is quoted so special chars can't break the parser.
    Terms are joined with OR so any match scores; BM25 still ranks
    items that match more terms higher.
    """
    cleaned = []
    for kw in keywords:
        # Strip characters that would break FTS5 quoting
        kw = re.sub(r'["\*\(\)\:]', "", kw).strip()
        if kw:
            cleaned.append(f'"{kw}"')
    return " OR ".join(cleaned)


# ── Query helpers ─────────────────────────────────────────────────────────────

def get_content_by_id(content_id: str) -> Optional[Dict[str, Any]]:
    con = get_connection()
    try:
        row = con.execute(
            "SELECT * FROM contents WHERE id = ?", (content_id,)
        ).fetchone()
        return row_to_dict(row) if row else None
    finally:
        con.close()


def search_contents(
    *,
    keywords: List[str],
    cluster_id: Optional[str] = None,
    content_type: Optional[str] = None,
    exclude_ids: Optional[List[str]] = None,
    limit: int = 40,
) -> List[Dict[str, Any]]:
    """
    Full-text search using FTS5 with BM25 ranking.
    Falls back to a simple LIKE query if FTS is unavailable or the query fails.
    """
    if not keywords:
        return get_random_content(
            cluster_id=cluster_id, exclude_ids=exclude_ids, limit=limit
        )

    con = get_connection()
    try:
        fts_query = _sanitize_fts_keywords(keywords)
        if not fts_query:
            return get_random_content(
                cluster_id=cluster_id, exclude_ids=exclude_ids, limit=limit
            )

        # FTS join — SELECT c.* preserves only contents columns (no rank bleed)
        sql = """
            SELECT c.*
            FROM contents_fts fts
            JOIN contents c ON c.id = fts.content_id
            WHERE contents_fts MATCH ?
        """
        params: List[Any] = [fts_query]

        if cluster_id:
            sql += " AND c.cluster_id = ?"
            params.append(cluster_id)
        if content_type:
            sql += " AND c.content_type = ?"
            params.append(content_type)
        if exclude_ids:
            placeholders = ",".join("?" * len(exclude_ids))
            sql += f" AND c.id NOT IN ({placeholders})"
            params.extend(exclude_ids)

        # BM25 rank: lower value = more relevant in SQLite FTS5
        sql += " ORDER BY fts.rank LIMIT ?"
        params.append(limit)

        rows = con.execute(sql, params).fetchall()
        if rows:
            return [row_to_dict(r) for r in rows]

        # No FTS hits — fall through to LIKE fallback below
    except Exception as exc:
        print(f"[warn] FTS search failed ({exc}), falling back to LIKE")
    finally:
        con.close()

    return _search_like_fallback(
        keywords=keywords,
        cluster_id=cluster_id,
        content_type=content_type,
        exclude_ids=exclude_ids,
        limit=limit,
    )


def _search_like_fallback(
    *,
    keywords: List[str],
    cluster_id: Optional[str] = None,
    content_type: Optional[str] = None,
    exclude_ids: Optional[List[str]] = None,
    limit: int = 40,
) -> List[Dict[str, Any]]:
    """Original LIKE-based search, used as a fallback."""
    con = get_connection()
    try:
        conditions: List[str] = []
        params: List[Any] = []

        if keywords:
            kw_parts = []
            for kw in keywords:
                like = f"%{kw.lower()}%"
                kw_parts.append(
                    "(LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(cluster_id) LIKE ?)"
                )
                params.extend([like, like, like])
            conditions.append("(" + " OR ".join(kw_parts) + ")")

        if cluster_id:
            conditions.append("cluster_id = ?")
            params.append(cluster_id)
        if content_type:
            conditions.append("content_type = ?")
            params.append(content_type)
        if exclude_ids:
            placeholders = ",".join("?" * len(exclude_ids))
            conditions.append(f"id NOT IN ({placeholders})")
            params.extend(exclude_ids)

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        rows = con.execute(
            f"SELECT * FROM contents {where} ORDER BY RANDOM() LIMIT ?",
            params + [limit],
        ).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        con.close()


def get_contents_by_cluster(
    cluster_id: str,
    *,
    exclude_ids: Optional[List[str]] = None,
    content_type: Optional[str] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    con = get_connection()
    try:
        conditions = ["cluster_id = ?"]
        params: List[Any] = [cluster_id]

        if content_type:
            conditions.append("content_type = ?")
            params.append(content_type)
        if exclude_ids:
            placeholders = ",".join("?" * len(exclude_ids))
            conditions.append(f"id NOT IN ({placeholders})")
            params.extend(exclude_ids)

        where = "WHERE " + " AND ".join(conditions)
        rows = con.execute(
            f"SELECT * FROM contents {where} ORDER BY RANDOM() LIMIT ?",
            params + [limit],
        ).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        con.close()


# ── Embedding helpers ─────────────────────────────────────────────────────────

def ensure_embeddings_table() -> None:
    con = get_connection()
    try:
        con.execute("""
            CREATE TABLE IF NOT EXISTS embeddings (
                content_id TEXT PRIMARY KEY,
                vector     BLOB NOT NULL
            )
        """)
        con.commit()
    finally:
        con.close()


def get_embedding(content_id: str) -> Optional[bytes]:
    con = get_connection()
    try:
        row = con.execute(
            "SELECT vector FROM embeddings WHERE content_id = ?", (content_id,)
        ).fetchone()
        return row[0] if row else None
    finally:
        con.close()


def get_similar_in_cluster(
    center_vector: bytes,
    cluster_id: str,
    exclude_ids: Optional[List[str]] = None,
    limit: int = 3,
) -> List[Dict[str, Any]]:
    """
    Return up to `limit` items from `cluster_id` ordered by cosine similarity
    to `center_vector`. Requires numpy + a populated embeddings table.
    """
    if not _NUMPY_AVAILABLE:
        return []

    con = get_connection()
    try:
        conditions = ["c.cluster_id = ?"]
        params: List[Any] = [cluster_id]

        if exclude_ids:
            placeholders = ",".join("?" * len(exclude_ids))
            conditions.append(f"c.id NOT IN ({placeholders})")
            params.extend(exclude_ids)

        where = "WHERE " + " AND ".join(conditions)
        rows = con.execute(
            f"""
            SELECT c.*, e.vector
            FROM embeddings e
            JOIN contents c ON c.id = e.content_id
            {where}
            """,
            params,
        ).fetchall()

        if not rows:
            return []

        center_vec = np.frombuffer(center_vector, dtype=np.float32)
        scored = []
        for row in rows:
            vec = np.frombuffer(row["vector"], dtype=np.float32)
            # Normalized vectors → dot product == cosine similarity
            sim = float(np.dot(center_vec, vec))
            scored.append((sim, row))

        scored.sort(key=lambda x: -x[0])
        result = []
        for _, row in scored[:limit]:
            d = dict(row)
            d.pop("vector", None)
            result.append(d)
        return result
    finally:
        con.close()


def get_nearest_neighbor(
    vector: bytes,
    *,
    exclude_ids: Optional[List[str]] = None,
    cluster_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Linear scan over all embeddings to find the most similar content item.
    Fast enough for ~3-5k items (~1ms with numpy).
    """
    if not _NUMPY_AVAILABLE:
        return None

    con = get_connection()
    try:
        conditions: List[str] = []
        params: List[Any] = []

        if cluster_id:
            conditions.append("c.cluster_id = ?")
            params.append(cluster_id)
        if exclude_ids:
            placeholders = ",".join("?" * len(exclude_ids))
            conditions.append(f"c.id NOT IN ({placeholders})")
            params.extend(exclude_ids)

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        rows = con.execute(
            f"""
            SELECT c.*, e.vector
            FROM embeddings e
            JOIN contents c ON c.id = e.content_id
            {where}
            """,
            params,
        ).fetchall()

        if not rows:
            return None

        query_vec = np.frombuffer(vector, dtype=np.float32)
        best_row = None
        best_sim = -2.0

        for row in rows:
            vec = np.frombuffer(row["vector"], dtype=np.float32)
            sim = float(np.dot(query_vec, vec))
            if sim > best_sim:
                best_sim = sim
                best_row = row

        if best_row is None:
            return None
        d = dict(best_row)
        d.pop("vector", None)
        return d
    finally:
        con.close()


def get_random_content(
    *,
    exclude_ids: Optional[List[str]] = None,
    cluster_id: Optional[str] = None,
    limit: int = 1,
) -> List[Dict[str, Any]]:
    con = get_connection()
    try:
        conditions: List[str] = []
        params: List[Any] = []

        if cluster_id:
            conditions.append("cluster_id = ?")
            params.append(cluster_id)
        if exclude_ids:
            placeholders = ",".join("?" * len(exclude_ids))
            conditions.append(f"id NOT IN ({placeholders})")
            params.extend(exclude_ids)

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        rows = con.execute(
            f"SELECT * FROM contents {where} ORDER BY RANDOM() LIMIT ?",
            params + [limit],
        ).fetchall()
        return [row_to_dict(r) for r in rows]
    finally:
        con.close()
