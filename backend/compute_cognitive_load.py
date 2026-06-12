"""
compute_cognitive_load.py
─────────────────────────
Batch script that scores every row in the `contents` table with a
Cognitive Load (CL) value — how many hours of focused attention
consuming this item is estimated to cost.

Formula:
    CL (hours) = duration_hours × intensity (0–1)

Intensity is derived from:
  • textstat readability metrics on the summary/abstract
  • content-type base intensity priors
  • For YouTube videos: WPM from transcript (best-effort, skipped on error)

Run:
    python3 compute_cognitive_load.py [--overwrite] [--limit N] [--video-transcripts]
"""

import argparse
import re
import sqlite3
import time
from pathlib import Path
from typing import Optional

import textstat

DB_PATH = Path(__file__).parent / "data" / "noscroll.db"

# ── Per-type priors ───────────────────────────────────────────────────────────
# Papers are dense academic text; podcasts are conversational.
TYPE_BASE_INTENSITY = {
    "paper":   0.75,
    "article": 0.50,
    "video":   0.40,
    "podcast": 0.30,
}

TYPE_DEFAULT_DURATION_MIN = {
    "paper":   45,
    "article": 9,   # typical online long-form article
    "video":   22,
    "podcast": 45,
}

# Durations ≤ this threshold are treated as bad scraping defaults
TYPE_MIN_VALID_DURATION = {
    "paper":   5,
    "article": 3,
    "video":   3,
    "podcast": 5,
}

# Intensity ceilings/floors to prevent outliers
TYPE_INTENSITY_FLOOR   = {"paper": 0.60, "article": 0.20, "video": 0.15, "podcast": 0.15}
TYPE_INTENSITY_CEILING = {"paper": 1.00, "article": 0.90, "video": 0.80, "podcast": 0.65}

# For time-based media (video/podcast) the runtime is the FLOOR for focus time —
# you can't consume it faster than it plays — and complexity adds a surcharge on
# top:  CL = duration × (1 + TIME_MEDIA_K × intensity).
TIME_MEDIA_K = 0.1


# ── Text analysis ─────────────────────────────────────────────────────────────

def text_intensity(text: str) -> float:
    """
    Returns a 0–1 intensity score from text readability metrics.
    Higher = more cognitively demanding.
    Uses summary/abstract as proxy for full body text.
    """
    if not text or len(text.strip()) < 40:
        return 0.5

    try:
        # Flesch-Kincaid Grade Level: 0 → trivial, 16+ → graduate-level
        fk_grade = textstat.flesch_kincaid_grade(text)
        fk_norm  = min(1.0, max(0.0, fk_grade / 16.0))

        # Flesch Reading Ease: 100 → very easy, 0 → very hard (inverted)
        fre      = textstat.flesch_reading_ease(text)
        fre_norm = min(1.0, max(0.0, (100.0 - fre) / 100.0))

        # Average words per sentence: normal ~15–20, complex ~30+
        word_count  = len(text.split())
        sent_count  = max(1, textstat.sentence_count(text))
        avg_sent    = word_count / sent_count
        sent_norm   = min(1.0, max(0.0, (avg_sent - 10) / 25.0))

        return round(0.45 * fk_norm + 0.35 * fre_norm + 0.20 * sent_norm, 4)
    except Exception:
        return 0.5


# ── YouTube transcript (optional) ─────────────────────────────────────────────

