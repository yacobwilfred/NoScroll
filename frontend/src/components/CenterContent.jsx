import { useEffect, useState } from "react";
import { getReaderView, getAudioUrl } from "../api";
import ContentTypeTag from "./ContentTypeTag";

// ── helpers ───────────────────────────────────────────────────────────────────

function getYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    return u.searchParams.get("v") || null;
  } catch { return null; }
}

function getSpotifyEpisodeId(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("spotify.com")) return null;
    const match = u.pathname.match(/episode\/([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

function getArxivId(url) {
  try {
    const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([^\s/?#]+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

function isDirectAudio(url) {
  return /\.(mp3|m4a|ogg)(\?|$)/.test(url);
}

// ── per-type renderers ────────────────────────────────────────────────────────

function VideoCenter({ node }) {
  const ytId = getYouTubeId(node.url);
  if (!ytId) return (
    <div className="cc-fallback">
      <p>Could not embed this video.</p>
      <a href={node.url} target="_blank" rel="noopener noreferrer" className="cc-link">Watch on YouTube →</a>
    </div>
  );
  return (
    <iframe
      className="cc-video-iframe"
      src={`https://www.youtube.com/embed/${ytId}?rel=0`}
      title={node.title}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
    />
  );
}

function ArticleCenter({ node }) {
  const [status, setStatus] = useState("loading");
  const [reader, setReader] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setReader(null);
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
      .catch(() => { if (!cancelled) setStatus("fallback"); });
    return () => { cancelled = true; };
  }, [node.id]);

  if (status === "loading") return <div className="cc-loading">Loading article…</div>;

  if (status === "success" && reader) {
    return (
      <div className="cc-article-body">
        {reader.top_image && (
          <img className="cc-article-image" src={reader.top_image} alt="" />
        )}
        {reader.body_text.split("\n\n").map((para, i) => (
          <p key={i}>{para}</p>
        ))}
        <a className="cc-link cc-link--subtle" href={node.url} target="_blank" rel="noopener noreferrer">
          Read original →
        </a>
      </div>
    );
  }

  // Extract a readable domain name for attribution
  let domain = "";
  try { domain = new URL(node.url).hostname.replace(/^www\./, ""); } catch { /* noop */ }

  return (
    <div className="cc-fallback cc-fallback--article">
      {node.summary ? (
        <>
          <p className="cc-fallback__label">Summary</p>
          <p className="cc-summary">{node.summary}</p>
        </>
      ) : (
        <p className="cc-summary cc-summary--muted">No preview available for this article.</p>
      )}
      <div className="cc-fallback__footer">
        {domain && <span className="cc-fallback__source">{domain}</span>}
        <a className="cc-link cc-link--secondary" href={node.url} target="_blank" rel="noopener noreferrer">
          Open in browser ↗
        </a>
      </div>
    </div>
  );
}

function PodcastCenter({ node }) {
  const spotifyId = getSpotifyEpisodeId(node.url);
  const directAudio = isDirectAudio(node.url) ? node.url : null;
  const [resolvedAudio, setResolvedAudio] = useState(null);
  const [audioStatus, setAudioStatus] = useState(
    spotifyId || directAudio ? "ready" : "loading"
  );

  useEffect(() => {
    if (spotifyId || directAudio) return; // no need to resolve
    let cancelled = false;
    setAudioStatus("loading");
    setResolvedAudio(null);
    getAudioUrl(node.id)
      .then((data) => {
        if (cancelled) return;
        if (data.audio_url) {
          setResolvedAudio(data.audio_url);
          setAudioStatus("ready");
        } else {
          setAudioStatus("failed");
        }
      })
      .catch(() => { if (!cancelled) setAudioStatus("failed"); });
    return () => { cancelled = true; };
  }, [node.id, spotifyId, directAudio]);

  const audioSrc = directAudio || resolvedAudio;

  return (
    <div className="cc-podcast-body">
      {node.summary && <p className="cc-summary">{node.summary}</p>}

      {spotifyId && (
        <iframe
          className="cc-spotify"
          src={`https://open.spotify.com/embed/episode/${spotifyId}`}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          title={node.title}
        />
      )}

      {!spotifyId && audioStatus === "loading" && (
        <div className="cc-loading">Resolving audio…</div>
      )}

      {!spotifyId && audioSrc && (
        <audio className="cc-audio" controls>
          <source src={audioSrc} />
          Your browser does not support audio playback.
        </audio>
      )}

      {!spotifyId && audioStatus === "failed" && (
        <p className="cc-fallback-note">Audio unavailable for this episode.</p>
      )}
    </div>
  );
}

function PaperCenter({ node }) {
  const arxivId = getArxivId(node.url);
  const [view, setView] = useState("abstract"); // "abstract" | "reader"

  if (view === "reader" && arxivId) {
    return (
      <div className="cc-paper-reader">
        <button className="cc-back-btn" onClick={() => setView("abstract")}>← Abstract</button>
        <iframe
          className="cc-paper-iframe"
          src={`https://arxiv.org/html/${arxivId}`}
          title={node.title}
          sandbox="allow-scripts allow-same-origin allow-popups"
        />
      </div>
    );
  }

  return (
    <div className="cc-paper-body">
      {node.summary && (
        <div className="cc-abstract">
          <h3>Abstract</h3>
          <p>{node.summary}</p>
        </div>
      )}
      {arxivId && (
        <button className="cc-read-btn" onClick={() => setView("reader")}>
          Read full paper →
        </button>
      )}
      {!arxivId && (
        <a className="cc-link" href={node.url} target="_blank" rel="noopener noreferrer">
          View paper →
        </a>
      )}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function CenterContent({ node, savedItemId, onSave, onUnsave }) {
  const isVideo = node.content_type === "video";
  const isSaved = Boolean(savedItemId);
  const meta = node.duration_minutes
    ? `${node.duration_minutes} min`
    : node.read_time_minutes
    ? `${node.read_time_minutes} min read`
    : null;

  function handleSaveToggle() {
    if (isSaved) onUnsave?.(savedItemId);
    else onSave?.(node);
  }

  return (
    <div className={`center-content ${isVideo ? "center-content--video" : ""}`}>
      {isVideo ? (
        <>
          <VideoCenter node={node} />
          {/* Floating save button for videos */}
          <button
            className={`cc-save-btn cc-save-btn--floating ${isSaved ? "cc-save-btn--saved" : ""}`}
            onClick={handleSaveToggle}
            title={isSaved ? "Unsave" : "Save"}
            aria-label={isSaved ? "Unsave" : "Save"}
          >
            {isSaved ? "⊛" : "⊙"}
          </button>
        </>
      ) : (
        <>
          <div className="center-content__header">
            <div className="center-content__header-row">
              <ContentTypeTag type={node.content_type} />
              {meta && <span className="center-content__meta">{meta}</span>}
              <button
                className={`cc-save-btn ${isSaved ? "cc-save-btn--saved" : ""}`}
                onClick={handleSaveToggle}
                title={isSaved ? "Unsave" : "Save"}
                aria-label={isSaved ? "Unsave" : "Save"}
              >
                {isSaved ? "⊛" : "⊙"}
              </button>
            </div>
            <h2 className="center-content__title">{node.title}</h2>
            {node.author && <p className="center-content__author">{node.author}</p>}
          </div>
          <div className="center-content__body">
            {node.content_type === "article" && <ArticleCenter node={node} />}
            {node.content_type === "podcast" && <PodcastCenter node={node} />}
            {node.content_type === "paper"   && <PaperCenter node={node} />}
          </div>
        </>
      )}
    </div>
  );
}
