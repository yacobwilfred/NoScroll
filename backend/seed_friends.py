"""
Seed fake friends with collections and saved items (social/feed demo).

Idempotent: safe to run on every deploy. DEMO_USER_TOKEN must match the frontend
VITE_DEMO_USER_TOKEN when using the public demo build.
"""
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

DB = Path(__file__).parent / "data" / "noscroll.db"

# Same UUID must be used in frontend VITE_DEMO_USER_TOKEN for shared demo deploys.
DEFAULT_DEMO_TOKEN = "a1b2c3d4-e5f6-4789-a012-3456789abcde"


def _demo_token() -> str:
    return os.environ.get("DEMO_USER_TOKEN", DEFAULT_DEMO_TOKEN)


def _demo_profile() -> tuple:
    handle = os.environ.get("DEMO_USER_HANDLE", "demo")
    name = os.environ.get("DEMO_USER_DISPLAY_NAME", "Demo explorer")
    return handle, name


def now():
    return datetime.now(timezone.utc).isoformat()


# ── Fake friends ───────────────────────────────────────────────────────────────

FRIENDS = [
    {
        "token": "aaaa0001-seed-seed-seed-seed00000001",
        "handle": "maya_explores",
        "display_name": "Maya Chen",
        "bio": "Curious about design, philosophy, and how things are made.",
    },
    {
        "token": "aaaa0002-seed-seed-seed-seed00000002",
        "handle": "omar_reads",
        "display_name": "Omar Faruk",
        "bio": "Architecture, cities, slow ideas. Based in Amsterdam.",
    },
    {
        "token": "aaaa0003-seed-seed-seed-seed00000003",
        "handle": "lena_thinks",
        "display_name": "Lena Vogel",
        "bio": "Art history obsessive. Currently obsessed with the Bauhaus.",
    },
]

# ── Collections per friend ─────────────────────────────────────────────────────

COLLECTIONS = {
    "maya_explores": [
        {"id": "bbbb0001-seed-seed-seed-seed00000001", "name": "Design thinking"},
        {"id": "bbbb0002-seed-seed-seed-seed00000002", "name": "Visual culture"},
    ],
    "omar_reads": [
        {"id": "bbbb0003-seed-seed-seed-seed00000003", "name": "Urbanism & cities"},
        {"id": "bbbb0004-seed-seed-seed-seed00000004", "name": "Architecture"},
    ],
    "lena_thinks": [
        {"id": "bbbb0005-seed-seed-seed-seed00000005", "name": "Art I keep returning to"},
        {"id": "bbbb0006-seed-seed-seed-seed00000006", "name": "Philosophy"},
    ],
}

# ── Saved items: (handle, collection_name, url, title, type, source, caption, thumbnail) ──

ITEMS = [
    (
        "maya_explores", "Design thinking",
        "https://www.youtube.com/watch?v=Q4MzT2MEDHA",
        "How to Think Like a Designer",
        "video", "YouTube",
        "Changed how I approach every project — not just design ones.",
        "https://i.ytimg.com/vi/Q4MzT2MEDHA/hqdefault.jpg",
    ),
    (
        "maya_explores", "Design thinking",
        "https://www.nngroup.com/articles/design-thinking/",
        "Design Thinking 101",
        "article", "Nielsen Norman Group",
        "The clearest explainer on the process I've found.",
        None,
    ),
    (
        "maya_explores", "Visual culture",
        "https://www.youtube.com/watch?v=3eoSyMwJp1k",
        "The Visual Language of Graphic Design",
        "video", "YouTube",
        "Beautifully made. Watch it at least twice.",
        "https://i.ytimg.com/vi/3eoSyMwJp1k/hqdefault.jpg",
    ),
    (
        "omar_reads", "Urbanism & cities",
        "https://www.youtube.com/watch?v=bIKF5ZDWZ5I",
        "Jane Jacobs: The Death and Life of Great American Cities",
        "video", "YouTube",
        "Every city person should watch this before forming opinions about urban planning.",
        "https://i.ytimg.com/vi/bIKF5ZDWZ5I/hqdefault.jpg",
    ),
    (
        "omar_reads", "Urbanism & cities",
        "https://placesjournal.org/article/the-sidewalk-and-its-discontents/",
        "The Sidewalk and Its Discontents",
        "article", "Places Journal",
        "Makes you look at every sidewalk differently.",
        None,
    ),
    (
        "omar_reads", "Architecture",
        "https://www.youtube.com/watch?v=F70RAR9LUYM",
        "Why Brutalism Divides People",
        "video", "YouTube",
        "Fair and actually thoughtful — not the usual take.",
        "https://i.ytimg.com/vi/F70RAR9LUYM/hqdefault.jpg",
    ),
    (
        "lena_thinks", "Art I keep returning to",
        "https://www.theartstory.org/movement/bauhaus/",
        "Bauhaus Movement Overview",
        "article", "The Art Story",
        "The movement that explains half of everything modern. Start here.",
        None,
    ),
    (
        "lena_thinks", "Art I keep returning to",
        "https://www.youtube.com/watch?v=eRiuoqFkqZU",
        "Abstract Expressionism Explained",
        "video", "YouTube",
        "Surprisingly accessible. Makes Rothko make sense.",
        "https://i.ytimg.com/vi/eRiuoqFkqZU/hqdefault.jpg",
    ),
    (
        "lena_thinks", "Philosophy",
        "https://plato.stanford.edu/entries/phenomenology/",
        "Phenomenology – Stanford Encyclopedia of Philosophy",
        "article", "Stanford Encyclopedia of Philosophy",
        "Dense, but the intro section alone is worth sitting with.",
        None,
    ),
    (
        "lena_thinks", "Philosophy",
        "https://www.youtube.com/watch?v=3qHkcs3kG44",
        "Walter Benjamin's Philosophy of History",
        "video", "YouTube",
        "One of those videos that permanently changes how you read things.",
        "https://i.ytimg.com/vi/3qHkcs3kG44/hqdefault.jpg",
    ),
]


