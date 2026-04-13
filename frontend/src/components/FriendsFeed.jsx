/**
 * Horizontal scrollable feed of recent saves from accepted friends.
 * Each card shows the recommender name + their caption/note.
 * Appears on the prompt screen below the topic suggestions.
 */
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getUserToken } from "../utils/userToken";
import { getFriendsFeed, getMyIdentity, startSessionFromExternal } from "../api";
import ContentTypeTag from "./ContentTypeTag";

function FeedCard({ item, onExplore }) {
  const hasBg = Boolean(item.thumbnail);

  return (
    <motion.div
      className={`ff-card ${hasBg ? "ff-card--has-bg" : ""}`}
      style={hasBg ? { "--card-bg": `url(${item.thumbnail})` } : {}}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
    >
      {hasBg && <div className="ff-card__bg" />}
      <div className="ff-card__body">
        <div className="ff-card__top">
          <ContentTypeTag type={item.content_type} />
          {item.source && <span className="ff-card__source">{item.source}</span>}
        </div>
        <p className="ff-card__title">{item.title}</p>
        <p className="ff-card__rec">
          Recommended by{" "}
          <a
            className="ff-card__rec-link"
            href={`/u/${item.recommended_by_handle}`}
            onClick={(e) => {
              e.preventDefault();
              window.history.pushState({}, "", `/u/${item.recommended_by_handle}`);
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
          >
            {item.recommended_by_name}
          </a>
        </p>
        {item.note && <p className="ff-card__note">"{item.note}"</p>}
        <button
          className="ff-card__explore"
          onClick={() => onExplore(item)}
        >
          Explore →
        </button>
      </div>
    </motion.div>
  );
}

export default function FriendsFeed({ onExplore: onSessionData }) {
  const token = getUserToken();
  const [identity, setIdentity] = useState(undefined); // undefined = loading
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    getMyIdentity(token)
      .then(setIdentity)
      .catch(() => setIdentity(null));
  }, [token]);

  useEffect(() => {
    if (identity === undefined) return; // still loading identity
    if (!identity) { setLoading(false); return; } // not set up yet
    getFriendsFeed(token)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [identity, token]);

  // Don't render at all if no identity or no items
  if (identity === undefined || loading) return null;
  if (!identity || items.length === 0) return null;

  function scrollLeft() {
    scrollRef.current?.scrollBy({ left: -280, behavior: "smooth" });
  }
  function scrollRight() {
    scrollRef.current?.scrollBy({ left: 280, behavior: "smooth" });
  }

  return (
    <AnimatePresence>
      <motion.section
        className="ff-root"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
      >
        <div className="ff-header">
          <h3 className="ff-title">From your friends</h3>
          <div className="ff-nav">
            <button className="ff-nav-btn" onClick={scrollLeft} aria-label="Scroll left">‹</button>
            <button className="ff-nav-btn" onClick={scrollRight} aria-label="Scroll right">›</button>
          </div>
        </div>

        <div className="ff-scroll" ref={scrollRef}>
          {items.map((item, i) => (
            <FeedCard
              key={`${item.saved_item_id}-${i}`}
              item={item}
              onExplore={async (feedItem) => {
                try {
                  const sessionData = await startSessionFromExternal({
                    url: feedItem.url,
                    title: feedItem.title,
                    content_type: feedItem.content_type,
                    summary: feedItem.summary || null,
                    source: feedItem.source || null,
                    thumbnail: feedItem.thumbnail || null,
                  });
                  onSessionData(sessionData);
                } catch {
                  window.open(feedItem.url, "_blank");
                }
              }}
            />
          ))}
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
