const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export async function startSession(prompt) {
  const res = await fetch(`${BASE}/session/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function expandSession({ sessionId, currentNodeId, directionId, chosenClusterId, chosenContentId }) {
  const res = await fetch(`${BASE}/session/expand`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      current_node_id: currentNodeId,
      direction_id: directionId,
      chosen_cluster_id: chosenClusterId,
      chosen_content_id: chosenContentId ?? null,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getContent(contentId) {
  const res = await fetch(`${BASE}/content/${contentId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getReaderView(contentId) {
  const res = await fetch(`${BASE}/content/${contentId}/reader`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getAudioUrl(contentId) {
  const res = await fetch(`${BASE}/content/${contentId}/audio-url`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Start session from content ────────────────────────────────────────────────

export async function startSessionFromContent(contentId) {
  const res = await fetch(`${BASE}/session/start-from-content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content_id: contentId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function startSessionFromExternal({ url, title, content_type, summary, author, source, thumbnail }) {
  const res = await fetch(`${BASE}/session/start-from-external`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, title, content_type, summary, author, source, thumbnail }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getProfileStats(token) {
  const res = await fetch(`${BASE}/profile/${token}/stats`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Profile / saved items ─────────────────────────────────────────────────────

// item may include: url, title, content_type, source, summary, thumbnail,
// author, caption, duration_minutes, read_time_minutes,
// collection_id (existing) OR new_collection_name (create on the fly)
export async function saveItem(token, item) {
  const res = await fetch(`${BASE}/profile/${token}/saved`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_token: token, ...item }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function unsaveItem(token, itemId) {
  const res = await fetch(`${BASE}/profile/${token}/saved/${itemId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function listSaved(token) {
  const res = await fetch(`${BASE}/profile/${token}/saved`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Collections ───────────────────────────────────────────────────────────────

export async function listCollections(token) {
  const res = await fetch(`${BASE}/profile/${token}/collections`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createCollection(token, { name, description = "", is_public = true }) {
  const res = await fetch(`${BASE}/profile/${token}/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_token: token, name, description, is_public }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateCollection(token, colId, patch) {
  const res = await fetch(`${BASE}/profile/${token}/collections/${colId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteCollection(token, colId) {
  const res = await fetch(`${BASE}/profile/${token}/collections/${colId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

export async function addToCollection(token, colId, savedItemId) {
  const res = await fetch(`${BASE}/profile/${token}/collections/${colId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ saved_item_id: savedItemId }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function removeFromCollection(token, colId, itemId) {
  const res = await fetch(`${BASE}/profile/${token}/collections/${colId}/items/${itemId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function listCollectionItems(token, colId) {
  const res = await fetch(`${BASE}/profile/${token}/collections/${colId}/items`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getPublicCollection(colId) {
  const res = await fetch(`${BASE}/profile/c/${colId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getPublicCollectionItems(colId) {
  const res = await fetch(`${BASE}/profile/c/${colId}/items`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── External URL extraction ───────────────────────────────────────────────────

export async function extractUrl(url) {
  const res = await fetch(`${BASE}/profile/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Identity ──────────────────────────────────────────────────────────────────

export async function setupIdentity(token, { handle, display_name, bio = null }) {
  const res = await fetch(`${BASE}/identity/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, handle, display_name, bio }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getMyIdentity(token) {
  const res = await fetch(`${BASE}/identity/me/${token}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getIdentityByHandle(handle) {
  const res = await fetch(`${BASE}/identity/by-handle/${handle}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Friends ───────────────────────────────────────────────────────────────────

export async function sendFriendRequest(token, handle) {
  const res = await fetch(`${BASE}/identity/${token}/friends/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function acceptFriendRequest(token, friendshipId) {
  const res = await fetch(`${BASE}/identity/${token}/friends/${friendshipId}/accept`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function declineFriendRequest(token, friendshipId) {
  const res = await fetch(`${BASE}/identity/${token}/friends/${friendshipId}/decline`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function unfriend(token, friendshipId) {
  const res = await fetch(`${BASE}/identity/${token}/friends/${friendshipId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listFriends(token) {
  const res = await fetch(`${BASE}/identity/${token}/friends`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listFriendRequests(token) {
  const res = await fetch(`${BASE}/identity/${token}/friends/requests`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getFriendshipStatus(token, handle) {
  const res = await fetch(`${BASE}/identity/${token}/friends/status/${handle}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getFriendsFeed(token) {
  const res = await fetch(`${BASE}/identity/${token}/feed`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getPublicUserCollections(handle) {
  const res = await fetch(`${BASE}/identity/public/${handle}/collections`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