def run():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row

    # Build lookup maps
    handle_to_token = {f["handle"]: f["token"] for f in FRIENDS}
    col_key_to_id = {}  # (handle, col_name) -> col_id
    for handle, cols in COLLECTIONS.items():
        for col in cols:
            col_key_to_id[(handle, col["name"])] = col["id"]

    my_token = _demo_token()
    demo_handle, demo_name = _demo_profile()

    try:
        # 1. Demo viewer profile (everyone on public URL uses this token)
        con.execute(
            """
            INSERT OR REPLACE INTO users (token,handle,display_name,bio,created_at,updated_at)
            VALUES (?,?,?,?,?,?)
            """,
            (my_token, demo_handle, demo_name, None, now(), now()),
        )
        print(f"  Demo user profile ({demo_handle}) for token …{my_token[-8:]}")

        # 2. Insert fake users
        for f in FRIENDS:
            con.execute(
                "INSERT OR REPLACE INTO users (token,handle,display_name,bio,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                (f["token"], f["handle"], f["display_name"], f["bio"], now(), now()),
            )
        print(f"  Inserted {len(FRIENDS)} friends.")

        # 3. Insert accepted friendships
        for f in FRIENDS:
            con.execute(
                """
                INSERT OR IGNORE INTO friendships
                    (id, requester_token, recipient_token, status, created_at, updated_at)
                VALUES (?, ?, ?, 'accepted', ?, ?)
                """,
                (str(uuid.uuid4()), f["token"], my_token, now(), now()),
            )
        print(f"  Inserted {len(FRIENDS)} friendships.")

        # 4. Insert collections
        for handle, cols in COLLECTIONS.items():
            friend_token = handle_to_token[handle]
            for col in cols:
                con.execute(
                    """
                    INSERT OR REPLACE INTO collections
                        (id, user_token, name, description, is_public, created_at, updated_at)
                    VALUES (?, ?, ?, '', 1, ?, ?)
                    """,
                    (col["id"], friend_token, col["name"], now(), now()),
                )
        total_cols = sum(len(v) for v in COLLECTIONS.values())
        print(f"  Inserted {total_cols} collections.")

        # 5. Insert saved_items + collection_items (idempotent per user_token + url)
        items_inserted = 0
        for (handle, col_name, url, title, ctype, source, caption, thumbnail) in ITEMS:
            friend_token = handle_to_token[handle]
            col_id = col_key_to_id[(handle, col_name)]

            row = con.execute(
                "SELECT id FROM saved_items WHERE user_token=? AND url=?",
                (friend_token, url),
            ).fetchone()
            if row:
                saved_id = row["id"]
            else:
                saved_id = str(uuid.uuid4())
                con.execute(
                    """
                    INSERT INTO saved_items
                        (id, user_token, url, title, content_type, source, caption, thumbnail, saved_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (saved_id, friend_token, url, title, ctype, source, caption, thumbnail, now()),
                )
                items_inserted += 1

            con.execute(
                """
                INSERT OR IGNORE INTO collection_items
                    (collection_id, saved_item_id, added_at)
                VALUES (?, ?, ?)
                """,
                (col_id, saved_id, now()),
            )

        print(f"  Inserted {items_inserted} saved items with collection links.")

        con.commit()
        print("\nSeed complete! Reload the app to see your friends feed.")

    except Exception as e:
        con.rollback()
        print(f"Error: {e}")
        raise
    finally:
        con.close()


if __name__ == "__main__":
    run()
