import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  listSaved,
  unsaveItem,
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  addToCollection,
  removeFromCollection,
  listCollectionItems,
  extractUrl,
  saveItem,
} from "../api";
import ContentTypeTag from "./ContentTypeTag";
import CollectionCombobox from "./CollectionCombobox";

// ── small helpers ─────────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── SavedItem card ────────────────────────────────────────────────────────────

function SavedCard({ item, token, collections, onUnsave, onAddToCollection, onRemoveFromCollection }) {
  const [showCollMenu, setShowCollMenu] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowCollMenu(false);
    }
    if (showCollMenu) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCollMenu]);

  return (
    <div className="pd-saved-card">
      <div className="pd-saved-card__header">
        <ContentTypeTag type={item.content_type} />
        <span className="pd-saved-card__time">{timeAgo(item.saved_at)}</span>
      </div>
      <p className="pd-saved-card__title">{item.title}</p>
      {item.caption && <p className="pd-saved-card__caption">"{item.caption}"</p>}
      {item.source && <p className="pd-saved-card__source">{item.source}</p>}
      <div className="pd-saved-card__actions">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="pd-btn pd-btn--ghost pd-btn--xs"
        >
          Open ↗
        </a>
        <div className="pd-popover-wrap" ref={menuRef}>
          <button
            className="pd-btn pd-btn--ghost pd-btn--xs"
            onClick={() => setShowCollMenu((v) => !v)}
          >
            + Collection
          </button>
          {showCollMenu && (
            <div className="pd-popover">
              {collections.length === 0 && (
                <p className="pd-popover__empty">No collections yet.</p>
              )}
              {collections.map((col) => {
                const inCol = item.collection_ids?.includes(col.id);
                return (
                  <button
                    key={col.id}
                    className={`pd-popover__item ${inCol ? "pd-popover__item--active" : ""}`}
                    onClick={() => {
                      if (inCol) onRemoveFromCollection(col.id, item.id);
                      else onAddToCollection(col.id, item.id);
                      setShowCollMenu(false);
                    }}
                  >
                    {inCol ? "✓ " : ""}{col.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button
          className="pd-btn pd-btn--ghost pd-btn--xs pd-btn--danger"
          onClick={() => onUnsave(item.id)}
          title="Remove from saved"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ── Collection card ───────────────────────────────────────────────────────────

function CollectionCard({ col, token, onDelete, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(col.name);
  const [editDesc, setEditDesc] = useState(col.description || "");
  const [editPublic, setEditPublic] = useState(col.is_public);

  async function handleExpand() {
    if (!expanded) {
      setLoadingItems(true);
      try {
        const data = await listCollectionItems(token, col.id);
        setItems(data);
      } catch { /* ignore */ }
      setLoadingItems(false);
    }
    setExpanded((v) => !v);
  }

  async function handleSaveEdit() {
    const updated = await onUpdate(col.id, {
      name: editName,
      description: editDesc,
      is_public: editPublic,
    });
    if (updated) setEditing(false);
  }

  const collectionUrl = `${window.location.origin}/c/${col.id}`;

  return (
    <div className="pd-col-card">
      <div className="pd-col-card__header" onClick={handleExpand}>
        <div className="pd-col-card__info">
          <span className="pd-col-card__name">{col.name}</span>
          <span className={`pd-col-badge ${col.is_public ? "pd-col-badge--public" : "pd-col-badge--private"}`}>
            {col.is_public ? "public" : "private"}
          </span>
        </div>
        <div className="pd-col-card__meta">
          <span className="pd-col-card__count">{col.item_count} items</span>
          <span className="pd-col-card__chevron">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="pd-col-card__body">
          {col.is_public && (
            <div className="pd-col-share">
              <span className="pd-col-share__label">Share link:</span>
              <code className="pd-col-share__url"
                title={collectionUrl}
                onClick={() => { navigator.clipboard?.writeText(collectionUrl); }}
              >{collectionUrl}</code>
            </div>
          )}

          {editing ? (
            <div className="pd-col-edit-form">
              <input
                className="pd-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Collection name"
              />
              <textarea
                className="pd-input pd-input--textarea"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
              />
              <label className="pd-toggle">
                <input type="checkbox" checked={editPublic} onChange={(e) => setEditPublic(e.target.checked)} />
                Public (shareable link)
              </label>
              <div className="pd-col-edit-form__actions">
                <button className="pd-btn pd-btn--primary pd-btn--sm" onClick={handleSaveEdit}>Save</button>
                <button className="pd-btn pd-btn--ghost pd-btn--sm" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="pd-col-card__actions">
              <button className="pd-btn pd-btn--ghost pd-btn--xs" onClick={() => setEditing(true)}>Edit</button>
              <button
                className="pd-btn pd-btn--ghost pd-btn--xs pd-btn--danger"
                onClick={() => onDelete(col.id)}
              >Delete</button>
            </div>
          )}

          {loadingItems && <p className="pd-col-loading">Loading…</p>}
          {!loadingItems && items.length === 0 && (
            <p className="pd-col-empty">No items yet. Save content and add it here.</p>
          )}
          {!loadingItems && items.map((item) => (
            <div key={item.id} className="pd-col-item">
              <ContentTypeTag type={item.content_type} />
              <span className="pd-col-item__title">{item.title}</span>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="pd-btn pd-btn--ghost pd-btn--xs"
              >↗</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── External URL add form ─────────────────────────────────────────────────────

function AddExternalForm({ token, collections, onAdded }) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | preview | saving | error
  const [editTitle, setEditTitle] = useState("");
  const [editType, setEditType] = useState("article");
  const [caption, setCaption] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [pendingNames, setPendingNames] = useState([]);
  const [error, setError] = useState("");

  async function handleExtract(e) {
    e.preventDefault();
    if (!url.startsWith("http")) { setError("Enter a full URL (https://…)"); return; }
    setError("");
    setStatus("loading");
    try {
      const data = await extractUrl(url);
      setPreview(data);
      setEditTitle(data.title || "");
      setEditType(data.content_type || "article");
      setStatus("preview");
    } catch {
      setError("Could not extract metadata from this URL.");
      setStatus("idle");
    }
  }

  function handleToggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleCreateAndSelect(name) {
    if (!pendingNames.includes(name)) setPendingNames((prev) => [...prev, name]);
  }

  function handleRemovePending(name) {
    setPendingNames((prev) => prev.filter((n) => n !== name));
  }

  const totalSelected = selectedIds.size + pendingNames.length;
  const canSave = editTitle.trim() && totalSelected > 0;

  async function handleSave() {
    if (!canSave) return;
    setStatus("saving");
    try {
      // Save item
      const saved = await saveItem(token, {
        url: preview.url,
        title: editTitle.trim(),
        content_type: editType,
        source: preview.source || null,
        summary: preview.summary || null,
        thumbnail: preview.thumbnail || null,
        author: preview.author || null,
        caption: caption.trim() || null,
      });

      // Create pending collections then add all
      const createdIds = await Promise.all(
        pendingNames.map((name) =>
          createCollection(token, { name }).then((col) => col.id)
        )
      );
      const allColIds = [...selectedIds, ...createdIds];
      await Promise.all(
        allColIds.map((colId) => addToCollection(token, colId, saved.id).catch(() => {}))
      );

      onAdded(saved);
      setUrl(""); setPreview(null); setEditTitle(""); setCaption("");
      setSelectedIds(new Set()); setPendingNames([]); setStatus("idle");
    } catch {
      setError("Could not save this item.");
      setStatus("preview");
    }
  }

  return (
    <div className="pd-external-form">
      <p className="pd-section-label">Save from URL</p>
      <form onSubmit={handleExtract} className="pd-url-row">
        <input
          className="pd-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          disabled={status === "loading" || status === "saving"}
        />
        <button
          className="pd-btn pd-btn--primary pd-btn--sm"
          disabled={!url || status === "loading" || status === "saving"}
        >
          {status === "loading" ? "…" : "Fetch"}
        </button>
      </form>
      {error && <p className="pd-error">{error}</p>}
      {(status === "preview" || status === "saving") && preview && (
        <div className="pd-url-preview">
          <input
            className="pd-input"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title"
          />
          <select
            className="pd-input pd-input--select"
            value={editType}
            onChange={(e) => setEditType(e.target.value)}
          >
            <option value="article">Article</option>
            <option value="video">Video</option>
            <option value="podcast">Podcast</option>
            <option value="paper">Paper</option>
          </select>
          {preview.source && <p className="pd-url-preview__source">from {preview.source}</p>}
          <textarea
            className="pd-input pd-input--textarea"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption (optional) — why are you saving this?"
            rows={2}
          />
          <div className="sm-field" style={{ marginTop: "0.1rem" }}>
            <label className="sm-label">Collections <span className="sm-required">*</span></label>
            {pendingNames.length > 0 && (
              <div className="ccb-chips">
                {pendingNames.map((name) => (
                  <span key={name} className="ccb-chip ccb-chip--new">
                    {name}
                    <button
                      className="ccb-chip__remove"
                      type="button"
                      onClick={() => handleRemovePending(name)}
                    >✕</button>
                  </span>
                ))}
              </div>
            )}
            <CollectionCombobox
              collections={collections}
              selectedIds={selectedIds}
              onToggle={handleToggle}
              onCreateAndSelect={handleCreateAndSelect}
            />
          </div>
          <button
            className="pd-btn pd-btn--primary pd-btn--sm"
            onClick={handleSave}
            disabled={!canSave || status === "saving"}
          >
            {status === "saving" ? "Saving…" : `Save${totalSelected > 0 ? ` to ${totalSelected}` : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main ProfileDrawer ────────────────────────────────────────────────────────

export default function ProfileDrawer({ token, onClose, initialSavedItems, onItemUnsaved }) {
  const [tab, setTab] = useState("saved");
  const [savedItems, setSavedItems] = useState(initialSavedItems || []);
  const [collections, setCollections] = useState([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [showNewColForm, setShowNewColForm] = useState(false);

  // Load collections on mount (needed both for the Collections tab and the Save-from-URL form)
  useEffect(() => {
    setLoadingCollections(true);
    listCollections(token)
      .then(setCollections)
      .catch(() => {})
      .finally(() => setLoadingCollections(false));
  }, [token]);

  // Refresh saved items when drawer opens with fresh data from backend
  useEffect(() => {
    listSaved(token)
      .then(setSavedItems)
      .catch(() => {});
  }, [token]);

  async function handleUnsave(itemId) {
    setSavedItems((prev) => prev.filter((it) => it.id !== itemId));
    onItemUnsaved?.(itemId);
    try { await unsaveItem(token, itemId); } catch { /* silent */ }
  }

  async function handleAddToCollection(colId, savedItemId) {
    await addToCollection(token, colId, savedItemId);
    setSavedItems((prev) =>
      prev.map((it) =>
        it.id === savedItemId
          ? { ...it, collection_ids: [...(it.collection_ids || []), colId] }
          : it
      )
    );
  }

  async function handleRemoveFromCollection(colId, savedItemId) {
    await removeFromCollection(token, colId, savedItemId);
    setSavedItems((prev) =>
      prev.map((it) =>
        it.id === savedItemId
          ? { ...it, collection_ids: (it.collection_ids || []).filter((c) => c !== colId) }
          : it
      )
    );
  }

  async function handleCreateCollection() {
    if (!newColName.trim()) return;
    const col = await createCollection(token, { name: newColName.trim() });
    setCollections((prev) => [col, ...prev]);
    setNewColName("");
    setShowNewColForm(false);
  }

  async function handleDeleteCollection(colId) {
    await deleteCollection(token, colId);
    setCollections((prev) => prev.filter((c) => c.id !== colId));
  }

  async function handleUpdateCollection(colId, patch) {
    try {
      const updated = await updateCollection(token, colId, patch);
      setCollections((prev) => prev.map((c) => (c.id === colId ? updated : c)));
      return true;
    } catch {
      return false;
    }
  }

  function handleExternalAdded(savedItem) {
    setSavedItems((prev) => [savedItem, ...prev]);
  }

  return (
    <motion.div
      className="pd-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        className="pd-drawer"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
      >
        {/* Header */}
        <div className="pd-header">
          <span className="pd-header__title">Your profile</span>
          <button className="pd-close-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Tabs */}
        <div className="pd-tabs">
          <button
            className={`pd-tab ${tab === "saved" ? "pd-tab--active" : ""}`}
            onClick={() => setTab("saved")}
          >
            Saved {savedItems.length > 0 && <span className="pd-tab-count">{savedItems.length}</span>}
          </button>
          <button
            className={`pd-tab ${tab === "collections" ? "pd-tab--active" : ""}`}
            onClick={() => setTab("collections")}
          >
            Collections {collections.length > 0 && <span className="pd-tab-count">{collections.length}</span>}
          </button>
        </div>

        {/* Body */}
        <div className="pd-body">
          {tab === "saved" && (
            <>
              <AddExternalForm token={token} collections={collections} onAdded={handleExternalAdded} />
              <div className="pd-divider" />
              {savedItems.length === 0 && (
                <p className="pd-empty">Nothing saved yet. Hit the bookmark icon on any content to save it.</p>
              )}
              {savedItems.map((item) => (
                <SavedCard
                  key={item.id}
                  item={item}
                  token={token}
                  collections={collections.length > 0 ? collections : []}
                  onUnsave={handleUnsave}
                  onAddToCollection={handleAddToCollection}
                  onRemoveFromCollection={handleRemoveFromCollection}
                />
              ))}
              {savedItems.length > 0 && collections.length === 0 && (
                <p className="pd-hint">
                  Switch to Collections to group your saved items.
                </p>
              )}
            </>
          )}

          {tab === "collections" && (
            <>
              <div className="pd-collections-top">
                {showNewColForm ? (
                  <div className="pd-new-col-form">
                    <input
                      className="pd-input"
                      autoFocus
                      value={newColName}
                      onChange={(e) => setNewColName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleCreateCollection(); if (e.key === "Escape") setShowNewColForm(false); }}
                      placeholder="Collection name"
                    />
                    <div className="pd-new-col-form__actions">
                      <button className="pd-btn pd-btn--primary pd-btn--sm" onClick={handleCreateCollection}>Create</button>
                      <button className="pd-btn pd-btn--ghost pd-btn--sm" onClick={() => setShowNewColForm(false)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button className="pd-btn pd-btn--primary pd-btn--sm" onClick={() => setShowNewColForm(true)}>
                    + New collection
                  </button>
                )}
              </div>
              {loadingCollections && <p className="pd-col-loading">Loading…</p>}
              {!loadingCollections && collections.length === 0 && (
                <p className="pd-empty">No collections yet. Create one to organise your saved content.</p>
              )}
              {collections.map((col) => (
                <CollectionCard
                  key={col.id}
                  col={col}
                  token={token}
                  onDelete={handleDeleteCollection}
                  onUpdate={handleUpdateCollection}
                />
              ))}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
