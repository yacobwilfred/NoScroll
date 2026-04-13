import { useState, useCallback, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import {
  startSession, expandSession, saveItem, unsaveItem, listSaved,
  createCollection, addToCollection,
} from "./api";
import { getUserToken } from "./utils/userToken";
import PromptScreen from "./components/PromptScreen";
import TopNav from "./components/TopNav";
import NodeGraph from "./components/NodeGraph";
import ProfileDrawer from "./components/ProfileDrawer";
import SaveModal from "./components/SaveModal";
import PublicCollectionPage from "./components/PublicCollectionPage";
import ProfilePage from "./pages/ProfilePage";
import UserProfilePage from "./pages/UserProfilePage";
import FriendsPicksPage from "./pages/FriendsPicksPage";

// ── Simple path-based routing ─────────────────────────────────────────────────
function getRoute() {
  const path = window.location.pathname;
  const colMatch = path.match(/^\/c\/([^/]+)$/);
  if (colMatch) return { type: "public-collection", id: colMatch[1] };
  const userMatch = path.match(/^\/u\/([^/]+)$/);
  if (userMatch) return { type: "user-profile", handle: userMatch[1] };
  if (path === "/profile") return { type: "profile" };
  if (path === "/friends") return { type: "friends" };
  return { type: "app" };
}

function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export default function App() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    function onPop() { setRoute(getRoute()); }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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
          activeTab="friends"
          onNewPrompt={() => navigate("/")}
          onFriendsPicks={() => navigate("/friends")}
          onProfile={() => navigate("/profile")}
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
    return <MainApp initialPhase="profile" />;
  }

  return <MainApp initialPhase="prompt" />;
}

// ── Main app (prompt + graph + profile) ──────────────────────────────────────
function MainApp({ initialPhase = "prompt" }) {
  const [phase, setPhase] = useState(initialPhase);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [sessionId, setSessionId] = useState(null);
  const [centerNode, setCenterNode] = useState(null);
  const [directions, setDirections] = useState([]);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [enterFrom, setEnterFrom] = useState(null);

  const [userToken] = useState(() => getUserToken());
  const [savedItemsMap, setSavedItemsMap] = useState(new Map());
  const [pendingSaveNode, setPendingSaveNode] = useState(null);

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

  async function handlePromptSubmit(prompt) {
    setLoading(true);
    setError(null);
    try {
      const data = await startSession(prompt);
      setSessionId(data.session_id);
      setCenterNode(data.center_node);
      setDirections(data.directions);
      setBreadcrumb([data.center_node.id]);
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
    setEnterFrom(null);
    setPhase("graph");
  }

  const handleDirectionClick = useCallback(async (direction, position) => {
    if (loading) return;
    setLoading(true);
    setEnterFrom(position ?? null);
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
    } catch {
      setError("Could not load content. Try another direction.");
    } finally {
      setLoading(false);
    }
  }, [loading, sessionId, centerNode]);

  function handleReset() {
    setPhase("prompt");
    setSessionId(null);
    setCenterNode(null);
    setDirections([]);
    setBreadcrumb([]);
    setEnterFrom(null);
    setError(null);
    navigate("/");
  }

  function handleGoToProfile() {
    setPhase("profile");
    navigate("/profile");
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

  const navProps = {
    onNewPrompt: handleReset,
    onFriendsPicks: () => navigate("/friends"),
    onProfile: handleGoToProfile,
  };

  if (phase === "profile") {
    return (
      <div className="app">
        <TopNav activeTab="profile" {...navProps} />
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
      <TopNav
        activeTab={phase === "prompt" ? "prompt" : null}
        {...navProps}
      />

      {phase === "prompt" && (
        <PromptScreen
          onSubmit={handlePromptSubmit}
          loading={loading}
          savedCount={savedItemsList.length}
        />
      )}

      {phase === "graph" && centerNode && (
        <div className="graph-screen">
          <div className="graph-topbar">
            <div className="graph-topbar__right">
              {error && <span className="graph-error">{error}</span>}
              <div className="graph-hops">
                {breadcrumb.map((_, i) => (
                  <span
                    key={i}
                    className={`graph-hop-dot ${i === breadcrumb.length - 1 ? "graph-hop-dot--active" : ""}`}
                  />
                ))}
              </div>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <NodeGraph
              key={centerNode.id}
              centerNode={centerNode}
              directions={directions}
              onDirectionClick={handleDirectionClick}
              loading={loading}
              enterFrom={enterFrom}
              savedItemId={currentSavedItem?.id ?? null}
              onSave={handleRequestSave}
              onUnsave={handleUnsave}
            />
          </AnimatePresence>
        </div>
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
