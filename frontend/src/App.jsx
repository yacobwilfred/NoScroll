import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import {
  startSession, expandSession, saveItem, unsaveItem, listSaved,
  createCollection, addToCollection,
} from "./api";
import { getUserToken } from "./utils/userToken";
import { computeCognitiveMeter, hoursSinceWake, computeAlertnessScore } from "./cognitive";
import PromptScreen from "./components/PromptScreen";
import TopNav from "./components/TopNav";
import ProfileNavButton from "./components/ProfileNavButton";
import SiteLogo from "./components/SiteLogo";
import NodeGraph from "./components/NodeGraph";
import ProfileDrawer from "./components/ProfileDrawer";
import SaveModal from "./components/SaveModal";
import PublicCollectionPage from "./components/PublicCollectionPage";
import ProfilePage from "./pages/ProfilePage";
import UserProfilePage from "./pages/UserProfilePage";
import FriendsPicksPage from "./pages/FriendsPicksPage";
import CognitiveMeter from "./components/CognitiveMeter";
import CognitiveSettings from "./components/CognitiveSettings";
import VideoBackground from "./components/VideoBackground";

// ── Simple path-based routing ─────────────────────────────────────────────────
function getRoute() {
  const path = window.location.pathname;
  const colMatch = path.match(/^\/c\/([^/]+)$/);
  if (colMatch) return { type: "public-collection", id: colMatch[1] };
  const userMatch = path.match(/^\/u\/([^/]+)$/);
  if (userMatch) return { type: "user-profile", handle: userMatch[1] };
  if (path === "/profile") return { type: "profile" };
  if (path === "/friends") return { type: "friends" };
  if (path === "/relax") return { type: "app", browseMode: "relax" };
  return { type: "app", browseMode: "deep" };
}

function browseModeFromPath(path = window.location.pathname) {
  return path === "/relax" ? "relax" : "deep";
}

