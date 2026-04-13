/**
 * Friends' Picks — a 3D sphere of recommendation cards.
 *
 * Cards are distributed evenly using the Fibonacci / golden-angle method,
 * which gives the most uniform coverage of a sphere surface.
 *
 * OrbitControls handles all rotation (drag any direction), zoom (scroll/pinch),
 * and inertia. Cards face the camera at all times (billboard via Html transform).
 *
 * Clicking "Explore →" on a card fires onExplore(item), which the parent
 * converts into a graph session.
 */

import { useEffect, useState, useRef, Suspense } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { motion, AnimatePresence } from "framer-motion";
import { getUserToken } from "../utils/userToken";
import { getFriendsFeed, getMyIdentity, startSessionFromExternal } from "../api";
import ContentTypeTag from "../components/ContentTypeTag";

const MAX_ITEMS = 15;
const SPHERE_RADIUS = 3.8;

// ── Fibonacci sphere distribution ─────────────────────────────────────────────

function fibonacciSphere(n, radius) {
  const points = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~2.399 radians
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;          // -1 to 1
    const r = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    points.push([
      Math.cos(theta) * r * radius,
      y * radius,
      Math.sin(theta) * r * radius,
    ]);
  }
  return points;
}

// ── Single card in 3D space ────────────────────────────────────────────────────

function SphereCard({ item, position, onExplore, busy }) {
  const [hovered, setHovered] = useState(false);
  const hasBg = Boolean(item.thumbnail);

  function navTo(path, e) {
    e.stopPropagation();
    e.preventDefault();
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <group position={position}>
      <Html
        center
        distanceFactor={10}
        occlude={false}
        zIndexRange={[0, 100]}
        style={{ pointerEvents: "auto" }}
      >
        <div
          className={`fp3-card ${hasBg ? "fp3-card--has-bg" : ""} ${hovered ? "fp3-card--hovered" : ""}`}
          style={hasBg ? { "--card-bg": `url(${item.thumbnail})` } : {}}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {hasBg && <div className="fp3-card__bg" />}
          <header className="fp3-card__picker">
            <span className="fp3-card__picker-icon" aria-hidden>✦</span>
            <div className="fp3-card__picker-inner">
              <p className="fp3-card__picker-line">
                <span className="fp3-card__picker-label">Picked by</span>{" "}
                <button
                  type="button"
                  className="fp3-card__picker-name"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => navTo(`/u/${item.recommended_by_handle}`, e)}
                >
                  {item.recommended_by_name}
                </button>
              </p>
              {item.collection_id && item.collection_name && (
                <p className="fp3-card__picker-col">
                  <span className="fp3-card__picker-col-label">In</span>{" "}
                  <button
                    type="button"
                    className="fp3-card__picker-col-link"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => navTo(`/c/${item.collection_id}`, e)}
                  >
                    {item.collection_name}
                  </button>
                </p>
              )}
            </div>
          </header>
          <div className="fp3-card__body">
            <div className="fp3-card__top">
              <ContentTypeTag type={item.content_type} />
              {item.source && <span className="fp3-card__source">{item.source}</span>}
            </div>
            <p className="fp3-card__title">{item.title}</p>
            {item.note && <p className="fp3-card__note">"{item.note}"</p>}
            <button
              className="fp3-card__explore"
              disabled={busy}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onExplore(item); }}
            >
              {busy ? "Loading…" : "Explore →"}
            </button>
          </div>
        </div>
      </Html>
    </group>
  );
}

// ── Camera setup ───────────────────────────────────────────────────────────────

function CameraRig() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 0, 8);
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

// ── The 3D scene ───────────────────────────────────────────────────────────────

function SphereScene({ items, onExplore, busyUrl }) {
  const positions = fibonacciSphere(items.length, SPHERE_RADIUS);

  return (
    <>
      <CameraRig />
      <ambientLight intensity={0.6} />
      <pointLight position={[10, 10, 10]} intensity={0.4} />

      <OrbitControls
        enablePan={false}
        enableDamping
        dampingFactor={0.07}
        rotateSpeed={0.55}
        zoomSpeed={0.7}
        minDistance={4}
        maxDistance={14}
        makeDefault
      />

      {items.map((item, i) => (
        <SphereCard
          key={item.saved_item_id}
          item={item}
          position={positions[i]}
          onExplore={onExplore}
          busy={busyUrl === item.url}
        />
      ))}
    </>
  );
}

// ── Empty / loading states ─────────────────────────────────────────────────────

function Overlay({ children }) {
  return (
    <div className="fp3-overlay">
      {children}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function FriendsPicksPage({ onExploreContent }) {
  const token = getUserToken();
  const [identity, setIdentity] = useState(undefined);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyUrl, setBusyUrl] = useState(null);
  const [errMsg, setErrMsg] = useState(null);

  useEffect(() => {
    getMyIdentity(token)
      .then(setIdentity)
      .catch(() => setIdentity(null));
  }, [token]);

  useEffect(() => {
    if (identity === undefined) return;
    if (!identity) { setLoading(false); return; }
    getFriendsFeed(token)
      .then((data) => setItems(data.slice(0, MAX_ITEMS)))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [identity, token]);

  async function handleExplore(item) {
    setBusyUrl(item.url);
    setErrMsg(null);
    try {
      const sessionData = await startSessionFromExternal({
        url: item.url,
        title: item.title,
        content_type: item.content_type,
        summary: item.summary || null,
        source: item.source || null,
        thumbnail: item.thumbnail || null,
      });
      onExploreContent(sessionData);
    } catch {
      setErrMsg("Could not load this content. Try another.");
    } finally {
      setBusyUrl(null);
    }
  }

  // ── States ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fp3-page">
        <Overlay><p className="fp3-status">Loading picks…</p></Overlay>
      </div>
    );
  }

  if (!identity) {
    return (
      <div className="fp3-page">
        <Overlay>
          <p className="fp3-status">Set up your profile first to see friends' picks.</p>
        </Overlay>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="fp3-page">
        <Overlay>
          <p className="fp3-status">Nothing here yet.</p>
          <p className="fp3-status-sub">
            Add friends and ask them to save content to their public collections.
          </p>
        </Overlay>
      </div>
    );
  }

  return (
    <div className="fp3-page">
      {/* Hint */}
      <div className="fp3-hint">Drag to rotate · Scroll to zoom</div>

      {/* Error toast */}
      <AnimatePresence>
        {errMsg && (
          <motion.div
            className="fp3-err"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {errMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3D Canvas */}
      <Canvas
        className="fp3-canvas"
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <SphereScene items={items} onExplore={handleExplore} busyUrl={busyUrl} />
        </Suspense>
      </Canvas>
    </div>
  );
}
