import { useState, useEffect } from "react";
import { getPublicCollection, getPublicCollectionItems, startSessionFromExternal } from "../api";
import ContentTypeTag from "./ContentTypeTag";

function ExploreButton({ item }) {
  const [status, setStatus] = useState("idle"); // idle | loading | error

  async function handleExplore() {
    setStatus("loading");
    try {
      const data = await startSessionFromExternal({
        url: item.url,
        title: item.title,
        content_type: item.content_type,
        summary: item.summary || null,
        author: item.author || null,
        source: item.source || null,
        thumbnail: item.thumbnail || null,
      });
      // Navigate to root with session data encoded in sessionStorage, then reload
      sessionStorage.setItem("noscroll_pending_session", JSON.stringify(data));
      window.location.href = "/";
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }

  return (
    <button
      className="pd-btn pd-btn--primary pd-btn--sm"
      onClick={handleExplore}
      disabled={status === "loading"}
    >
      {status === "loading" ? "Loading…" : status === "error" ? "Failed" : "Explore →"}
    </button>
  );
}

export default function PublicCollectionPage({ colId }) {
  const [col, setCol] = useState(null);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    async function load() {
      try {
        const [colData, itemsData] = await Promise.all([
          getPublicCollection(colId),
          getPublicCollectionItems(colId),
        ]);
        setCol(colData);
        setItems(itemsData);
        setStatus("found");
      } catch {
        setStatus("notfound");
      }
    }
    load();
  }, [colId]);

  if (status === "loading") {
    return <div className="pub-col-not-found"><p>Loading…</p></div>;
  }

  if (status === "notfound") {
    return (
      <div className="pub-col-not-found">
        <p>Collection not found or is private.</p>
        <a href="/" className="pub-col-back">← Go back</a>
      </div>
    );
  }

  return (
    <div className="pub-col-page">
      <div className="pub-col-page__inner">
        <div>
          <h1 className="pub-col-page__title">{col.name}</h1>
          {col.description && <p className="pub-col-page__desc">{col.description}</p>}
          <div className="pub-col-page__meta">
            <span className="pd-col-badge pd-col-badge--public">public collection</span>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              {col.item_count} items
            </span>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="pub-col-empty">This collection has no items yet.</p>
        ) : (
          <div className="pub-col-page__items">
            {items.map((item) => (
              <div key={item.id} className="pub-col-item">
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <ContentTypeTag type={item.content_type} />
                  {item.source && <span className="pub-col-item__source">{item.source}</span>}
                </div>
                <p className="pub-col-item__title">{item.title}</p>
                {item.caption && (
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    "{item.caption}"
                  </p>
                )}
                {item.summary && (
                  <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: "1.55" }}>
                    {item.summary.slice(0, 180)}{item.summary.length > 180 ? "…" : ""}
                  </p>
                )}
                <div className="pub-col-item__actions" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pd-btn pd-btn--ghost pd-btn--sm"
                  >Open ↗</a>
                  <ExploreButton item={item} />
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <a href="/" className="pub-col-back">← Explore</a>
        </div>
      </div>
    </div>
  );
}