def _extract_youtube_id(url: str) -> Optional[str]:
    m = re.search(r"(?:v=|youtu\.be/|embed/)([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else None


def fetch_video_intensity(url: str) -> Optional[float]:
    """
    Fetch YouTube transcript and compute WPM-based intensity.
    Returns None on any error (missing captions, private video, etc.)
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        vid_id = _extract_youtube_id(url)
        if not vid_id:
            return None

        transcript = YouTubeTranscriptApi.get_transcript(vid_id, languages=["en", "en-US"])
        if not transcript:
            return None

        text          = " ".join(t["text"] for t in transcript)
        word_count    = len(text.split())
        total_seconds = sum(t.get("duration", 0) for t in transcript)

        if total_seconds < 30:
            return None

        wpm = word_count / (total_seconds / 60.0)
        # Slow narration: ~100 WPM, fast lecture: ~180 WPM
        # Map 80–200 WPM → 0.15–0.75 intensity
        wpm_intensity = min(0.80, max(0.15, (wpm - 80) / (200 - 80) * 0.60 + 0.15))

        text_int = text_intensity(text[:3000])  # first ~500 words
        return round(0.55 * wpm_intensity + 0.45 * text_int, 4)
    except Exception:
        return None


# ── Main scoring function ─────────────────────────────────────────────────────

def compute_cl(row: dict, use_transcripts: bool = False) -> float:
    """
    Compute cognitive load in hours for one content item.
    Result is clamped to [0.05, 4.0].
    """
    ctype = row.get("content_type", "article")

    # ── Duration ─────────────────────────────────────────────────────────────
    # Many scraped items have read_time_minutes = 1 (bad default from ingestion).
    # Treat values ≤ TYPE_MIN_VALID_DURATION as invalid and fall back to the type default.
    raw_dur    = row.get("duration_minutes") or row.get("read_time_minutes") or 0
    min_valid  = TYPE_MIN_VALID_DURATION.get(ctype, 3)
    default    = TYPE_DEFAULT_DURATION_MIN.get(ctype, 15)
    duration_min = raw_dur if raw_dur > min_valid else default
    duration_hrs = duration_min / 60.0

    # ── Intensity ─────────────────────────────────────────────────────────────
    summary  = row.get("summary") or ""
    text_int = text_intensity(summary)
    base     = TYPE_BASE_INTENSITY.get(ctype, 0.50)

    if ctype == "paper":
        # Academic text: weight text analysis heavily, enforce floor
        intensity = 0.35 * base + 0.65 * text_int

    elif ctype == "article":
        # Articles vary widely — text analysis is the primary signal
        intensity = 0.25 * base + 0.75 * text_int

    elif ctype == "video":
        if use_transcripts:
            transcript_int = fetch_video_intensity(row.get("url", ""))
            if transcript_int is not None:
                intensity = 0.30 * base + 0.70 * transcript_int
            else:
                intensity = 0.50 * base + 0.50 * text_int
        else:
            intensity = 0.50 * base + 0.50 * text_int

    else:  # podcast
        # Conversational audio: base prior dominates; text description is weak signal
        intensity = 0.65 * base + 0.35 * text_int

    # Apply type-specific floor/ceiling
    floor   = TYPE_INTENSITY_FLOOR.get(ctype, 0.15)
    ceiling = TYPE_INTENSITY_CEILING.get(ctype, 1.0)
    intensity = min(ceiling, max(floor, intensity))

    if ctype in ("video", "podcast"):
        # Runtime is the minimum focus time; complexity adds a small surcharge.
        cl_hours = duration_hrs * (1.0 + TIME_MEDIA_K * intensity)
    else:
        # Self-paced text: focus time scales down with how skimmable it is.
        cl_hours = duration_hrs * intensity

    return round(min(4.0, max(0.05, cl_hours)), 2)


# ── Batch runner ──────────────────────────────────────────────────────────────

def run(overwrite: bool = False, limit: Optional[int] = None, use_transcripts: bool = False):
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row

    where  = "" if overwrite else "WHERE cognitive_load IS NULL"
    limit_clause = f"LIMIT {limit}" if limit else ""
    rows   = con.execute(
        f"SELECT * FROM contents {where} {limit_clause}"
    ).fetchall()

    total   = len(rows)
    updated = 0
    errors  = 0

    print(f"Scoring {total} items (overwrite={overwrite}, transcripts={use_transcripts})…")

    for i, row in enumerate(rows):
        row_dict = dict(row)
        try:
            cl = compute_cl(row_dict, use_transcripts=use_transcripts)
            con.execute(
                "UPDATE contents SET cognitive_load = ? WHERE id = ?",
                (cl, row_dict["id"]),
            )
            updated += 1
        except Exception as e:
            print(f"  [!] Error on {row_dict.get('id')}: {e}")
            errors += 1

        if (i + 1) % 100 == 0:
            con.commit()
            print(f"  {i+1}/{total} done…")

        # Be polite to the YouTube API if transcripts are enabled
        if use_transcripts and row_dict.get("content_type") == "video":
            time.sleep(0.5)

    con.commit()
    con.close()
    print(f"\nDone. Updated: {updated}  Errors: {errors}")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--overwrite", action="store_true",
        help="Re-score items that already have a cognitive_load value"
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Only score the first N items (useful for testing)"
    )
    parser.add_argument(
        "--video-transcripts", action="store_true",
        help="Fetch YouTube transcripts for more accurate video scoring (slow)"
    )
    args = parser.parse_args()
    run(overwrite=args.overwrite, limit=args.limit, use_transcripts=args.video_transcripts)