export default function App() {
  const [route, setRoute] = useState(getRoute);

  function navigate(path) {
    window.history.pushState({}, "", path);
    setRoute(getRoute());
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  useEffect(() => {
    function onPop() { setRoute(getRoute()); }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const page = (() => {
  // Static routes (no shared app state needed)
  if (route.type === "public-collection") {
    return <PublicCollectionPage colId={route.id} />;
  }

  if (route.type === "user-profile") {
    return (
      <UserProfilePage
        handle={route.handle}
        onExploreContent={(data) => {
          sessionStorage.setItem("noscroll_pending_session", JSON.stringify(data));
          navigate("/");
        }}
      />
    );
  }

  if (route.type === "friends") {
    return (
      <div className="app">
        <TopNav
          onDeep={() => navigate("/")}
          onRelax={() => navigate("/relax")}
        />
        <FriendsPicksPage
          onExploreContent={(data) => {
            sessionStorage.setItem("noscroll_pending_session", JSON.stringify(data));
            navigate("/");
          }}
        />
      </div>
    );
  }

  if (route.type === "profile") {
    return <MainApp initialPhase="profile" navigate={navigate} />;
  }

  return (
    <MainApp
      initialPhase="prompt"
      initialBrowseMode={route.browseMode ?? "deep"}
      navigate={navigate}
    />
  );
  })();

  return (
    <>
      <VideoBackground />
      <SiteLogo onNavigate={() => navigate("/")} />
      <ProfileNavButton
        active={route.type === "profile"}
        onClick={() => navigate("/profile")}
      />
      {page}
    </>
  );
}

// ── Main app (prompt + graph + profile) ────────────────────────────────────────
function MainApp({ initialPhase = "prompt", initialBrowseMode = "deep", navigate }) {
  const [phase, setPhase] = useState(initialPhase);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [sessionId, setSessionId] = useState(null);
  const [centerNode, setCenterNode] = useState(null);
  const [directions, setDirections] = useState([]);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [explorationHistory, setExplorationHistory] = useState([]);
  const [graphInitialEnter, setGraphInitialEnter] = useState(false);
  const graphNavRef = useRef(null);
  const explorationHistoryRef = useRef(explorationHistory);
  explorationHistoryRef.current = explorationHistory;
  const [browseMode, setBrowseMode] = useState(initialBrowseMode);
  const [sessionMode, setSessionMode] = useState("deep");

  useEffect(() => {
    function syncFromPath() {
      const path = window.location.pathname;
      if (path === "/profile") {
        setPhase("profile");
        return;
      }
      setBrowseMode(browseModeFromPath());
      setPhase((prev) => (prev === "profile" ? "prompt" : prev));
    }
    syncFromPath();
    window.addEventListener("popstate", syncFromPath);
    return () => window.removeEventListener("popstate", syncFromPath);
  }, []);

  const [userToken] = useState(() => getUserToken());
  const [savedItemsMap, setSavedItemsMap] = useState(new Map());
  const [pendingSaveNode, setPendingSaveNode] = useState(null);

  // ── Cognitive Meter state ─────────────────────────────────────────────────
  // Configured via the settings panel (battery icon) during exploration.
  const [meterConfig, setMeterConfig] = useState({
    bioMode: "fitbit",                                  // 'fitbit' | 'manual'
    fitbit: null,                                       // { rmssd, restingHr, sleepScore }
    manual: { rmssd: 45, restingHr: 60, sleepScore: 75 },
    hoursSinceWaking: 3,
    lastMealHrsAgo: 3,
    caffeineHrsAgo: null,
    cameraEnabled: true,                                // on by default; banner nudges if off
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cameraPromptDismissed, setCameraPromptDismissed] = useState(false);
  const [faceData, setFaceData] = useState({ perclos: 0, blinkRate: 15, faceDetected: true });
  const [sessionStartTime, setSessionStartTime] = useState(null);
  // Hours of focus spent engaging with content this session (direct battery debit)
  const [energySpent, setEnergySpent] = useState(0);
  const lastFaceUpdateRef = useRef(0);
  const engagementRef = useRef(0.85); // smoothed (EMA) real-time engagement 0–1

  // Refs so the consumption interval can read fresh values without resubscribing
  const faceDataRef = useRef(faceData);       faceDataRef.current = faceData;
  const centerNodeRef = useRef(centerNode);   centerNodeRef.current = centerNode;
  const meterConfigRef = useRef(meterConfig); meterConfigRef.current = meterConfig;

  function updateMeterConfig(patch) {
    setMeterConfig(prev => ({ ...prev, ...patch }));
  }

  // ── Consumption loop ──────────────────────────────────────────────────────
  // Every 10s while exploring, drain the battery by k · load · engagement · dt.
  // engagement comes from eye tracking (smoothed); no face → pauses; camera off
  // → assumes a neutral 0.85. Accumulates across content, resets on New Prompt.
  useEffect(() => {
    if (phase !== "graph" || !sessionStartTime) return;
    const TICK_MS    = 5_000;
    const K          = 1.0;          // global drain-rate knob
    const ALPHA      = 0.22;         // EMA factor → ~20s smoothing at 5s tick
    const FALLBACK_LOAD = 0.3;       // used if a node has no cognitive_load

    const id = setInterval(() => {
      const cfg = meterConfigRef.current;
      const fd  = faceDataRef.current;

      let eInst;
      if (!cfg.cameraEnabled)               eInst = 0.85;             // no signal → neutral
      else if (fd.faceDetected === false)   eInst = 0;               // away → pause
      else eInst = computeAlertnessScore(fd.perclos ?? 0, fd.blinkRate ?? 15);

      engagementRef.current += ALPHA * (eInst - engagementRef.current);

      const load    = centerNodeRef.current?.cognitive_load ?? FALLBACK_LOAD;
      const dEnergy = K * load * engagementRef.current * (TICK_MS / 3_600_000);
      if (dEnergy > 0) setEnergySpent(prev => prev + dEnergy);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phase, sessionStartTime]);

  const meter = useMemo(() => {
    const bio = meterConfig.bioMode === "manual"
      ? meterConfig.manual
      : (meterConfig.fitbit ?? { rmssd: null, restingHr: null, sleepScore: null });
    // In Fitbit mode, derive wake time from the synced sleep end; fall back to
    // the manual "when did you wake up?" chip when it's missing or stale.
    const autoWake = meterConfig.bioMode === "fitbit"
      ? hoursSinceWake(meterConfig.fitbit?.wakeTime)
      : null;
    return computeCognitiveMeter({
      rmssd:            bio.rmssd,
      restingHr:        bio.restingHr,
      sleepScore:       bio.sleepScore,
      hoursSinceWaking: autoWake ?? meterConfig.hoursSinceWaking,
      lastMealHrsAgo:   meterConfig.lastMealHrsAgo,
      caffeineHrsAgo:   meterConfig.caffeineHrsAgo,
      perclos:          faceData.perclos,
      blinkRate:        faceData.blinkRate,
      cameraEnabled:    meterConfig.cameraEnabled,
      energySpent,
    });
  }, [meterConfig, faceData, energySpent]);

  function handleFaceUpdate(data) {
    const now = Date.now();
    // Always let presence changes through promptly; otherwise throttle to ~3s.
    const presenceChanged = (data.faceDetected === false) !== (faceDataRef.current.faceDetected === false);
    if (!presenceChanged && now - lastFaceUpdateRef.current < 3000) return;
    lastFaceUpdateRef.current = now;
    setFaceData(data);
  }

  useEffect(() => {
    listSaved(userToken)
      .then((items) => setSavedItemsMap(new Map(items.map((it) => [it.url, it]))))
      .catch(() => {});
  }, [userToken]);

  // Resume a session passed via sessionStorage (e.g. from public collection "Explore")
  useEffect(() => {
    const pending = sessionStorage.getItem("noscroll_pending_session");
    if (pending) {
      sessionStorage.removeItem("noscroll_pending_session");
      try {
        const data = JSON.parse(pending);
        handleSessionData(data);
      } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Session ──────────────────────────────────────────────────────────────────

  function makeHistoryEntry(centerNode, directions, breadcrumb, enteredFrom = null) {
    return { centerNode, directions, breadcrumb, enteredFrom };
  }

  function initExplorationHistory(centerNode, directions) {
    setExplorationHistory([
      makeHistoryEntry(centerNode, directions, [centerNode.id], null),
    ]);
  }

  async function handlePromptSubmit(prompt, mode = "deep") {
    setLoading(true);
    setError(null);
    setSessionMode(mode);
    setBrowseMode(mode);
    try {
      const data = await startSession(prompt, mode);
      setSessionId(data.session_id);
      setCenterNode(data.center_node);
      setDirections(data.directions);
      setBreadcrumb([data.center_node.id]);
      initExplorationHistory(data.center_node, data.directions);
      setSessionStartTime(Date.now());
      setEnergySpent(0);
      engagementRef.current = 0.85;
      setGraphInitialEnter(true);
      setPhase("graph");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Start a session from a known session-start response (e.g. from profile Explore)
  function handleSessionData(data) {
    setSessionId(data.session_id);
    setCenterNode(data.center_node);
    setDirections(data.directions);
    setBreadcrumb([data.center_node.id]);
    initExplorationHistory(data.center_node, data.directions);
    setSessionStartTime(Date.now());
    setEnergySpent(0);
    engagementRef.current = 0.85;
    setGraphInitialEnter(true);
    setPhase("graph");
  }

  const handleDirectionClick = useCallback(async (direction, position) => {
    setGraphInitialEnter(false);
    setLoading(true);
    setError(null);
    try {
      const data = await expandSession({
        sessionId,
        currentNodeId: centerNode.id,
        directionId: direction.id,
        chosenClusterId: direction.cluster_id,
        chosenContentId: direction.preview?.id ?? null,
      });
      setCenterNode(data.center_node);
      setDirections(data.directions);
      setBreadcrumb(data.breadcrumb);
      setExplorationHistory((h) => [
        ...h,
        makeHistoryEntry(data.center_node, data.directions, data.breadcrumb, position),
      ]);
    } catch {
      setError("Could not load content. Try another direction.");
      throw new Error("expand failed");
    } finally {
      setLoading(false);
    }
  }, [sessionId, centerNode]);

  const handleBackPrepare = useCallback(() => {
    const hist = explorationHistoryRef.current;
    if (hist.length <= 1) return null;
    const exitVia = hist[hist.length - 1].enteredFrom ?? "tr";
    return {
      exitVia,
      commit: () => {
        const h = explorationHistoryRef.current;
        const prev = h[h.length - 2];
        setExplorationHistory(h.slice(0, -1));
        setCenterNode(prev.centerNode);
        setDirections(prev.directions);
        setBreadcrumb(prev.breadcrumb);
        setGraphInitialEnter(false);
        setError(null);
      },
    };
  }, []);

  function restoreHistoryIndex(index) {
    if (index < 0 || index >= explorationHistory.length - 1) return;
    const target = explorationHistory[index];
    setExplorationHistory((h) => h.slice(0, index + 1));
    setCenterNode(target.centerNode);
    setDirections(target.directions);
    setBreadcrumb(target.breadcrumb);
    setGraphInitialEnter(false);
    setError(null);
  }

  function handleHopClick(index) {
    if (index >= explorationHistory.length - 1 || loading) return;
    if (index === explorationHistory.length - 2) {
      graphNavRef.current?.goBack();
      return;
    }
    restoreHistoryIndex(index);
  }

  function handleBackClick() {
    if (explorationHistory.length <= 1 || loading) return;
    graphNavRef.current?.goBack();
  }

  function clearSession() {
    setSessionId(null);
    setCenterNode(null);
    setDirections([]);
    setBreadcrumb([]);
    setExplorationHistory([]);
    setGraphInitialEnter(false);
    setError(null);
  }

  function handleReset() {
    setPhase("prompt");
    clearSession();
    navigate(browseMode === "relax" ? "/relax" : "/");
  }

  function handleSelectBrowseMode(mode) {
    const path = mode === "relax" ? "/relax" : "/";

    if (phase === "graph" && mode === sessionMode) {
      setPhase("prompt");
      clearSession();
      navigate(path);
      return;
    }

    if (mode !== browseMode) {
      setBrowseMode(mode);
      if (phase === "graph") {
        setPhase("prompt");
        clearSession();
      }
    }

    if (phase === "profile") {
      setBrowseMode(mode);
      setPhase("prompt");
    }

    navigate(path);
  }

  function handleBackFromProfile() {
    setPhase("prompt");
    navigate("/");
  }

  // ── Save / unsave ─────────────────────────────────────────────────────────────

  function handleRequestSave(node) {
    setPendingSaveNode(node);
  }

  async function handleConfirmSave({ caption, selectedIds, pendingNames }) {
    const node = pendingSaveNode;
    if (!node) return;
    setPendingSaveNode(null);

    const itemPayload = {
      url: node.url,
      title: node.title,
      content_type: node.content_type,
      source: node.source || null,
      summary: node.summary || null,
      author: node.author || null,
      caption: caption || null,
      duration_minutes: node.duration_minutes || null,
      read_time_minutes: node.read_time_minutes || null,
    };

    const tempId = `temp-${node.url}`;
    setSavedItemsMap((prev) => new Map(prev).set(node.url, { id: tempId, url: node.url, ...itemPayload }));

    try {
      const saved = await saveItem(userToken, itemPayload);
      setSavedItemsMap((prev) => new Map(prev).set(node.url, saved));

      const createdColIds = await Promise.all(
        (pendingNames || []).map((name) =>
          createCollection(userToken, { name }).then((col) => col.id)
        )
      );
      const allColIds = [...(selectedIds || []), ...createdColIds];
      await Promise.all(
        allColIds.map((colId) => addToCollection(userToken, colId, saved.id).catch(() => {}))
      );
    } catch {
      setSavedItemsMap((prev) => {
        const next = new Map(prev);
        next.delete(node.url);
        return next;
      });
    }
  }

  async function handleUnsave(itemId) {
    setSavedItemsMap((prev) => {
      const next = new Map(prev);
      for (const [url, item] of next) {
        if (item.id === itemId) { next.delete(url); break; }
      }
      return next;
    });
    try { await unsaveItem(userToken, itemId); } catch { /* silent */ }
  }

  const currentSavedItem = centerNode ? savedItemsMap.get(centerNode.url) : null;
  const savedItemsList = Array.from(savedItemsMap.values());

  // ── Render ────────────────────────────────────────────────────────────────────

  const navActiveTab = phase === "graph" ? sessionMode : browseMode;

  const navProps = {
    onDeep: () => handleSelectBrowseMode("deep"),
    onRelax: () => handleSelectBrowseMode("relax"),
  };

  if (phase === "profile") {
    return (
      <div className="app">
        <TopNav activeTab={navActiveTab} {...navProps} />
        <ProfilePage
          onExploreContent={(data) => handleSessionData(data)}
          onBack={handleBackFromProfile}
        />
        <AnimatePresence>
          {pendingSaveNode && (
            <SaveModal
              node={pendingSaveNode}
              token={userToken}
              onConfirm={handleConfirmSave}
              onClose={() => setPendingSaveNode(null)}
            />
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="app">
      <TopNav activeTab={navActiveTab} {...navProps} />

      {(phase === "prompt" || phase === "graph") && (
        <div className="cm-dock">
          <CognitiveMeter
            meter={meter}
            cameraEnabled={meterConfig.cameraEnabled}
            onFaceUpdate={handleFaceUpdate}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>
      )}

      {(phase === "prompt" || phase === "graph") && !meterConfig.cameraEnabled && !cameraPromptDismissed && (
        <div className="camera-prompt">
          <span className="camera-prompt__icon">👁</span>
          <span className="camera-prompt__text">
            Enable focus tracking so your battery reflects how much attention you actually spend.
          </span>
          <button
            className="camera-prompt__btn"
            onClick={() => { updateMeterConfig({ cameraEnabled: true }); setCameraPromptDismissed(true); }}
          >
            Enable camera
          </button>
          <button
            className="camera-prompt__dismiss"
            onClick={() => setCameraPromptDismissed(true)}
            aria-label="Dismiss"
          >✕</button>
        </div>
      )}

      {phase === "prompt" && (
        <PromptScreen
          onSubmit={handlePromptSubmit}
          loading={loading}
          mode={browseMode}
        />
      )}

      {phase === "graph" && centerNode && (
        <div className={`graph-screen ${sessionMode === "relax" ? "graph-screen--relax" : ""}`}>
          <div className="graph-topbar">
            <div className="graph-topbar__left">
              {explorationHistory.length > 1 && (
                <button
                  type="button"
                  className="graph-back-btn"
                  onClick={handleBackClick}
                  disabled={loading}
                >
                  ← Back
                </button>
              )}
            </div>
            <div className="graph-topbar__right">
              {error && <span className="graph-error">{error}</span>}
              <div className="graph-hops" aria-label="Exploration path">
                {breadcrumb.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`graph-hop-dot ${i === breadcrumb.length - 1 ? "graph-hop-dot--active" : ""} ${i < breadcrumb.length - 1 ? "graph-hop-dot--clickable" : ""}`}
                    onClick={() => handleHopClick(i)}
                    disabled={loading || i === breadcrumb.length - 1}
                    aria-label={i === breadcrumb.length - 1 ? `Hop ${i + 1}, current` : `Go back to hop ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>

          <NodeGraph
            ref={graphNavRef}
            centerNode={centerNode}
            directions={directions}
            onDirectionClick={handleDirectionClick}
            onBackPrepare={handleBackPrepare}
            loading={loading}
            isInitial={graphInitialEnter}
            savedItemId={currentSavedItem?.id ?? null}
            onSave={handleRequestSave}
            onUnsave={handleUnsave}
            mode={sessionMode}
          />
        </div>
      )}

      {settingsOpen && (
        <CognitiveSettings
          config={meterConfig}
          onChange={updateMeterConfig}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <AnimatePresence>
        {pendingSaveNode && (
          <SaveModal
            node={pendingSaveNode}
            token={userToken}
            onConfirm={handleConfirmSave}
            onClose={() => setPendingSaveNode(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
