"""
Mark reader_ready on existing items in SQLite.

Fast path (no network): images with image_url, videos, stored body_text.
Slow path (--scrape): probe article URLs with newspaper for items still unset.

    python3 validate_relax_reader.py
    python3 validate_relax_reader.py --vibe deep
    python3 validate_relax_reader.py --vibe deep --scrape --limit 200
"""

import argparse
import sqlite3
import time
from pathlib import Path

from relax_reader import validate_article_url, is_in_app_ready

DB_PATH = Path(__file__).parent / "data" / "noscroll.db"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scrape", action="store_true", help="Scrape article URLs without stored body.")
    ap.add_argument("--vibe", choices=["relax", "deep"], default="relax")
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--delay", type=float, default=0.25)
    args = ap.parse_args()

    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row

    if args.vibe == "relax":
        vibe_clause = "vibe = 'relax'"
    else:
        vibe_clause = "(vibe IS NULL OR vibe = 'deep')"

    # Strict re-check: only mark items that pass the in-app gate.
    rows = con.execute(
        f"SELECT id, content_type, url, image_url, body_text, format FROM contents WHERE {vibe_clause}"
    ).fetchall()
    ready = 0
    for row in rows:
        item = dict(row)
        ok = is_in_app_ready(item)
        con.execute(
            "UPDATE contents SET reader_ready = ? WHERE id = ?",
            (1 if ok else 0, row["id"]),
        )
        if ok:
            ready += 1
    con.commit()

    if not args.scrape:
        total = con.execute(f"SELECT COUNT(*) FROM contents WHERE {vibe_clause}").fetchone()[0]
        print(f"[done] reader_ready={ready} / {total} {args.vibe} items (strict in-app check)")
        con.close()
        return

    rows = con.execute(
        f"""
        SELECT id, url, title FROM contents
        WHERE {vibe_clause} AND content_type = 'article'
          AND (reader_ready IS NULL OR reader_ready = 0)
          AND (body_text IS NULL OR body_text = '')
        LIMIT ?
        """,
        (args.limit,),
    ).fetchall()

    ok_n = 0
    for row in rows:
        ok, body = validate_article_url(row["url"])
        if ok and body:
            con.execute(
                "UPDATE contents SET reader_ready=1, body_text=? WHERE id=?",
                (body, row["id"]),
            )
            ok_n += 1
            print(f"[ok]  {row['title'][:50]}")
        else:
            con.execute("UPDATE contents SET reader_ready=0 WHERE id=?", (row["id"],))
            print(f"[skip]{row['title'][:50]}")
        con.commit()
        time.sleep(args.delay)

    ready = con.execute(
        f"SELECT COUNT(*) FROM contents WHERE {vibe_clause} AND reader_ready=1"
    ).fetchone()[0]
    total = con.execute(f"SELECT COUNT(*) FROM contents WHERE {vibe_clause}").fetchone()[0]
    print(f"\n[done] scraped {ok_n}/{len(rows)}  |  reader_ready={ready} / {total}")
    con.close()


if __name__ == "__main__":
    main()
