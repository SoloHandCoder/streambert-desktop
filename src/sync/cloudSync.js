// Cloud sync through a private (secret) GitHub Gist — same format as the
// Streambert Android app, so desktop and phones share history, saved titles,
// progress and watched episodes.
//
// Gist "Streambert sync":
//   streambert-sync.json   { app, version, updatedAt, profiles: [...], deleted: [...] }
//   profile-<id>.json      { version, updatedAt, profile, data: { saved, history, progress, watched, … } }
//
// The desktop has no profiles: it syncs the main profile ("default", called "Me"
// on Android) and leaves other profiles in the Gist untouched.
import { mergeProfile, same } from "./syncMerge.js";

const API = () => localStorage.getItem("__sb_sync_api") || "https://api.github.com"; // overridable for tests
const DESC = "Streambert sync";
const INDEX = "streambert-sync.json";
const PROFILE_ID = "default";
const FILE = `profile-${PROFILE_ID}.json`;
const TOKEN_KEY = "githubSyncToken"; // stored with the OS-encrypted secure storage
const STATE_KEY = "__sb_sync";
const BASE_KEY = `__sb_sync_base_${PROFILE_ID}`;
const AUTO_MS = 5 * 60 * 1000;
const P = "streambert_";

/** keys that belong to the person (same list as the Android profiles) */
const PERSONAL_KEYS = ["saved", "savedOrder", "progress", "watched", "history", "searchHistory", "episodeReleaseCache", "sourceFailoverCache"];
const PERSONAL_PREFIXES = ["dlTime_", "dlDur_"]; // resume positions by episode key (portable)

const listeners = new Set();
let running = null;
let tokenCache = null;

async function getToken() {
  if (tokenCache !== null) return tokenCache;
  try {
    tokenCache = (await window.electron?.secureGet?.(TOKEN_KEY)) || "";
  } catch {
    tokenCache = "";
  }
  return tokenCache;
}
async function setToken(v) {
  tokenCache = v || "";
  try {
    await window.electron?.secureSet?.(TOKEN_KEY, v || "");
  } catch {}
}

function state() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
  } catch {
    return {};
  }
}
function setState(patch) {
  const s = { ...state(), ...patch };
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
  emit();
  return s;
}
function emit() {
  const st = getStatus();
  listeners.forEach((cb) => cb(st));
}

export function getStatus() {
  const s = state();
  return {
    connected: !!s.login && !!s.hasToken,
    login: s.login || null,
    lastSync: s.lastSync || null,
    lastError: s.lastError || null,
    auto: s.auto !== false,
    syncing: !!running,
  };
}
export function onStatus(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function gh(path, { method = "GET", body, tok } = {}) {
  tok = tok ?? (await getToken());
  const res = await fetch(API() + path, {
    method,
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (res.status === 401) throw new Error("GitHub rejected the token (expired or revoked).");
  if (res.status >= 400) throw new Error(data?.message ? `GitHub: ${data.message}` : `GitHub error ${res.status}`);
  return { data, headers: res.headers };
}

// ── local data ───────────────────────────────────────────────────────────────
function isPersonal(fullKey) {
  if (!fullKey.startsWith(P)) return false;
  const k = fullKey.slice(P.length);
  return PERSONAL_KEYS.includes(k) || PERSONAL_PREFIXES.some((p) => k.startsWith(p));
}
function readLocal() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !isPersonal(k)) continue;
    try {
      out[k.slice(P.length)] = JSON.parse(localStorage.getItem(k));
    } catch {}
  }
  return out;
}
function writeLocal(data) {
  const del = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isPersonal(k)) del.push(k);
  }
  del.forEach((k) => localStorage.removeItem(k));
  for (const [k, v] of Object.entries(data)) if (isPersonal(P + k)) localStorage.setItem(P + k, JSON.stringify(v));
}
const portable = (data) =>
  Object.fromEntries(Object.entries(data || {}).filter(([k]) => isPersonal(P + k)));

