import { useState, useRef, useEffect } from "react";

/**
 * Multi-select searchable combobox for collections.
 *
 * Props:
 *   collections       – array of { id, name, item_count }
 *   selectedIds       – Set<string> of currently selected collection ids
 *   onToggle(id)      – toggle an existing collection in/out of selection
 *   onCreateAndSelect(name) – create a new collection with this name and select it
 *   loading           – bool, show loading state
 */
export default function CollectionCombobox({
  collections,
  selectedIds,
  onToggle,
  onCreateAndSelect,
  loading = false,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const trimmed = query.trim();
  const filtered = collections.filter((c) =>
    c.name.toLowerCase().includes(trimmed.toLowerCase())
  );
  const exactMatch = collections.some(
    (c) => c.name.toLowerCase() === trimmed.toLowerCase()
  );
  const showCreate = trimmed.length > 0 && !exactMatch;

  const selectedCols = collections.filter((c) => selectedIds.has(c.id));

  function handleInputKeyDown(e) {
    if (e.key === "Escape") { setOpen(false); setQuery(""); }
    if (e.key === "Enter" && showCreate) {
      e.preventDefault();
      onCreateAndSelect(trimmed);
      setQuery("");
      setOpen(false);
    }
  }

  function handleRemoveChip(id) {
    onToggle(id);
  }

  function handleOptionClick(col) {
    onToggle(col.id);
    // Keep dropdown open for multi-select; just clear query
    setQuery("");
    inputRef.current?.focus();
  }

  function handleCreateClick() {
    onCreateAndSelect(trimmed);
    setQuery("");
    inputRef.current?.focus();
  }

  return (
    <div className="ccb-root" ref={containerRef}>
      {/* Selected chips */}
      {selectedCols.length > 0 && (
        <div className="ccb-chips">
          {selectedCols.map((col) => (
            <span key={col.id} className="ccb-chip">
              {col.name}
              <button
                className="ccb-chip__remove"
                type="button"
                onClick={() => handleRemoveChip(col.id)}
                aria-label={`Remove ${col.name}`}
              >✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="ccb-input-wrap" onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        <input
          ref={inputRef}
          className="pd-input ccb-input"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleInputKeyDown}
          placeholder={selectedCols.length > 0 ? "Add another…" : "Search or create a collection…"}
          autoComplete="off"
        />
        <span className="ccb-arrow">{open ? "▲" : "▼"}</span>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="ccb-dropdown">
          {loading && <p className="ccb-dropdown__empty">Loading…</p>}

          {!loading && filtered.length === 0 && !showCreate && (
            <p className="ccb-dropdown__empty">No collections yet.</p>
          )}

          {!loading && filtered.map((col) => {
            const isSelected = selectedIds.has(col.id);
            return (
              <button
                key={col.id}
                className={`ccb-option ${isSelected ? "ccb-option--selected" : ""}`}
                type="button"
                onPointerDown={(e) => e.preventDefault()} // prevent input blur
                onClick={() => handleOptionClick(col)}
              >
                <span className={`ccb-option__check ${isSelected ? "ccb-option__check--on" : ""}`}>
                  {isSelected ? "✓" : ""}
                </span>
                <span className="ccb-option__name">{col.name}</span>
                <span className="ccb-option__count">{col.item_count} items</span>
              </button>
            );
          })}

          {showCreate && (
            <button
              className="ccb-option ccb-option--create"
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={handleCreateClick}
            >
              <span className="ccb-option__plus">+</span>
              <span className="ccb-option__name">Create "{trimmed}"</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
