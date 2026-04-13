/**
 * Public profile page: /u/:handle
 * Shows the user's display name, bio, public collections, and an Add Friend button.
 */
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getUserToken } from "../utils/userToken";
import {
  getIdentityByHandle,
  getPublicUserCollections,
  getPublicCollectionItems,
  getFriendshipStatus,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  unfriend,
  startSessionFromExternal,
  getMyIdentity,
} from "../api";
import ContentTypeTag from "../components/ContentTypeTag";

function tokenColor(token) {
  let hash = 0;
  for (let i = 0; i < token.length; i++) hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 60%, 45%)`;
}

function AvatarCircle({ handle, displayName }) {
  const color = tokenColor(handle);
  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <div className="up-avatar" style={{ background: color }}>
      {initials}
    </div>
  );
}

// ── Friend button state machine ────────────────────────────────────────────────

function FriendButton({ myToken, handle }) {
  const [status, setStatus] = useState(null); // null | "none" | "pending" | "accepted" | "self" | "not_found"
  const [fsId, setFsId] = useState(null);
  const [direction, setDirection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!myToken || !handle) return;
    getFriendshipStatus(myToken, handle).then((s) => {
      setStatus(s.status);
      setFsId(s.friendship_id ?? null);
      setDirection(s.direction ?? null);
    });
  }, [myToken, handle]);

  async function act(action) {
    setBusy(true);
    setMsg(null);
    try {
      if (action === "request") {
        const res = await sendFriendRequest(myToken, handle);
        if (res.status === "accepted") {
          setStatus("accepted");
          setMsg("You're now friends!");
        } else {
          setFsId(res.friendship_id);
          setStatus("pending");
          setDirection("sent");
          setMsg("Friend request sent!");
        }
      } else if (action === "accept") {
        await acceptFriendRequest(myToken, fsId);
        setStatus("accepted");
      } else if (action === "decline") {
        await declineFriendRequest(myToken, fsId);
        setStatus("none");
        setFsId(null);
      } else if (action === "unfriend") {
        await unfriend(myToken, fsId);
        setStatus("none");
        setFsId(null);
      }
    } catch (err) {
      try { setMsg(JSON.parse(err.message)?.detail ?? err.message); }
      catch { setMsg(err.message); }
    } finally {
      setBusy(false);
    }
  }

  if (status === null || status === "self" || status === "not_found") return null;

  return (
    <div className="up-friend-btn-wrap">
      {status === "none" && (
        <button className="pn-card__btn pn-card__btn--primary" onClick={() => act("request")} disabled={busy}>
          {busy ? "…" : "+ Add friend"}
        </button>
      )}
      {status === "pending" && direction === "sent" && (
        <button className="pn-card__btn pn-card__btn--ghost" disabled>Request sent</button>
      )}
      {status === "pending" && direction === "received" && (
        <>
          <button className="pn-card__btn pn-card__btn--primary" onClick={() => act("accept")} disabled={busy}>
            Accept
          </button>
          <button className="pn-card__btn pn-card__btn--ghost" onClick={() => act("decline")} disabled={busy}>
            Decline
          </button>
        </>
      )}
      {status === "accepted" && (
        <button className="pn-card__btn pn-card__btn--ghost" onClick={() => act("unfriend")} disabled={busy}>
          Friends ✓
        </button>
      )}
      {msg && <p className="fp-msg fp-msg--ok">{msg}</p>}
    </div>
  );
}

// ── Collection section ─────────────────────────────────────────────────────────

function CollectionSection({ col, onExplore }) {
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(false);

  function toggle() {
    if (!open && items === null) {
      getPublicCollectionItems(col.id)
        .then(setItems)
        .catch(() => setItems([]));
    }
    setOpen((o) => !o);
  }

  return (
    <div className="up-col">
      <button className="up-col-header" onClick={toggle}>
        <span className="up-col-name">{col.name}</span>
        <span className="up-col-meta">
          {col.item_count} items
          <span className="up-col-chevron">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="up-col-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
          >
            {items === null && <p className="pn-panel__empty">Loading…</p>}
            {items !== null && items.length === 0 && (
              <p className="pn-panel__empty">Nothing in this collection yet.</p>
            )}
            {items !== null && items.length > 0 && (
              <div className="up-cards">
                {items.map((item) => (
                  <UpContentCard key={item.id} item={item} onExplore={onExplore} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UpContentCard({ item, onExplore }) {
  const hasBg = Boolean(item.thumbnail);
  return (
    <div
      className={`pn-card up-card ${hasBg ? "pn-card--has-bg" : ""}`}
      style={hasBg ? { "--card-bg": `url(${item.thumbnail})` } : {}}
    >
      {hasBg && <div className="pn-card__bg" />}
      <div className="pn-card__content">
        <ContentTypeTag type={item.content_type} />
        <p className="pn-card__title">{item.title}</p>
        {item.source && <p className="pn-card__source">{item.source}</p>}
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

// ── Main ───────────────────────────────────────────────────────────────────────

export default function UserProfilePage({ handle, onExploreContent }) {
  const myToken = getUserToken();
  const [profile, setProfile] = useState(null);
  const [collections, setCollections] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [myIdentity, setMyIdentity] = useState(null);

  useEffect(() => {
    getMyIdentity(myToken).then(setMyIdentity).catch(() => {});
    getIdentityByHandle(handle).then((p) => {
      if (!p) { setNotFound(true); return; }
      setProfile(p);
      getPublicUserCollections(handle).then(setCollections).catch(() => {});
    }).catch(() => setNotFound(true));
  }, [handle, myToken]);

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

  const isOwnProfile = myIdentity?.handle === handle;

  if (notFound) {
    return (
      <div className="up-page">
        <div className="up-not-found">
          <p className="up-not-found-title">User not found</p>
          <p className="up-not-found-sub">@{handle} doesn't exist.</p>
          <button
            className="pn-card__btn pn-card__btn--ghost"
            onClick={() => { window.history.back(); }}
          >← Go back</button>
        </div>
      </div>
    );
  }

  if (!profile) {
    return <div className="up-page up-page--loading"><p>Loading…</p></div>;
  }

  return (
    <div className="up-page">
      <button
        className="pn-back up-back"
        onClick={() => window.history.back()}
      >← Back</button>

      <motion.div
        className="up-container"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <div className="up-header">
          <AvatarCircle handle={handle} displayName={profile.display_name} />
          <div className="up-header-info">
            <h1 className="up-display-name">{profile.display_name}</h1>
            <p className="up-handle">@{handle}</p>
            {profile.bio && <p className="up-bio">{profile.bio}</p>}
          </div>

          {isOwnProfile ? (
            <button
              className="pn-card__btn pn-card__btn--ghost up-edit-btn"
              onClick={() => {
                window.history.pushState({}, "", "/profile");
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
            >Edit profile</button>
          ) : (
            <FriendButton myToken={myToken} handle={handle} />
          )}
        </div>

        {/* Collections */}
        <section className="up-collections">
          <h2 className="up-section-title">Collections</h2>
          {collections.length === 0 ? (
            <p className="pn-empty">No public collections yet.</p>
          ) : (
            collections.map((col) => (
              <CollectionSection key={col.id} col={col} onExplore={handleExplore} />
            ))
          )}
        </section>
      </motion.div>
    </div>
  );
}
