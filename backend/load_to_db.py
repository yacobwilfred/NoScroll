import argparse
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
import sys
import os

DEFAULT_DB_PATH   = Path(__file__).parent / "data" / "noscroll.db"
DEFAULT_JSON_PATH = Path(__file__).parent / "creative_content_metadata.json"

SCHEMA = """
CREATE TABLE IF NOT EXISTS contents (
    id                TEXT PRIMARY KEY,
    title             TEXT NOT NULL,
    url               TEXT UNIQUE NOT NULL,
    content_type      TEXT NOT NULL,
    cluster_id        TEXT NOT NULL,
    source            TEXT,
    summary           TEXT,
    author            TEXT,
    published_at      TEXT,
    duration_minutes  INTEGER,
    read_time_minutes INTEGER,
    language          TEXT DEFAULT 'en',
    seed_query        TEXT,
    ingested_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_content_type ON contents(content_type);
CREATE INDEX IF NOT EXISTS idx_cluster_id   ON contents(cluster_id);

CREATE TABLE IF NOT EXISTS ingestion_runs (
    run_id         TEXT PRIMARY KEY,
    generated_at   TEXT NOT NULL,
    source_file    TEXT,
    target_total   INTEGER,
    actual_total   INTEGER,
    inserted_count INTEGER,
    skipped_count  INTEGER
);
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Load content metadata JSON into SQLite.")
    parser.add_argument("--input",  default=str(DEFAULT_JSON_PATH), help="Path to metadata JSON file.")
    parser.add_argument("--db",     default=str(DEFAULT_DB_PATH),   help="Path to SQLite database.")
    args = parser.parse_args()

    json_path = Path(args.input)
    db_path   = Path(args.db)

    db_path.parent.mkdir(parents=True, exist_ok=True)

    if not json_path.exists():
        raise FileNotFoundError(f"Metadata file not found: {json_path}")

    with json_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    items = payload.get("items", [])
    now   = datetime.now(timezone.utc).isoformat()

    con = sqlite3.connect(db_path)
    con.executescript(SCHEMA)

    inserted = 0
    skipped  = 0

    for item in items:
        # Always generate a fresh UUID so sequential-ID collisions never block
        # a new URL from being inserted. URL uniqueness handles deduplication.
        new_id = str(uuid.uuid4())
        try:
            con.execute(
                """
                INSERT OR IGNORE INTO contents
                  (id, title, url, content_type, cluster_id, source, summary,
                   author, published_at, duration_minutes, read_time_minutes,
                   language, seed_query, ingested_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    new_id,
                    item["title"],
                    item["url"],
                    item["content_type"],
                    item["cluster_id"],
                    item.get("source"),
                    item.get("summary"),
                    item.get("author"),
                    item.get("published_at"),
                    item.get("duration_minutes"),
                    item.get("read_time_minutes"),
                    item.get("language", "en"),
                    item.get("seed_query"),
                    now,
                ),
            )
            if con.execute("SELECT changes()").fetchone()[0]:
                inserted += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"[warn] skipped item {item.get('url')}: {e}")
            skipped += 1

    run_id = str(uuid.uuid4())
    con.execute(
        """
        INSERT INTO ingestion_runs
          (run_id, generated_at, source_file, target_total, actual_total, inserted_count, skipped_count)
        VALUES (?,?,?,?,?,?,?)
        """,
        (
            run_id,
            payload.get("generated_at", now),
            str(json_path),
            payload.get("target_total"),
            payload.get("actual_total"),
            inserted,
            skipped,
        ),
    )
    con.commit()
    con.close()

    print(f"[done] db path    : {db_path}")
    print(f"[done] inserted   : {inserted}")
    print(f"[done] skipped    : {skipped}")
    print(f"[done] run_id     : {run_id}")

    # Rebuild FTS index so new items are immediately searchable
    print("[info] rebuilding FTS search index…")
    sys.path.insert(0, str(Path(__file__).parent))
    from db import ensure_fts_index
    ensure_fts_index()
    print("[done] FTS index up to date")


if __name__ == "__main__":
    main()
