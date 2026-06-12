#!/usr/bin/env python3
"""
Collect reader-ready articles from curated RSS feeds and load into SQLite.

    python3 collect_reader_articles.py
    python3 collect_reader_articles.py --no-scrape
    python3 collect_reader_articles.py --total 250
"""

import argparse
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest reader-ready articles into NoScroll.")
    ap.add_argument("--total", type=int, default=300, help="Target article count.")
    ap.add_argument("--no-scrape", action="store_true", help="RSS full-text only (faster).")
    ap.add_argument("--scrape-delay", type=float, default=0.2)
    ap.add_argument("--article-max-items", type=int, default=50)
    ap.add_argument(
        "--scrape-existing",
        type=int,
        default=400,
        help="Also scrape this many unread articles already in the DB (0 to skip).",
    )
    args = ap.parse_args()

    # Merge supplement feeds into config for this run.
    import json

    base_cfg = json.loads((BACKEND / "reader_article_seed_config.json").read_text())
    sup_path = BACKEND / "reader_article_supplement_feeds.json"
    if sup_path.exists():
        sup = json.loads(sup_path.read_text())
        base_cfg["supplement_feeds"] = sup.get("feeds", [])
    merged_cfg = BACKEND / "reader_articles_merged_config.json"
    merged_cfg.write_text(json.dumps(base_cfg, indent=2), encoding="utf-8")

    cmd = [
        sys.executable,
        str(BACKEND / "collect_content_metadata.py"),
        "--config",
        str(merged_cfg.name),
        "--output",
        "reader_articles_metadata.json",
        "--articles-only",
        "--validate-articles",
        "--exclude-existing-urls",
        "--total",
        str(args.total),
        "--article-max-items",
        str(args.article_max_items),
        "--scrape-delay",
        str(args.scrape_delay),
    ]
    if not args.no_scrape:
        cmd.append("--scrape-fallback")

    print("[info] collecting reader-ready articles…")
    subprocess.check_call(cmd, cwd=BACKEND)

    print("[info] loading into database…")
    subprocess.check_call(
        [
            sys.executable,
            str(BACKEND / "load_to_db.py"),
            "--input",
            "reader_articles_metadata.json",
            "--upsert-articles",
        ],
        cwd=BACKEND,
    )

    if args.scrape_existing > 0:
        print(f"[info] scraping up to {args.scrape_existing} existing unread articles…")
        subprocess.check_call(
            [
                sys.executable,
                str(BACKEND / "validate_relax_reader.py"),
                "--vibe",
                "deep",
                "--scrape",
                "--limit",
                str(args.scrape_existing),
                "--delay",
                str(args.scrape_delay),
            ],
            cwd=BACKEND,
        )


if __name__ == "__main__":
    main()
