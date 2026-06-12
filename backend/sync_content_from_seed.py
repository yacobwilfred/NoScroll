"""
Merge bundled content corpus (contents + embeddings) into the live SQLite DB.

Preserves profile tables (users, saved_items, friendships, collections).
Triggered on API startup when CONTENT_DB_SEED_VERSION env changes.
"""

from __future__ import annotations

import gzip
import shutil
import sqlite3
import tempfile
from pathlib import Path

CONTENT_COLS = (
    "title", "url", "content_type", "cluster_id", "source", "summary", "author",
    "published_at", "duration_minutes", "read_time_minutes", "language", "seed_query",
    "ingested_at", "cognitive_load", "vibe", "category", "format", "image_url",
    "reader_ready", "body_text",
)


def _decompress_seed(seed_gz: Path) -> Path:
    tmp = Path(tempfile.mkstemp(suffix=".db", prefix="noscroll-seed-")[1])
    with gzip.open(seed_gz, "rb") as f_in, open(tmp, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    return tmp


def merge_seed_into_db(seed_db: Path, target_db: Path) -> dict:
    """Upsert contents by URL and refresh embeddings from seed. Returns stats."""
    target_db.parent.mkdir(parents=True, exist_ok=True)

    seed_con = sqlite3.connect(seed_db)
    seed_con.row_factory = sqlite3.Row
    seed_rows = seed_con.execute("SELECT * FROM contents").fetchall()
    seed_count = len(seed_rows)

    embedding_rows = seed_con.execute(
        """
        SELECT c.url, e.vector
        FROM embeddings e
        JOIN contents c ON c.id = e.content_id
        """
    ).fetchall()
    seed_con.close()

    con = sqlite3.connect(target_db)
    con.row_factory = sqlite3.Row
    try:
        inserted = 0
        updated = 0

        update_set = ", ".join(f"{c} = ?" for c in CONTENT_COLS if c != "url")

        for row in seed_rows:
            existing = con.execute(
                "SELECT id FROM contents WHERE url = ?", (row["url"],)
            ).fetchone()

            if existing:
                values = tuple(row[c] for c in CONTENT_COLS if c != "url") + (row["url"],)
                con.execute(
                    f"UPDATE contents SET {update_set} WHERE url = ?",
                    values,
                )
                updated += 1
            else:
                cols = ("id",) + CONTENT_COLS
                placeholders = ", ".join("?" for _ in cols)
                con.execute(
                    f"INSERT INTO contents ({', '.join(cols)}) VALUES ({placeholders})",
                    tuple(row[c] for c in cols),
                )
                inserted += 1

        url_to_live_id = {
            r["url"]: r["id"] for r in con.execute("SELECT id, url FROM contents")
        }

        embeddings_written = 0
        for row in embedding_rows:
            live_id = url_to_live_id.get(row["url"])
            if not live_id:
                continue
            con.execute(
                """
                INSERT INTO embeddings (content_id, vector)
                VALUES (?, ?)
                ON CONFLICT(content_id) DO UPDATE SET vector = excluded.vector
                """,
                (live_id, row["vector"]),
            )
            embeddings_written += 1

        con.commit()
    finally:
        con.close()

    from db import ensure_fts_index

    ensure_fts_index()

    live_count = sqlite3.connect(target_db).execute("SELECT COUNT(*) FROM contents").fetchone()[0]

    return {
        "seed_contents": seed_count,
        "inserted": inserted,
        "updated": updated,
        "embeddings_written": embeddings_written,
        "live_contents": live_count,
    }


def maybe_sync_from_bundled_seed(db_path: Path, seed_gz: Path, version: str, marker_path: Path) -> bool:
    """
    If `version` differs from marker on disk, merge seed gzip into db_path.
    Returns True when a sync ran.
    """
    version = (version or "").strip()
    if not version:
        return False

    if marker_path.exists() and marker_path.read_text(encoding="utf-8").strip() == version:
        print(f"[startup] content seed already at version {version}")
        return False

    if not seed_gz.exists():
        print(f"[startup] content seed bundle missing: {seed_gz}")
        return False

    print(f"[startup] merging content corpus from seed (version {version})…")
    tmp_seed = _decompress_seed(seed_gz)
    try:
        stats = merge_seed_into_db(tmp_seed, db_path)
        print(
            f"[startup] content sync done: seed={stats['seed_contents']} "
            f"inserted={stats['inserted']} updated={stats['updated']} "
            f"embeddings={stats['embeddings_written']} live_total={stats['live_contents']}"
        )
    finally:
        tmp_seed.unlink(missing_ok=True)

    marker_path.parent.mkdir(parents=True, exist_ok=True)
    marker_path.write_text(version, encoding="utf-8")
    return True
