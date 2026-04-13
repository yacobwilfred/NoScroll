"""
Session management and direction generation.

Direction strategy:
  Given a center content item in cluster X, pick 4 thematically adjacent
  clusters from a hand-curated adjacency map (all 22 clusters covered).

  Within each adjacent cluster, the preview item is chosen by running the
  center content's own keywords through FTS — so the "next" item actually
  shares topical overlap with what the user is currently viewing.
"""

import random
import uuid
from typing import Dict, List, Optional, Tuple

import db as _db
from db import get_contents_by_cluster, get_random_content, search_contents
from models import ContentNode, Direction

# Lazy-loaded embedding model — imported on first use so the server starts fast
_embed_model = None

def _get_embed_model():
    global _embed_model
    if _embed_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _embed_model = SentenceTransformer("all-MiniLM-L6-v2")
            print("[info] embedding model loaded")
        except ImportError:
            _embed_model = False  # mark as unavailable
    return _embed_model if _embed_model else None


def _encode_text(text: str) -> Optional[bytes]:
    """Encode a short text string to a normalised float32 embedding blob."""
    model = _get_embed_model()
    if model is None:
        return None
    try:
        import numpy as np
        vec = model.encode([text], normalize_embeddings=True, convert_to_numpy=True)[0]
        return vec.astype(np.float32).tobytes()
    except Exception as exc:
        print(f"[warn] embedding encode failed: {exc}")
        return None

# In-memory session store: session_id -> { breadcrumb: [...], visited_ids: set }
_sessions: Dict[str, Dict] = {}


# ── Cluster registry ──────────────────────────────────────────────────────────

CLUSTER_META: Dict[str, Dict[str, str]] = {
    # ── Original 8 ──────────────────────────────────────────────────────────
    "creative_process_ideation": {
        "label": "Creative Process & Ideation",
        "description": "How ideas are born, developed, and refined",
    },
    "art_design_history": {
        "label": "Art & Design History",
        "description": "Movements, eras, and the evolution of visual culture",
    },
    "craft_technique": {
        "label": "Craft & Technique",
        "description": "Skills, methods, and hands-on creative disciplines",
    },
    "storytelling_narrative": {
        "label": "Storytelling & Narrative",
        "description": "Structure, character, and the art of telling stories",
    },
    "aesthetics_visual_culture": {
        "label": "Aesthetics & Visual Culture",
        "description": "Form, beauty, and how culture shapes what we see",
    },
    "tools_workflows": {
        "label": "Tools & Workflows",
        "description": "How creative professionals work with tools and systems",
    },
    "creative_career_business": {
        "label": "Creative Career & Business",
        "description": "Building sustainable creative practices and audiences",
    },
    "creativity_mindset_psychology": {
        "label": "Creativity, Mindset & Psychology",
        "description": "The inner world of creativity — focus, motivation, flow",
    },
    # ── New 14 ──────────────────────────────────────────────────────────────
    "mind_perception_consciousness": {
        "label": "Mind, Perception & Consciousness",
        "description": "How the brain constructs reality, memory, and awareness",
    },
    "philosophy_ethics": {
        "label": "Philosophy & Ethics",
        "description": "Western and eastern thought, morality, and meaning",
    },
    "art_history_movements": {
        "label": "Art History & Movements",
        "description": "Periods, schools, and the forces that shaped art",
    },
    "visual_arts_practice": {
        "label": "Visual Arts Practice",
        "description": "Painting, sculpture, photography, and drawing in depth",
    },
    "design_craft_making": {
        "label": "Design, Craft & Making",
        "description": "Graphic design, typography, ceramics, textiles, and more",
    },
    "fashion_costume_history": {
        "label": "Fashion, Costume & Textiles",
        "description": "Dress, fabric, and style across cultures and centuries",
    },
    "society_culture_anthropology": {
        "label": "Society, Culture & Anthropology",
        "description": "How humans organise, believe, and make meaning together",
    },
    "identity_gender_society": {
        "label": "Identity, Gender & Society",
        "description": "Gender, race, disability, queerness, and lived experience",
    },
    "space_nature_science": {
        "label": "Space, Nature & Science",
        "description": "Cosmos, biology, ecology, and the material world",
    },
    "urban_architecture": {
        "label": "Architecture & Urban Design",
        "description": "Buildings, cities, interiors, and the designed environment",
    },
    "social_change_protest": {
        "label": "Social Change, Protest & Conflict",
        "description": "Movements, activism, and how societies transform",
    },
    "religion_mythology": {
        "label": "Religion, Mythology & Folklore",
        "description": "Sacred stories, ritual, and the roots of belief",
    },
    "food_culture": {
        "label": "Food, Culture & Ritual",
        "description": "Cuisine as identity, history, and human connection",
    },
    "marketing_media_branding": {
        "label": "Marketing, Media & Branding",
        "description": "Persuasion, identity, and the language of brands",
    },
}

