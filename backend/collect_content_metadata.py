import argparse
import json
import os
import re
import sqlite3
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

TYPE_WEIGHTS = {
    "article": 0.40,
    "video": 0.30,
    "podcast": 0.15,
    "paper": 0.15,
}

DEFAULT_TOTAL_ITEMS = 3000
DEFAULT_HTTP_TIMEOUT = 20
DEFAULT_USER_AGENT = (
    "BuzzNetPrototypeIngestor/0.1 (+https://example.com; contact: prototype@buzznet.local)"
)


def load_seed_config(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def parse_iso8601_duration_seconds(duration: str) -> Optional[int]:
    match = re.match(r"^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$", duration or "")
    if not match:
        return None
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


def parse_iso8601_duration_minutes(duration: str) -> Optional[int]:
    secs = parse_iso8601_duration_seconds(duration)
    if secs is None:
        return None
    return secs // 60 + (1 if secs % 60 >= 30 else 0)


_SHORTS_RE = re.compile(
    r"(#shorts\b|#short\b|youtube\s+shorts?\b|\bshorts\s*#)",
    re.IGNORECASE,
)


def is_youtube_short(title: str, description: str, duration_seconds: Optional[int]) -> bool:
    """Heuristic: exclude YouTube Shorts (vertical short-form), keep regular videos."""
    blob = f"{title} {description}"
    if _SHORTS_RE.search(blob):
        return True
    if duration_seconds is None:
        return False
    # Classic Shorts are ≤60s; newer Shorts cap at 3 minutes.
    if duration_seconds <= 60:
        return True
    if duration_seconds <= 180 and _SHORTS_RE.search(blob):
        return True
    return False


def build_request(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": DEFAULT_USER_AGENT})


def http_get_text(url: str, timeout: int = DEFAULT_HTTP_TIMEOUT) -> str:
    req = build_request(url)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def child_content_html(node: ET.Element) -> str:
    """Extract full HTML body from RSS content:encoded / Atom content."""
    for child in list(node):
        lname = local_name(child.tag)
        if lname not in ("encoded", "content"):
            continue
        parts: List[str] = []
        if child.text:
            parts.append(child.text)
        for sub in list(child):
            parts.append(ET.tostring(sub, encoding="unicode"))
            if sub.tail:
                parts.append(sub.tail)
        html = "".join(parts).strip()
        if html:
            return html
    return ""


def finalize_article_item(
    item: Dict[str, Any],
    *,
    scrape_fallback: bool = False,
    scrape_delay: float = 0.25,
) -> Optional[Dict[str, Any]]:
    """Keep only articles with a full in-app body (RSS HTML or optional scrape)."""
    from relax_reader import body_from_rss_html, is_in_app_ready, validate_article_url

    body_html = item.get("body_html") or ""
    body = body_from_rss_html(body_html) if body_html else None

    if not body and scrape_fallback:
        time.sleep(scrape_delay)
        ok, scraped = validate_article_url(item["url"])
        if ok and scraped:
            body = scraped

    if not body:
        return None

    candidate = {**item, "body_text": body, "content_type": "article"}
    if not is_in_app_ready(candidate):
        return None

    word_count = len(body.split())
    item = {
        **item,
        "body_text": body,
        "reader_ready": True,
        "read_time_minutes": max(1, round(word_count / 200)),
    }
    item.pop("body_html", None)
    return item


def fetch_rss_or_atom_items(
    feed_url: str,
    *,
    cluster_id: str,
    content_type: str,
    max_items: int = 80,
    min_duration_minutes: Optional[int] = None,
    validate_articles: bool = False,
    scrape_fallback: bool = False,
    scrape_delay: float = 0.25,
) -> List[Dict[str, Any]]:
    try:
        xml_text = http_get_text(feed_url)
    except Exception as exc:
        print(f"[warn] feed fetch failed: {feed_url} ({exc})")
        return []

    xml_text = normalize_xml_text(xml_text)
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        print(f"[warn] feed parse failed: {feed_url} ({exc})")
        return []

    entries: List[Dict[str, Any]] = []
    feed_entries = extract_feed_entries(root)
    for entry in feed_entries[:max_items]:
        title = (entry.get("title") or "").strip()
        link = (entry.get("url") or "").strip()
        summary = (entry.get("summary") or "").strip()
        author = (entry.get("author") or "").strip() or None
        published = (entry.get("published_at") or "").strip() or None
        duration_minutes = entry.get("duration_minutes")

        if min_duration_minutes and duration_minutes is not None and duration_minutes < min_duration_minutes:
            continue
        if not title or not link:
            continue

        row = {
            "title": title,
            "url": link,
            "summary": clean_text(summary),
            "author": author,
            "published_at": published,
            "source": feed_url,
            "content_type": content_type,
            "cluster_id": cluster_id,
            "duration_minutes": duration_minutes,
            "language": "en",
            "body_html": entry.get("body_html") or "",
        }
        if validate_articles and content_type == "article":
            finalized = finalize_article_item(
                row,
                scrape_fallback=scrape_fallback,
                scrape_delay=scrape_delay,
            )
            if finalized:
                entries.append(finalized)
        else:
            entries.append(row)
    return entries


def normalize_xml_text(xml_text: str) -> str:
    text = xml_text.lstrip("\ufeff").strip()
    xml_start = text.find("<?xml")
    if xml_start > 0:
        text = text[xml_start:]
    return text


def local_name(tag: str) -> str:
    if not tag:
        return ""
    return tag.split("}", 1)[-1].lower()


def child_text(node: ET.Element, names: List[str]) -> str:
    names_set = {n.lower() for n in names}
    for child in list(node):
        lname = local_name(child.tag)
        if lname in names_set:
            return (child.text or "").strip()
    return ""


def child_link(node: ET.Element) -> str:
    for child in list(node):
        lname = local_name(child.tag)
        if lname == "link":
            href = (child.attrib.get("href") or "").strip()
            if href:
                return href
            text = (child.text or "").strip()
            if text:
                return text
    return ""


def extract_feed_entries(root: ET.Element) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for elem in root.iter():
        lname = local_name(elem.tag)
        if lname not in {"item", "entry"}:
            continue

        title = child_text(elem, ["title"])
        url = child_link(elem) or child_text(elem, ["guid", "id"])
        summary = child_text(elem, ["description", "summary", "content", "encoded"])
        author = child_text(elem, ["author", "creator", "name"])
        published_at = child_text(elem, ["pubdate", "published", "updated", "dc:date"])
        duration_raw = child_text(elem, ["duration"])
        duration_minutes = parse_podcast_duration_minutes(duration_raw) if duration_raw else None

        if not title or not url:
            continue
        entries.append(
            {
                "title": title,
                "url": url,
                "summary": summary,
                "author": author,
                "published_at": published_at,
                "duration_minutes": duration_minutes,
                "body_html": child_content_html(elem),
            }
        )
    return entries


def parse_podcast_duration_minutes(raw: str) -> Optional[int]:
    raw = (raw or "").strip()
    if not raw:
        return None
    if raw.isdigit():
        # Some feeds provide duration in seconds.
        seconds = int(raw)
        if seconds > 300:
            return max(1, round(seconds / 60))
        return seconds

    # HH:MM:SS or MM:SS
    parts = raw.split(":")
    try:
        if len(parts) == 3:
            h, m, s = [int(p) for p in parts]
            return h * 60 + m + (1 if s >= 30 else 0)
        if len(parts) == 2:
            m, s = [int(p) for p in parts]
            return m + (1 if s >= 30 else 0)
    except ValueError:
        return None
    return None


def clean_text(text: str, max_len: int = 600) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len]


def fetch_arxiv_items(cluster_id: str, query: str, max_results: int = 60) -> List[Dict[str, Any]]:
    encoded_query = urllib.parse.quote_plus(query)
    url = (
        "http://export.arxiv.org/api/query"
        f"?search_query=all:{encoded_query}&start=0&max_results={max_results}&sortBy=relevance"
    )
    xml_text = ""
    for attempt in range(3):
        try:
            xml_text = http_get_text(url, timeout=25)
            break
        except Exception as exc:
            if attempt == 2:
                print(f"[warn] arxiv fetch failed for '{query}': {exc}")
                return []
            time.sleep(1.5 * (attempt + 1))

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        print(f"[warn] arxiv parse failed for '{query}': {exc}")
        return []

    ns = {"atom": "http://www.w3.org/2005/Atom"}
    items: List[Dict[str, Any]] = []
    for entry in root.findall("atom:entry", ns):
        title = (entry.findtext("atom:title", default="", namespaces=ns) or "").strip()
        summary = (entry.findtext("atom:summary", default="", namespaces=ns) or "").strip()
        link = ""
        for link_el in entry.findall("atom:link", ns):
            href = link_el.attrib.get("href")
            if href and "abs/" in href:
                link = href
                break
        if not link:
            id_text = (entry.findtext("atom:id", default="", namespaces=ns) or "").strip()
            link = id_text

        authors = []
        for author in entry.findall("atom:author", ns):
            name = (author.findtext("atom:name", default="", namespaces=ns) or "").strip()
            if name:
                authors.append(name)
        published = (entry.findtext("atom:published", default="", namespaces=ns) or "").strip() or None

        if not title or not link:
            continue

        items.append(
            {
                "title": title,
                "url": link,
                "summary": clean_text(summary),
                "author": ", ".join(authors[:3]) if authors else None,
                "published_at": published,
                "source": "arXiv",
                "content_type": "paper",
                "cluster_id": cluster_id,
                "duration_minutes": None,
                "language": "en",
                "seed_query": query,
            }
        )
    return items


def fetch_youtube_items(
    cluster_id: str,
    query: str,
    api_key: str,
    *,
    max_results: int = 50,
    min_duration_minutes: int = 5,
    max_duration_minutes: Optional[int] = None,
    min_duration_seconds: Optional[int] = None,
    max_duration_seconds: Optional[int] = None,
    exclude_shorts: bool = False,
) -> List[Dict[str, Any]]:
    encoded_query = urllib.parse.quote_plus(query)
    search_url = (
        "https://www.googleapis.com/youtube/v3/search"
        f"?part=snippet&type=video&q={encoded_query}&maxResults={max_results}&key={api_key}"
    )
    try:
        search_payload = json.loads(http_get_text(search_url, timeout=20))
    except Exception as exc:
        print(f"[warn] youtube search failed for '{query}': {exc}")
        return []

    video_ids = []
    for item in search_payload.get("items", []):
        vid = ((item.get("id") or {}).get("videoId") or "").strip()
        if vid:
            video_ids.append(vid)

    if not video_ids:
        return []

    details_url = (
        "https://www.googleapis.com/youtube/v3/videos"
        f"?part=contentDetails,snippet&id={','.join(video_ids)}&key={api_key}"
    )
    try:
        details_payload = json.loads(http_get_text(details_url, timeout=20))
    except Exception as exc:
        print(f"[warn] youtube details failed for '{query}': {exc}")
        return []

    results: List[Dict[str, Any]] = []
    for item in details_payload.get("items", []):
        snippet = item.get("snippet", {})
        details = item.get("contentDetails", {})
        duration_raw = details.get("duration", "")
        duration_seconds = parse_iso8601_duration_seconds(duration_raw)
        duration_minutes = (
            duration_seconds // 60 + (1 if duration_seconds % 60 >= 30 else 0)
            if duration_seconds is not None else None
        )
        if min_duration_seconds is not None:
            if duration_seconds is None or duration_seconds < min_duration_seconds:
                continue
        elif duration_minutes is not None and duration_minutes < min_duration_minutes:
            continue
        if max_duration_seconds is not None:
            if duration_seconds is None or duration_seconds > max_duration_seconds:
                continue
        elif (
            max_duration_minutes is not None
            and duration_minutes is not None
            and duration_minutes > max_duration_minutes
        ):
            continue

        video_id = item.get("id")
        title = (snippet.get("title") or "").strip()
        description = (snippet.get("description") or "").strip()
        if exclude_shorts and is_youtube_short(title, description, duration_seconds):
            continue
        channel = (snippet.get("channelTitle") or "").strip()
        published = (snippet.get("publishedAt") or "").strip() or None

        if not video_id or not title:
            continue

        results.append(
            {
                "title": title,
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "summary": clean_text(description),
                "author": channel or None,
                "published_at": published,
                "source": "YouTube",
                "content_type": "video",
                "cluster_id": cluster_id,
                "duration_minutes": duration_minutes,
                "language": "en",
                "seed_query": query,
            }
        )
    return results


def compute_target_counts(total_items: int) -> Dict[str, int]:
    raw = {k: total_items * v for k, v in TYPE_WEIGHTS.items()}
    counts = {k: int(v) for k, v in raw.items()}
    # distribute rounding remainder
    remainder = total_items - sum(counts.values())
    order = sorted(TYPE_WEIGHTS.keys(), key=lambda k: TYPE_WEIGHTS[k], reverse=True)
    idx = 0
    while remainder > 0:
        counts[order[idx % len(order)]] += 1
        remainder -= 1
        idx += 1
    return counts


def choose_balanced_items(
    candidates: List[Dict[str, Any]],
    *,
    target_count: int,
    cluster_ids: List[str],
) -> List[Dict[str, Any]]:
    if target_count <= 0 or not candidates:
        return []

    per_cluster_target = max(1, target_count // max(1, len(cluster_ids)))
    bucketed: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for item in candidates:
        bucketed[item.get("cluster_id")].append(item)

    selected: List[Dict[str, Any]] = []
    used_urls: set = set()

    for cluster_id in cluster_ids:
        picked = 0
        for item in bucketed.get(cluster_id, []):
            url = item.get("url")
            if not url or url in used_urls:
                continue
            selected.append(item)
            used_urls.add(url)
            picked += 1
            if picked >= per_cluster_target or len(selected) >= target_count:
                break
        if len(selected) >= target_count:
            return selected

    for item in candidates:
        if len(selected) >= target_count:
            break
        url = item.get("url")
        if not url or url in used_urls:
            continue
        selected.append(item)
        used_urls.add(url)
    return selected


def enrich_item(item: Dict[str, Any], idx: int) -> Dict[str, Any]:
    title = item.get("title", "")
    summary = item.get("summary", "")
    body_text = (item.get("body_text") or "").strip()
    read_time_minutes = item.get("read_time_minutes")
    if read_time_minutes is None and item.get("content_type") == "article":
        source_text = body_text or f"{title} {summary}"
        word_count = len(source_text.split())
        read_time_minutes = max(1, round(word_count / 200))

    now = datetime.now(timezone.utc).isoformat()
    enriched = {
        "id": f"content_{idx:05d}",
        "title": title,
        "url": item.get("url"),
        "content_type": item.get("content_type"),
        "cluster_id": item.get("cluster_id"),
        "source": item.get("source"),
        "summary": summary,
        "author": item.get("author"),
        "published_at": item.get("published_at"),
        "duration_minutes": item.get("duration_minutes"),
        "read_time_minutes": read_time_minutes,
        "language": item.get("language", "en"),
        "seed_query": item.get("seed_query"),
        "created_at": now,
    }
    if body_text:
        enriched["body_text"] = body_text
    if item.get("reader_ready"):
        enriched["reader_ready"] = True
    return enriched


def load_existing_article_urls(db_path: Path) -> set:
    if not db_path.exists():
        return set()
    con = sqlite3.connect(db_path)
    try:
        rows = con.execute(
            "SELECT url FROM contents WHERE content_type = 'article'"
        ).fetchall()
        return {row[0] for row in rows if row[0]}
    finally:
        con.close()


def collect_candidates(
    config: Dict[str, Any],
    youtube_api_key: Optional[str],
    *,
    validate_articles: bool = False,
    scrape_fallback: bool = False,
    scrape_delay: float = 0.25,
    article_max_items: int = 90,
    exclude_urls: Optional[set] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    candidates: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    clusters = config.get("clusters", [])

    supplement_feeds = list(config.get("supplement_feeds") or [])

    def _collect_article_feed(feed: str, cluster_id: str) -> None:
        items = fetch_rss_or_atom_items(
            feed,
            cluster_id=cluster_id,
            content_type="article",
            max_items=article_max_items,
            validate_articles=validate_articles,
            scrape_fallback=scrape_fallback,
            scrape_delay=scrape_delay,
        )
        if exclude_urls:
            before = len(items)
            items = [it for it in items if it.get("url") not in exclude_urls]
            if validate_articles and before != len(items):
                print(f"  [article] {feed} → {len(items)} new reader-ready ({before - len(items)} already in db)")
            elif validate_articles:
                print(f"  [article] {feed} → {len(items)} reader-ready")
        elif validate_articles:
            print(f"  [article] {feed} → {len(items)} reader-ready")
        candidates["article"].extend(items)

    for cluster in clusters:
        cluster_id = cluster["id"]
        print(f"[info] collecting cluster: {cluster_id}")

        for feed in cluster.get("article_rss_feeds", []):
            _collect_article_feed(feed, cluster_id)

        for feed in cluster.get("podcast_rss_feeds", []):
            items = fetch_rss_or_atom_items(
                feed,
                cluster_id=cluster_id,
                content_type="podcast",
                max_items=90,
                min_duration_minutes=20,
            )
            candidates["podcast"].extend(items)

        for query in cluster.get("arxiv_queries", []):
            items = fetch_arxiv_items(cluster_id, query, max_results=35)
            candidates["paper"].extend(items)
            time.sleep(1.0)

        if youtube_api_key:
            for query in cluster.get("youtube_queries", []):
                items = fetch_youtube_items(
                    cluster_id,
                    query,
                    youtube_api_key,
                    max_results=50,
                    min_duration_minutes=5,
                )
                candidates["video"].extend(items)
                time.sleep(0.25)
        else:
            print("[info] skipping YouTube (no YOUTUBE_API_KEY set)")

    if supplement_feeds and clusters:
        print(f"[info] collecting {len(supplement_feeds)} supplement article feeds")
        for i, feed in enumerate(supplement_feeds):
            cluster_id = clusters[i % len(clusters)]["id"]
            _collect_article_feed(feed, cluster_id)

    return candidates


def dedupe_candidates(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set = set()
    deduped: List[Dict[str, Any]] = []
    for item in items:
        url = (item.get("url") or "").strip()
        title = (item.get("title") or "").strip().lower()
        key = url or title
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect long-form content metadata for BuzzNet prototype.")
    parser.add_argument(
        "--config",
        type=str,
        default="creative_seed_config.json",
        help="Path to seed config JSON.",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="creative_content_metadata.json",
        help="Path to output metadata JSON.",
    )
    parser.add_argument(
        "--total",
        type=int,
        default=DEFAULT_TOTAL_ITEMS,
        help="Target number of items to collect.",
    )
    parser.add_argument(
        "--articles-only",
        action="store_true",
        help="Collect articles only (no video/podcast/paper).",
    )
    parser.add_argument(
        "--validate-articles",
        action="store_true",
        help="Keep only articles with full in-app body text.",
    )
    parser.add_argument(
        "--scrape-fallback",
        action="store_true",
        help="When RSS has no full body, try newspaper scrape (slower).",
    )
    parser.add_argument(
        "--scrape-delay",
        type=float,
        default=0.25,
        help="Delay between article scrape fallbacks.",
    )
    parser.add_argument(
        "--article-max-items",
        type=int,
        default=90,
        help="Max RSS entries to probe per article feed.",
    )
    parser.add_argument(
        "--exclude-existing-urls",
        action="store_true",
        help="Skip article URLs already present in noscroll.db.",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    config_path = Path(args.config)
    if not config_path.is_absolute():
        config_path = script_dir / config_path
    output_path = Path(args.output)
    if not output_path.is_absolute():
        output_path = script_dir / output_path

    if not config_path.exists():
        raise FileNotFoundError(f"Config not found: {config_path}")

    config = load_seed_config(config_path)
    cluster_ids = [cluster["id"] for cluster in config.get("clusters", [])]
    if args.articles_only:
        target_counts = {"article": args.total}
    else:
        target_counts = compute_target_counts(args.total)
    youtube_api_key = os.getenv("YOUTUBE_API_KEY")

    print("[info] target distribution:", target_counts)
    exclude_urls = None
    if args.exclude_existing_urls:
        db_path = script_dir / "data" / "noscroll.db"
        exclude_urls = load_existing_article_urls(db_path)
        print(f"[info] excluding {len(exclude_urls)} existing article URLs from db")

    candidates_by_type = collect_candidates(
        config,
        youtube_api_key,
        validate_articles=args.validate_articles,
        scrape_fallback=args.scrape_fallback,
        scrape_delay=args.scrape_delay,
        article_max_items=args.article_max_items,
        exclude_urls=exclude_urls,
    )

    final_items: List[Dict[str, Any]] = []
    for content_type, target in target_counts.items():
        deduped = dedupe_candidates(candidates_by_type.get(content_type, []))
        selected = choose_balanced_items(deduped, target_count=target, cluster_ids=cluster_ids)
        final_items.extend(selected)
        print(
            f"[info] {content_type}: candidates={len(deduped)} selected={len(selected)} target={target}"
        )

    # Global dedupe + id assignment
    global_deduped = dedupe_candidates(final_items)
    enriched = [enrich_item(item, i + 1) for i, item in enumerate(global_deduped)]

    output_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target_total": args.total,
        "actual_total": len(enriched),
        "target_distribution": target_counts,
        "actual_distribution": dict(CounterMap(enriched, "content_type")),
        "clusters": config.get("clusters", []),
        "items": enriched,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(output_payload, f, indent=2, ensure_ascii=False)

    print(f"[done] wrote metadata to: {output_path}")
    print(f"[done] collected items: {len(enriched)}")


def CounterMap(items: List[Dict[str, Any]], key: str) -> Dict[str, int]:
    counts: Dict[str, int] = defaultdict(int)
    for item in items:
        value = item.get(key)
        if value:
            counts[value] += 1
    return dict(counts)


if __name__ == "__main__":
    main()