// ── public API ───────────────────────────────────────────────────────────────
export async function connect(tok) {
  tok = String(tok || "").trim();
  if (!tok) throw new Error("Paste a GitHub token first.");
  const { data: user, headers } = await gh("/user", { tok });
  const scopes = headers.get("x-oauth-scopes");
  if (scopes && !scopes.split(/,\s*/).includes("gist")) throw new Error('This token is missing the "gist" permission.');
  await setToken(tok);
  let gistId = null;
  for (let page = 1; page <= 5 && !gistId; page++) {
    const { data: gists } = await gh(`/gists?per_page=100&page=${page}`);
    if (!Array.isArray(gists) || !gists.length) break;
    const hit = gists.find((g) => g.description === DESC && g.files?.[INDEX]);
    if (hit) gistId = hit.id;
  }
  setState({ login: user?.login || "GitHub", gistId, hasToken: true, lastError: null });
  return syncNow();
}

export async function disconnect() {
  await setToken("");
  localStorage.removeItem(BASE_KEY);
  localStorage.removeItem(STATE_KEY);
  emit();
}

export function setAuto(v) {
  setState({ auto: !!v });
}

async function readGist(id) {
  const { data } = await gh(`/gists/${id}`);
  const files = {};
  for (const [name, f] of Object.entries(data?.files || {})) {
    let content = f.content;
    if (f.truncated && f.raw_url) content = await (await fetch(f.raw_url)).text();
    try {
      files[name] = JSON.parse(content);
    } catch {}
  }
  return files;
}

export function syncNow() {
  if (running) return running;
  running = (async () => {
    if (!(await getToken())) return;
    await doSync();
    setState({ lastSync: Date.now(), lastError: null });
  })()
    .catch((e) => setState({ lastError: String(e?.message || e) }))
    .finally(() => {
      running = null;
      emit();
    });
  emit();
  return running;
}

async function doSync() {
  let remote = {};
  if (state().gistId) {
    try {
      remote = await readGist(state().gistId);
    } catch (e) {
      if (/Not Found/.test(String(e?.message))) setState({ gistId: null });
      else throw e;
    }
  }
  const now = Date.now();
  const base = JSON.parse(localStorage.getItem(BASE_KEY) || "{}");
  const local = readLocal();
  const remoteData = portable(remote[FILE]?.data);
  const merged = mergeProfile(base, local, remoteData);
  let changedLocal = false;
  if (!same(merged, local)) {
    writeLocal(merged);
    changedLocal = true;
  }
  localStorage.setItem(BASE_KEY, JSON.stringify(merged));

  const files = {};
  if (!same(merged, remoteData) || !remote[FILE]) {
    const prof = remote[FILE]?.profile || { id: PROFILE_ID, name: "Me", color: "#e50914" };
    files[FILE] = { content: JSON.stringify({ version: 1, updatedAt: now, profile: prof, data: merged }) };
  }
  const index = remote[INDEX] || { app: "streambert", version: 1, profiles: [], deleted: [] };
  if (!index.profiles?.some((p) => p.id === PROFILE_ID)) {
    index.profiles = [...(index.profiles || []), { id: PROFILE_ID, name: "Me", color: "#e50914" }];
    files[INDEX] = { content: JSON.stringify({ ...index, updatedAt: now }, null, 1) };
  }
  if (Object.keys(files).length) {
    if (!state().gistId) {
      if (!files[INDEX]) files[INDEX] = { content: JSON.stringify({ ...index, updatedAt: now }, null, 1) };
      const { data } = await gh("/gists", { method: "POST", body: { description: DESC, public: false, files } });
      setState({ gistId: data.id });
    } else {
      await gh(`/gists/${state().gistId}`, { method: "PATCH", body: { files } });
    }
  }
  if (changedLocal) window.dispatchEvent(new Event("streambert:sync-applied"));
}

/** Auto sync: on start, every 5 minutes, and when the window is hidden / closed. */
export function initCloudSync() {
  const auto = () => getStatus().connected && getStatus().auto && syncNow();
  setTimeout(auto, 5000);
  setInterval(auto, AUTO_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) auto();
  });
  window.addEventListener("beforeunload", () => {
    if (getStatus().connected && getStatus().auto) syncNow();
  });
}
