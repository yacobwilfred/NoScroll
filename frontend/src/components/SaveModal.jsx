import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { listCollections } from "../api";
import ContentTypeTag from "./ContentTypeTag";
import CollectionCombobox from "./CollectionCombobox";

/**
 * Modal that appears when the user clicks the save/bookmark button.
 *
 * Props:
 *   node         – ContentNode being saved
 *   token        – user token
 *   onConfirm({ caption, selectedIds, pendingNames }) – called when user hits Save
 *     selectedIds:   Set<string>  – existing collection ids to add to
 *     pendingNames:  string[]     – new collection names to create then add to
 *   onClose      – dismiss without saving
 */
export default function SaveModal({ node, token, onConfirm, onClose }) {
  const [collections, setCollections] = useState([]);
  const [loadingCols, setLoadingCols] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  // Names of collections the user wants to create (not yet in DB)
  const [pendingNames, setPendingNames] = useState([]);
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listCollections(token)
      .then(setCollections)
      .catch(() => setCollections([]))
      .finally(() => setLoadingCols(false));
  }, [token]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e) { if (e.key === "Escape" && !saving) onClose(); }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, saving]);

  function handleToggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleCreateAndSelect(name) {
    // Add to pending (will be created on save)
    if (!pendingNames.includes(name)) {
      setPendingNames((prev) => [...prev, name]);
    }
  }

  function handleRemovePending(name) {
    setPendingNames((prev) => prev.filter((n) => n !== name));
  }

  const totalSelected = selectedIds.size + pendingNames.length;
  const canSave = !saving && totalSelected > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    await onConfirm({
      caption: caption.trim() || null,
      selectedIds,
      pendingNames,
    });
  }

  // Combine real collections + pending names into the combobox's "selectedIds"
  // Pending names appear as chips handled separately (they don't have ids yet)
  return (
    <motion.div
      className="sm-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <motion.div
        className="sm-card"
        initial={{ scale: 0.92, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 16 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
      >
        {/* Header */}
        <div className="sm-header">
          <span className="sm-header__title">Save content</span>
          <button className="pd-close-btn" onClick={onClose} disabled={saving} aria-label="Close">✕</button>
        </div>

        {/* Content preview */}
        <div className="sm-preview">
          <ContentTypeTag type={node.content_type} />
          <p className="sm-preview__title">{node.title}</p>
          {node.source && <p className="sm-preview__source">{node.source}</p>}
        </div>

        <div className="sm-body">
          {/* Caption */}
          <div className="sm-field">
            <label className="sm-label">Caption <span className="sm-optional">(optional)</span></label>
            <textarea
              className="pd-input pd-input--textarea sm-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Why are you saving this? Add a note…"
              rows={2}
            />
          </div>

          {/* Collection combobox */}
          <div className="sm-field">
            <label className="sm-label">
              Collections <span className="sm-required">*</span>
            </label>

            {/* Pending (to-be-created) collection chips */}
            {pendingNames.length > 0 && (
              <div className="ccb-chips">
                {pendingNames.map((name) => (
                  <span key={name} className="ccb-chip ccb-chip--new">
                    {name}
                    <button
                      className="ccb-chip__remove"
                      type="button"
                      onClick={() => handleRemovePending(name)}
                      aria-label={`Remove ${name}`}
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
              loading={loadingCols}
            />

            {totalSelected === 0 && !loadingCols && (
              <p className="sm-hint">Pick at least one collection to save to.</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sm-footer">
          <button
            className="pd-btn pd-btn--ghost pd-btn--sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            className="pd-btn pd-btn--primary pd-btn--sm"
            disabled={!canSave}
            onClick={handleSave}
          >
            {saving ? "Saving…" : `Save${totalSelected > 0 ? ` to ${totalSelected}` : ""}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
