import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getUserToken } from "../utils/userToken";
import {
  listCollections,
  listCollectionItems,
  getProfileStats,
  startSessionFromExternal,
  getMyIdentity,
  setupIdentity,
  listFriends,
  listFriendRequests,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  unfriend,
} from "../api";
import ContentTypeTag from "../components/ContentTypeTag";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tokenColor(token) {
  let hash = 0;
  for (let i = 0; i < token.length; i++) hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 60%, 45%)`;
}

// ── Identity setup panel ──────────────────────────────────────────────────────

function IdentityPanel({ token, identity, onSave, onClose }) {
  const [handle, setHandle] = useState(identity?.handle ?? "");
  const [name, setName] = useState(identity?.display_name ?? "");
  const [bio, setBio] = useState(identity?.bio ?? "");
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const result = await setupIdentity(token, {
        handle: handle.trim(),
        display_name: name.trim(),
        bio: bio.trim() || null,
      });
      onSave(result);
    } catch (e) {
      try { setErr(JSON.parse(e.message)?.detail ?? e.message); }
      catch { setErr(e.message); }
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="ip-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget && identity) onClose(); }}
    >
      <motion.div
        className="ip-panel"
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
      >
        <div className="ip-header">
          <h2>{identity ? "Edit profile" : "Set up your profile"}</h2>
          {identity && (
            <button className="pd-close-btn" onClick={onClose}>✕</button>
          )}
        </div>

        {!identity && (
          <p className="ip-intro">
            Choose a handle so friends can find you. You can change this later.
          </p>
        )}

        <form onSubmit={handleSubmit} className="ip-form">
          <label className="ip-label">
            Handle
            <div className="ip-handle-wrap">
              <span className="ip-at">@</span>
              <input
                className="pd-input ip-handle-input"
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/\s/g, ""))}
                placeholder="yourhandle"
                required
                minLength={2}
                maxLength={30}
              />
            </div>
          </label>

          <label className="ip-label">
            Display name
            <input
              className="pd-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
              maxLength={60}
            />
          </label>

          <label className="ip-label">
            Bio <span className="ip-optional">(optional)</span>
            <textarea
              className="pd-input ip-bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="A sentence about yourself…"
              rows={2}
            />
          </label>

          {err && <p className="ip-error">{err}</p>}

          <button className="pn-card__btn pn-card__btn--primary ip-submit" disabled={saving}>
            {saving ? "Saving…" : identity ? "Save changes" : "Create profile"}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function AvatarNode({ token, stats, identity, onClick }) {
  const color = tokenColor(token);
  return (
    <motion.div
      className="pn-avatar-node"
      onClick={onClick}
      style={{ "--avatar-color": color }}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
    >
      <div className="pn-avatar-icon" style={{ background: color }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      </div>
      <div className="pn-avatar-info">
        {identity ? (
          <>
            <span className="pn-avatar-name">{identity.display_name}</span>
            <span className="pn-avatar-handle">@{identity.handle}</span>
          </>
        ) : (
          <>
            <span className="pn-avatar-name">Anonymous</span>
            <span className="pn-avatar-handle pn-avatar-handle--cta">Tap to set up profile</span>
          </>
        )}
        {stats && (
          <span className="pn-avatar-stats">
            {stats.saved_count} saved · {stats.collection_count} collections
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ── Collection node ───────────────────────────────────────────────────────────

function CollectionNode({ col, position, onClick, isActive, refCallback }) {
  return (
    <motion.div
      ref={refCallback}
      className={`pn-col-node pn-col-node--${position} ${isActive ? "pn-col-node--active" : ""}`}
      onClick={() => onClick(col)}
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
      layout
    >
      <div className="pn-col-node__name">{col.name}</div>
      <div className="pn-col-node__meta">
        {col.item_count} items
        {!col.is_public && <span className="pn-col-node__lock"> · private</span>}
      </div>
    </motion.div>
  );
}

// ── SVG connecting lines ──────────────────────────────────────────────────────

function ConnectorLines({ avatarRef, nodeRefs, containerRef, tick }) {
  const [lines, setLines] = useState([]);

  const compute = useCallback(() => {
    const container = containerRef.current;
    const avatar = avatarRef.current;
    if (!container || !avatar) return;
    const cRect = container.getBoundingClientRect();
    const aRect = avatar.getBoundingClientRect();
    const ax = aRect.right - cRect.left;
    const ay = aRect.top + aRect.height / 2 - cRect.top;

    const newLines = nodeRefs.current
      .map((el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x1: ax, y1: ay,
          x2: r.left - cRect.left,
          y2: r.top + r.height / 2 - cRect.top,
        };
      })
      .filter(Boolean);
    setLines(newLines);
  }, [avatarRef, nodeRefs, containerRef]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { setTimeout(compute, 80); });
    const ro = new ResizeObserver(compute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, [compute, tick]);

  return (
    <svg className="pn-svg" aria-hidden="true">
      {lines.map((line, i) => {
        const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
        return (
          <motion.line
            key={`${i}-${line.x2.toFixed(0)}-${line.y2.toFixed(0)}`}
            x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
            stroke="rgba(100,130,255,0.4)"
            strokeWidth="1.5"
            strokeDasharray={len}
            initial={{ strokeDashoffset: len, opacity: 0 }}
            animate={{ strokeDashoffset: 0, opacity: 1 }}
            transition={{ duration: 0.45, delay: 0.05 + i * 0.06 }}
          />
        );
      })}
    </svg>
  );
}

// ── Collection panel (expanded) ───────────────────────────────────────────────

function CollectionPanel({ col, token, onExplore, onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listCollectionItems(token, col.id)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [token, col.id]);

  return (
    <motion.div
      className="pn-panel"
      initial={{ opacity: 0, scale: 0.94, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: 12 }}
      transition={{ type: "spring", stiffness: 340, damping: 30 }}
    >
      <div className="pn-panel__header">
        <div>
          <h2 className="pn-panel__title">{col.name}</h2>
          {col.description && <p className="pn-panel__desc">{col.description}</p>}
        </div>
        <button className="pd-close-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="pn-panel__body">
        {loading && <p className="pn-panel__empty">Loading…</p>}
        {!loading && items.length === 0 && (
          <p className="pn-panel__empty">No items in this collection yet.</p>
        )}
        {!loading && items.length > 0 && (
          <div className="pn-cards-grid">
            {items.map((item) => (
              <ContentCard key={item.id} item={item} onExplore={onExplore} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Content card ──────────────────────────────────────────────────────────────

function ContentCard({ item, onExplore, recommendedBy }) {
  const hasBg = Boolean(item.thumbnail);
  return (
    <div
      className={`pn-card ${hasBg ? "pn-card--has-bg" : ""}`}
      style={hasBg ? { "--card-bg": `url(${item.thumbnail})` } : {}}
    >
      {hasBg && <div className="pn-card__bg" />}
      <div className="pn-card__content">
        <ContentTypeTag type={item.content_type} />
        <p className="pn-card__title">{item.title}</p>
        {item.source && <p className="pn-card__source">{item.source}</p>}
        {recommendedBy && (
          <p className="pn-card__rec-by">Recommended by <strong>{recommendedBy}</strong></p>
        )}
        {item.caption && <p className="pn-card__caption">"{item.caption}"</p>}
        <div className="pn-card__actions">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="pn-card__btn pn-card__btn--ghost"
          >Open ↗</a>
          <button className="pn-card__btn pn-card__btn--primary" onClick={() => onExplore(item)}>
            Explore →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Scroll indicator ──────────────────────────────────────────────────────────

function ScrollDots({ total, visible, offset }) {
  if (total <= visible) return null;
  return (
    <div className="pn-scroll-dots">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`pn-scroll-dot ${i >= offset && i < offset + visible ? "pn-scroll-dot--active" : ""}`}
        />
      ))}
    </div>
  );
}

// ── Friends panel ─────────────────────────────────────────────────────────────

function FriendsPanel({ token, friends, requests, onAccept, onDecline, onUnfriend, nodeRefs }) {
  const [addHandle, setAddHandle] = useState("");
  const [addMsg, setAddMsg] = useState(null);
  const [addErr, setAddErr] = useState(null);
  const [adding, setAdding] = useState(false);

  async function handleAdd(e) {
    e.preventDefault();
    const h = addHandle.trim().replace(/^@/, "");
    if (!h) return;
    setAdding(true);
    setAddMsg(null);
    setAddErr(null);
    try {
      const res = await sendFriendRequest(token, h);
      setAddMsg(res.status === "accepted" ? res.message : "Friend request sent!");
      setAddHandle("");
    } catch (err) {
      try { setAddErr(JSON.parse(err.message)?.detail ?? err.message); }
      catch { setAddErr(err.message); }
    } finally {
      setAdding(false);
    }
  }

  const allNodes = [...requests, ...friends];

  return (
    <div className="fp-root">
      {/* Add friend */}
      <div className="fp-section">
        <h3 className="fp-section-title">Add a friend</h3>
        <form className="fp-add-form" onSubmit={handleAdd}>
          <span className="ip-at">@</span>
          <input
            className="pd-input fp-add-input"
            value={addHandle}
            onChange={(e) => setAddHandle(e.target.value)}
            placeholder="theirhandle"
            maxLength={30}
          />
          <button
            className="pn-card__btn pn-card__btn--primary"
            type="submit"
            disabled={adding || !addHandle.trim()}
          >
            {adding ? "…" : "Add"}
          </button>
        </form>
        {addMsg && <p className="fp-msg fp-msg--ok">{addMsg}</p>}
        {addErr && <p className="fp-msg fp-msg--err">{addErr}</p>}
      </div>

      {/* Pending requests */}
      {requests.length > 0 && (
        <div className="fp-section">
          <h3 className="fp-section-title">Friend requests</h3>
          {requests.map((req, i) => (
            <div
              key={req.id}
              className="fp-friend-row fp-friend-row--request"
              ref={(el) => { if (nodeRefs) nodeRefs.current[i] = el; }}
            >
              <div className="fp-friend-info">
                <span className="fp-friend-name">{req.other_display_name}</span>
                <span className="fp-friend-handle">@{req.other_handle}</span>
              </div>
              <div className="fp-friend-actions">
                <button
                  className="pn-card__btn pn-card__btn--primary"
                  onClick={() => onAccept(req.id)}
                >Accept</button>
                <button
                  className="pn-card__btn pn-card__btn--ghost"
                  onClick={() => onDecline(req.id)}
                >Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Friends list */}
      <div className="fp-section">
        <h3 className="fp-section-title">
          Friends {friends.length > 0 && <span className="fp-count">{friends.length}</span>}
        </h3>
        {friends.length === 0 ? (
          <p className="pn-empty">No friends yet. Share your handle with people you know.</p>
        ) : (
          friends.map((f, i) => (
            <div
              key={f.id}
              className="fp-friend-row"
              ref={(el) => {
                if (nodeRefs) nodeRefs.current[requests.length + i] = el;
              }}
            >
              <div className="fp-friend-info">
                <span className="fp-friend-name">{f.other_display_name}</span>
                <a
                  href={`/u/${f.other_handle}`}
                  className="fp-friend-handle fp-friend-handle--link"
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState({}, "", `/u/${f.other_handle}`);
                    window.dispatchEvent(new PopStateEvent("popstate"));
                  }}
                >@{f.other_handle}</a>
              </div>
              <button
                className="pn-card__btn pn-card__btn--ghost fp-unfriend"
                onClick={() => onUnfriend(f.id)}
              >Unfriend</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main ProfilePage ──────────────────────────────────────────────────────────

const VISIBLE = 3;

export default function ProfilePage({ onExploreContent, onBack }) {
  const token = getUserToken();
  const [identity, setIdentity] = useState(null);
  const [showIdentityPanel, setShowIdentityPanel] = useState(false);
  const [stats, setStats] = useState(null);
  const [collections, setCollections] = useState([]);
  const [offset, setOffset] = useState(0);
  const [activeCol, setActiveCol] = useState(null);
  const [tab, setTab] = useState("collections");
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);

  const containerRef = useRef(null);
  const avatarRef = useRef(null);
  const nodeRefs = useRef([null, null, null]);

  useEffect(() => {
    getMyIdentity(token)
      .then((id) => {
        setIdentity(id);
        if (!id) setShowIdentityPanel(true);
      })
      .catch(() => {});
    getProfileStats(token).then(setStats).catch(() => {});
    listCollections(token).then(setCollections).catch(() => {});
  }, [token]);

  function refreshFriends() {
    listFriends(token).then(setFriends).catch(() => {});
    listFriendRequests(token).then(setRequests).catch(() => {});
  }

  useEffect(() => {
    if (tab === "friends") refreshFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const visible = collections.slice(offset, offset + VISIBLE);
  const canUp = offset > 0;
  const canDown = offset + VISIBLE < collections.length;

  function scrollUp() { if (canUp) setOffset((o) => o - 1); }
  function scrollDown() { if (canDown) setOffset((o) => o + 1); }
  function handleWheel(e) { if (e.deltaY > 0) scrollDown(); else scrollUp(); }
  function handleColClick(col) { setActiveCol((prev) => (prev?.id === col.id ? null : col)); }

  async function handleExplore(item) {
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
      onExploreContent(data);
    } catch {
      window.open(item.url, "_blank");
    }
  }

  async function handleAccept(fsId) {
    try { await acceptFriendRequest(token, fsId); refreshFriends(); } catch {}
  }
  async function handleDecline(fsId) {
    try { await declineFriendRequest(token, fsId); refreshFriends(); } catch {}
  }
  async function handleUnfriend(fsId) {
    try { await unfriend(token, fsId); refreshFriends(); } catch {}
  }

  const positions = ["top", "mid", "bottom"];
  const requestBadge = requests.length > 0 ? requests.length : null;

  return (
    <div className="pn-page" ref={containerRef} onWheel={tab === "collections" ? handleWheel : undefined}>
      {/* SVG lines (only for collections) */}
      {tab === "collections" && (
        <ConnectorLines
          avatarRef={avatarRef}
          nodeRefs={nodeRefs}
          containerRef={containerRef}
          tick={offset}
        />
      )}

      {/* Left: Avatar */}
      <div className="pn-left" ref={avatarRef}>
        <AvatarNode
          token={token}
          stats={stats}
          identity={identity}
          onClick={() => setShowIdentityPanel(true)}
        />

        {/* Share handle */}
        {identity && (
          <div className="pn-share">
            <span className="pn-share-label">Your profile link</span>
            <button
              className="pn-share-btn"
              onClick={() => {
                const url = `${window.location.origin}/u/${identity.handle}`;
                navigator.clipboard.writeText(url).catch(() => {});
              }}
            >
              /u/{identity.handle} · Copy
            </button>
          </div>
        )}
      </div>

      {/* Right: Tabs + content */}
      <div className="pn-right">
        {/* Tab bar */}
        <div className="pn-tabs">
          <button
            className={`pn-tab ${tab === "collections" ? "pn-tab--active" : ""}`}
            onClick={() => setTab("collections")}
          >Collections</button>
          <button
            className={`pn-tab ${tab === "friends" ? "pn-tab--active" : ""}`}
            onClick={() => setTab("friends")}
          >
            Friends
            {requestBadge && <span className="pn-tab-badge">{requestBadge}</span>}
          </button>
        </div>

        {/* Collections view */}
        {tab === "collections" && (
          <>
            <AnimatePresence mode="popLayout">
              {visible.map((col, i) => (
                <CollectionNode
                  key={col.id}
                  col={col}
                  position={positions[i]}
                  onClick={handleColClick}
                  isActive={activeCol?.id === col.id}
                  refCallback={(el) => { nodeRefs.current[i] = el; }}
                />
              ))}
            </AnimatePresence>

            {collections.length === 0 && (
              <motion.p className="pn-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                No collections yet. Save content and create a collection to see it here.
              </motion.p>
            )}

            {collections.length > VISIBLE && (
              <div className="pn-scroll-btns">
                <button
                  className={`pn-scroll-btn ${!canUp ? "pn-scroll-btn--disabled" : ""}`}
                  onClick={scrollUp} disabled={!canUp}
                >▲</button>
                <ScrollDots total={collections.length} visible={VISIBLE} offset={offset} />
                <button
                  className={`pn-scroll-btn ${!canDown ? "pn-scroll-btn--disabled" : ""}`}
                  onClick={scrollDown} disabled={!canDown}
                >▼</button>
              </div>
            )}
          </>
        )}

        {/* Friends view */}
        {tab === "friends" && (
          <FriendsPanel
            token={token}
            friends={friends}
            requests={requests}
            onAccept={handleAccept}
            onDecline={handleDecline}
            onUnfriend={handleUnfriend}
            nodeRefs={nodeRefs}
          />
        )}
      </div>

      {/* Expanded collection panel */}
      <AnimatePresence>
        {activeCol && (
          <CollectionPanel
            key={activeCol.id}
            col={activeCol}
            token={token}
            onExplore={handleExplore}
            onClose={() => setActiveCol(null)}
          />
        )}
      </AnimatePresence>

      {/* Identity setup / edit panel */}
      <AnimatePresence>
        {showIdentityPanel && (
          <IdentityPanel
            token={token}
            identity={identity}
            onSave={(id) => { setIdentity(id); setShowIdentityPanel(false); }}
            onClose={() => setShowIdentityPanel(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
