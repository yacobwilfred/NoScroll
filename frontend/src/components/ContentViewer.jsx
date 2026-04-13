import { useEffect, useState } from "react";
import { getReaderView } from "../api";
import ContentTypeTag from "./ContentTypeTag";

// ── helpers ──────────────────────────────────────────────────────────────────

function getYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    return u.searchParams.get("v") || null;
  } catch {
    return null;
  }
}

function getSpotifyEpisodeId(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("spotify.com")) return null;
    const match = u.pathname.match(/episode\/([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getArxivId(url) {
  try {
    const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([^\s/?#]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── sub-renderers ─────────────────────────────────────────────────────────────

function VideoViewer({ node }) {
  const ytId = getYouTubeId(node.url);
  if (!ytId) {
    return (
      <FallbackLink node={node} message="Could not embed this video." />
    );
  }
  return (
    <div className="viewer-video">
      <div className="viewer-embed-wrap">
        <iframe
          src={`https://www.youtube.com/embed/${ytId}?rel=0`}
          title={node.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}

function PaperViewer({ node }) {
  const arxivId = getArxivId(node.url);
  return (
    <div className="viewer-paper">
      {node.summary && (
        <div className="viewer-abstract">
          <h3>Abstract</h3>
          <p>{node.summary}</p>
        </div>
      )}
      {arxivId && (
        <div className="viewer-embed-wrap viewer-embed-wrap--paper">
          <iframe
            src={`https://arxiv.org/pdf/${arxivId}`}
            title={node.title}
          />
        </div>
      )}
      {!arxivId && <FallbackLink node={node} message="Open the full paper externally." />}
    </div>
  );
}

function PodcastViewer({ node }) {
  const spotifyId = getSpotifyEpisodeId(node.url);

  // Determine if URL is a direct audio file
  const isDirectAudio =
    !spotifyId &&
    (node.url.endsWith(".mp3") ||
      node.url.endsWith(".m4a") ||
      node.url.endsWith(".ogg") ||
      node.url.includes(".mp3?") ||
      node.url.includes(".m4a?"));

  return (
    <div className="viewer-podcast">
      {node.summary && <p className="viewer-podcast__summary">{node.summary}</p>}

      {spotifyId && (
        <div className="viewer-embed-wrap viewer-embed-wrap--spotify">
          <iframe
            src={`https://open.spotify.com/embed/episode/${spotifyId}`}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            title={node.title}
          />
        </div>
      )}

      {isDirectAudio && (
        <audio className="viewer-audio" controls>
          <source src={node.url} />
          Your browser does not support the audio element.
        </audio>
      )}

      {!spotifyId && !isDirectAudio && (
        <a
          className="viewer-external-btn"
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Listen to episode →
        </a>
      )}
    </div>
  );
}

function ArticleViewer({ node }) {
  const [reader, setReader] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | success | fallback

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    getReaderView(node.id)
      .then((data) => {
        if (cancelled) return;
        if (data.success && data.body_text) {
          setReader(data);
          setStatus("success");
        } else {
          setStatus("fallback");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("fallback");
      });
    return () => { cancelled = true; };
  }, [node.id]);

  if (status === "loading") {
    return <div className="viewer-loading">Loading article…</div>;
  }

  if (status === "success" && reader) {
    return (
      <div className="viewer-article">
        {reader.top_image && (
          <img className="viewer-article__image" src={reader.top_image} alt="" />
        )}
        <div className="viewer-article__body">
          {reader.body_text.split("\n\n").map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
        <a
          className="viewer-external-btn viewer-external-btn--subtle"
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Read original →
        </a>
      </div>
    );
  }

  return (
    <div className="viewer-article viewer-article--fallback">
      {node.summary && <p className="viewer-article__summary">{node.summary}</p>}
      <a
        className="viewer-external-btn"
        href={node.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Read original article →
      </a>
    </div>
  );
}

function FallbackLink({ node, message }) {
  return (
    <div className="viewer-fallback">
      {message && <p>{message}</p>}
      <a
        className="viewer-external-btn"
        href={node.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open externally →
      </a>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function ContentViewer({ node, onClose }) {
  const meta = node.duration_minutes
    ? `${node.duration_minutes} min`
    : node.read_time_minutes
    ? `${node.read_time_minutes} min read`
    : null;

  return (
    <div className="content-viewer">
      <div className="content-viewer__overlay" onClick={onClose} />
      <div className="content-viewer__panel">
        <button className="content-viewer__close" onClick={onClose}>✕</button>

        <div className="content-viewer__header">
          <div className="content-viewer__meta-row">
            <ContentTypeTag type={node.content_type} />
            {meta && <span className="content-viewer__meta">{meta}</span>}
          </div>
          <h2 className="content-viewer__title">{node.title}</h2>
          {node.author && (
            <p className="content-viewer__author">{node.author}</p>
          )}
        </div>

        <div className="content-viewer__body">
          {node.content_type === "video" && <VideoViewer node={node} />}
          {node.content_type === "paper" && <PaperViewer node={node} />}
          {node.content_type === "podcast" && <PodcastViewer node={node} />}
          {node.content_type === "article" && <ArticleViewer node={node} />}
        </div>
      </div>
    </div>
  );
}