ALL_CLUSTERS = list(CLUSTER_META.keys())  # 22 clusters


# ── Direction adjacency map ───────────────────────────────────────────────────
# Each entry is a tuple of 4 cluster_ids to offer as directions from that cluster.
# Chosen to give one close neighbour, two mid-range leaps, one wider surprise.

DIRECTION_MAP: Dict[str, Tuple[str, str, str, str]] = {
    "creative_process_ideation": (
        "craft_technique",
        "creativity_mindset_psychology",
        "art_design_history",
        "tools_workflows",
    ),
    "art_design_history": (
        "aesthetics_visual_culture",
        "art_history_movements",
        "visual_arts_practice",
        "craft_technique",
    ),
    "craft_technique": (
        "design_craft_making",
        "visual_arts_practice",
        "creative_process_ideation",
        "tools_workflows",
    ),
    "storytelling_narrative": (
        "creativity_mindset_psychology",
        "aesthetics_visual_culture",
        "society_culture_anthropology",
        "philosophy_ethics",
    ),
    "aesthetics_visual_culture": (
        "art_history_movements",
        "design_craft_making",
        "visual_arts_practice",
        "philosophy_ethics",
    ),
    "tools_workflows": (
        "craft_technique",
        "creative_process_ideation",
        "design_craft_making",
        "marketing_media_branding",
    ),
    "creative_career_business": (
        "creative_process_ideation",
        "marketing_media_branding",
        "tools_workflows",
        "creativity_mindset_psychology",
    ),
    "creativity_mindset_psychology": (
        "mind_perception_consciousness",
        "philosophy_ethics",
        "creative_process_ideation",
        "storytelling_narrative",
    ),
    "mind_perception_consciousness": (
        "creativity_mindset_psychology",
        "philosophy_ethics",
        "space_nature_science",
        "storytelling_narrative",
    ),
    "philosophy_ethics": (
        "mind_perception_consciousness",
        "creativity_mindset_psychology",
        "religion_mythology",
        "society_culture_anthropology",
    ),
    "art_history_movements": (
        "art_design_history",
        "aesthetics_visual_culture",
        "visual_arts_practice",
        "fashion_costume_history",
    ),
    "visual_arts_practice": (
        "art_history_movements",
        "craft_technique",
        "design_craft_making",
        "aesthetics_visual_culture",
    ),
    "design_craft_making": (
        "craft_technique",
        "visual_arts_practice",
        "tools_workflows",
        "urban_architecture",
    ),
    "fashion_costume_history": (
        "art_history_movements",
        "society_culture_anthropology",
        "design_craft_making",
        "identity_gender_society",
    ),
    "society_culture_anthropology": (
        "identity_gender_society",
        "social_change_protest",
        "religion_mythology",
        "storytelling_narrative",
    ),
    "identity_gender_society": (
        "society_culture_anthropology",
        "social_change_protest",
        "philosophy_ethics",
        "creativity_mindset_psychology",
    ),
    "space_nature_science": (
        "mind_perception_consciousness",
        "philosophy_ethics",
        "religion_mythology",
        "aesthetics_visual_culture",
    ),
    "urban_architecture": (
        "aesthetics_visual_culture",
        "design_craft_making",
        "society_culture_anthropology",
        "art_history_movements",
    ),
    "social_change_protest": (
        "identity_gender_society",
        "society_culture_anthropology",
        "storytelling_narrative",
        "philosophy_ethics",
    ),
    "religion_mythology": (
        "philosophy_ethics",
        "society_culture_anthropology",
        "storytelling_narrative",
        "space_nature_science",
    ),
    "food_culture": (
        "society_culture_anthropology",
        "art_history_movements",
        "religion_mythology",
        "identity_gender_society",
    ),
    "marketing_media_branding": (
        "creative_career_business",
        "storytelling_narrative",
        "aesthetics_visual_culture",
        "tools_workflows",
    ),
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _content_to_node(item: Dict) -> ContentNode:
    return ContentNode(
        id=item["id"],
        title=item["title"],
        url=item["url"],
        content_type=item["content_type"],
        cluster_id=item["cluster_id"],
        source=item.get("source"),
        summary=item.get("summary"),
        author=item.get("author"),
        published_at=item.get("published_at"),
        duration_minutes=item.get("duration_minutes"),
        read_time_minutes=item.get("read_time_minutes"),
        language=item.get("language", "en"),
    )


def _extract_keywords(text: str) -> List[str]:
    stop_words = {
        "i", "want", "to", "a", "an", "the", "about", "of", "and", "or",
        "in", "on", "for", "with", "more", "some", "me", "my", "explore",
        "learn", "know", "find", "show", "get", "see", "read", "watch",
        "interested", "curious", "something", "anything", "like", "is",
        "it", "this", "that", "are", "was", "be", "been", "has", "have",
        "from", "by", "at", "as", "into", "its",
    }
    words = [w.strip(".,!?\"'()") for w in text.lower().split()]
    return [w for w in words if w and w not in stop_words and len(w) > 2]


def _prefer_diverse(candidates: List[Dict], used_types: List[str]) -> Dict:
    """
    From a ranked list of candidates, return the first one whose content_type
    is not already represented in `used_types`.  Falls back to the top candidate
    if no type-diverse option exists.
    """
    used_set = set(used_types)
    for item in candidates:
        if item.get("content_type") not in used_set:
            return item
    return candidates[0]


def _pick_preview_for_cluster(
    cluster_id: str,
    exclude_ids: List[str],
    center_vector: Optional[bytes] = None,
    center_keywords: Optional[List[str]] = None,
    used_types: Optional[List[str]] = None,
) -> Optional[ContentNode]:
    """
    Pick the most relevant preview item for a direction cluster.
    Priority: embedding cosine similarity > FTS keyword match > random.
    When used_types is provided, prefers a content_type not yet seen in
    the current set of direction previews so the 4 directions stay varied.
    """
    used_types = used_types or []

    # 1. Embedding similarity — fetch a wider pool so we can pick a diverse type
    if center_vector:
        items = _db.get_similar_in_cluster(
            center_vector, cluster_id, exclude_ids=exclude_ids, limit=8
        )
        if items:
            return _content_to_node(_prefer_diverse(items, used_types))

    # 2. FTS keyword match
    if center_keywords:
        hits = search_contents(
            keywords=center_keywords,
            cluster_id=cluster_id,
            exclude_ids=exclude_ids,
            limit=8,
        )
        if hits:
            return _content_to_node(_prefer_diverse(hits, used_types))

    # 3. Random from cluster (last resort)
    items = get_contents_by_cluster(cluster_id, exclude_ids=exclude_ids, limit=10)
    if not items:
        items = get_random_content(exclude_ids=exclude_ids, limit=1)
    if not items:
        return None
    return _content_to_node(_prefer_diverse(items, used_types))


def build_directions(
    center_cluster_id: str,
    exclude_ids: List[str],
    center_keywords: Optional[List[str]] = None,
    center_vector: Optional[bytes] = None,
) -> List[Direction]:
    direction_clusters = DIRECTION_MAP.get(
        center_cluster_id,
        tuple(c for c in ALL_CLUSTERS if c != center_cluster_id)[:4],
    )

    directions: List[Direction] = []
    used_preview_ids = set(exclude_ids)
    used_types: List[str] = []  # track content types already picked

    for i, cluster_id in enumerate(direction_clusters):
        meta = CLUSTER_META.get(cluster_id, {})
        label = meta.get("label", cluster_id.replace("_", " ").title())
        description = meta.get("description", "")

        preview = _pick_preview_for_cluster(
            cluster_id,
            list(used_preview_ids),
            center_vector=center_vector,
            center_keywords=center_keywords,
            used_types=used_types,
        )
        if preview is None:
            continue

        used_preview_ids.add(preview.id)
        used_types.append(preview.content_type)
        directions.append(
            Direction(
                id=f"dir_{i + 1}",
                label=label,
                cluster_id=cluster_id,
                description=description,
                preview=preview,
            )
        )

    return directions


# ── Session API ───────────────────────────────────────────────────────────────

def start_session(prompt: str) -> Tuple[str, ContentNode, List[Direction]]:
    session_id = str(uuid.uuid4())

    # Try embedding-based initial search first (best relevance)
    center_item = None
    prompt_vector = _encode_text(prompt)
    if prompt_vector:
        center_item = _db.get_nearest_neighbor(prompt_vector)

    # Fallback: FTS keyword search
    if not center_item:
        keywords = _extract_keywords(prompt)
        candidates = search_contents(keywords=keywords, limit=20) if keywords else []
        center_item = candidates[0] if candidates else None

    # Last resort: random
    if not center_item:
        results = get_random_content(limit=1)
        center_item = results[0] if results else None

    if center_item is None:
        raise RuntimeError("No content available in database.")

    center_node = _content_to_node(center_item)

    # Use the stored embedding of the center item (more accurate than re-encoding title)
    center_vector = _db.get_embedding(center_node.id)
    center_keywords = _extract_keywords(
        f"{center_node.title} {center_node.summary or ''}"
    )
    directions = build_directions(
        center_node.cluster_id,
        exclude_ids=[center_node.id],
        center_keywords=center_keywords,
        center_vector=center_vector,
    )

    _sessions[session_id] = {
        "breadcrumb": [center_node.id],
        "visited_ids": {center_node.id},
    }

    return session_id, center_node, directions


def expand_session(
    session_id: str,
    current_node_id: str,
    chosen_cluster_id: str,
    chosen_content_id: Optional[str] = None,
) -> Tuple[ContentNode, List[Direction], List[str]]:
    from db import get_content_by_id

    session = _sessions.get(session_id)
    if session is None:
        session = {"breadcrumb": [current_node_id], "visited_ids": {current_node_id}}
        _sessions[session_id] = session

    visited_ids = list(session["visited_ids"])

    new_center_item = None
    if chosen_content_id:
        new_center_item = get_content_by_id(chosen_content_id)

    if not new_center_item:
        candidates = get_contents_by_cluster(
            chosen_cluster_id, exclude_ids=visited_ids, limit=20
        )
        if not candidates:
            candidates = get_random_content(exclude_ids=visited_ids, limit=1)
        if not candidates:
            raise RuntimeError("No more content available in this direction.")
        new_center_item = random.choice(candidates)

    new_center = _content_to_node(new_center_item)
    session["breadcrumb"].append(new_center.id)
    session["visited_ids"].add(new_center.id)

    center_vector = _db.get_embedding(new_center.id)
    center_keywords = _extract_keywords(
        f"{new_center.title} {new_center.summary or ''}"
    )
    directions = build_directions(
        new_center.cluster_id,
        exclude_ids=list(session["visited_ids"]),
        center_keywords=center_keywords,
        center_vector=center_vector,
    )

    return new_center, directions, list(session["breadcrumb"])


def get_session_breadcrumb(session_id: str) -> List[str]:
    session = _sessions.get(session_id)
    return session["breadcrumb"] if session else []


def start_session_from_content(content_id: str) -> Tuple[str, ContentNode, List[Direction]]:
    """Start a session directly from a known content_id (skips prompt search)."""
    item = _db.get_content_by_id(content_id)
    if item is None:
        raise RuntimeError(f"Content '{content_id}' not found in database.")

    session_id = str(uuid.uuid4())
    center_node = _content_to_node(item)
    center_vector = _db.get_embedding(center_node.id)
    center_keywords = _extract_keywords(
        f"{center_node.title} {center_node.summary or ''}"
    )
    directions = build_directions(
        center_node.cluster_id,
        exclude_ids=[center_node.id],
        center_keywords=center_keywords,
        center_vector=center_vector,
    )
    _sessions[session_id] = {
        "breadcrumb": [center_node.id],
        "visited_ids": {center_node.id},
    }
    return session_id, center_node, directions


def ingest_external_and_start_session(
    url: str,
    title: str,
    content_type: str,
    summary: Optional[str] = None,
    author: Optional[str] = None,
    source: Optional[str] = None,
    thumbnail: Optional[str] = None,
) -> Tuple[str, ContentNode, List[Direction]]:
    """
    Ensure an external URL exists in the contents table, then start a session from it.
    - If the URL is already in the DB, uses the existing record.
    - If not, inserts a minimal record, assigns the nearest cluster via embedding,
      generates an embedding, and then starts the session.
    """
    import sqlite3 as _sqlite3

    con = _db.get_connection()
    try:
        existing = con.execute(
            "SELECT * FROM contents WHERE url = ?", (url,)
        ).fetchone()
        if existing:
            content_id = existing["id"]
        else:
            content_id = str(uuid.uuid4())

            # Determine cluster: embed the title+summary and find nearest neighbour
            text = f"{title} {summary or ''}"
            vector = _encode_text(text)
            cluster_id = "creative_process_ideation"  # sensible fallback

            if vector:
                nearest = _db.get_nearest_neighbor(vector)
                if nearest:
                    cluster_id = nearest["cluster_id"]

            from datetime import datetime, timezone as _tz
            ingested_at = datetime.now(_tz.utc).isoformat()
            con.execute(
                """
                INSERT INTO contents
                  (id, title, url, content_type, cluster_id,
                   source, summary, author, language, ingested_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    content_id, title, url, content_type, cluster_id,
                    source, summary, author, "en", ingested_at,
                ),
            )
            con.commit()

            # Generate and store embedding for the new item
            if vector:
                con.execute(
                    "INSERT OR REPLACE INTO embeddings (content_id, vector) VALUES (?,?)",
                    (content_id, vector),
                )
                con.commit()

    finally:
        con.close()

    return start_session_from_content(content_id)
