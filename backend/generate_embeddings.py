"""
Generate sentence embeddings for all content items and store them in SQLite.

Run once after initial DB load, and again after any new ingestion:
    python3 generate_embeddings.py

Only items without an existing embedding are processed, so re-runs are cheap.
"""

import sqlite3
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

DB_PATH    = Path(__file__).parent / "data" / "noscroll.db"
MODEL_NAME = "all-MiniLM-L6-v2"
BATCH_SIZE = 128


def main() -> None:
    print(f"[info] loading model: {MODEL_NAME}")
    model = SentenceTransformer(MODEL_NAME)

    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS embeddings (
            content_id TEXT PRIMARY KEY,
            vector     BLOB NOT NULL
        )
    """)
    con.commit()

    # Only items that don't already have an embedding
    rows = con.execute("""
        SELECT c.id, c.title, c.summary
        FROM contents c
        LEFT JOIN embeddings e ON e.content_id = c.id
        WHERE e.content_id IS NULL
    """).fetchall()

    if not rows:
        total = con.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0]
        print(f"[info] all {total} items already have embeddings — nothing to do")
        con.close()
        return

    print(f"[info] encoding {len(rows)} items (batch size {BATCH_SIZE})…")

    ids   = [r[0] for r in rows]
    # Combine title + summary for richer representation
    texts = [f"{r[1]}. {(r[2] or '').strip()}" for r in rows]

    embeddings = model.encode(
        texts,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
        normalize_embeddings=True,   # unit vectors → dot product == cosine sim
        convert_to_numpy=True,
    )

    for content_id, vec in zip(ids, embeddings):
        con.execute(
            "INSERT OR REPLACE INTO embeddings (content_id, vector) VALUES (?, ?)",
            (content_id, vec.astype(np.float32).tobytes()),
        )

    con.commit()
    con.close()

    total_now = sqlite3.connect(DB_PATH).execute(
        "SELECT COUNT(*) FROM embeddings"
    ).fetchone()[0]
    print(f"[done] stored {len(ids)} new embeddings  (total in db: {total_now})")


if __name__ == "__main__":
    main()
