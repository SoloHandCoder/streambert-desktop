// Links opened with Vidra (desktop):
//   streambert://open/movie/550, streambert://open/tv/1399?s=1&e=2   (taskbar "Continue watching")
//   streambert://open/search | downloads | library | settings | continue
//   TMDB / IMDb links pasted into search
// Also keeps the Windows taskbar jump list ("Continue watching") up to date.
import { tmdbFetch } from "../utils/api";
import { secureStorage } from "../utils/storage";

function waitForApp(timeout = 15000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (window.__sbNav?.open) return resolve(true);
      if (Date.now() - t0 > timeout) return resolve(false);
      setTimeout(tick, 150);
    };
    tick();
  });
}

function toast(text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.className = "toast";
  el.style.cssText = "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;pointer-events:none";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/** { type, id } (TMDB) or { imdb } from text containing a link, else null */
export function parseLink(text) {
  const s = String(text || "");
  let m = s.match(/themoviedb\.org\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(movie|tv)\/(\d+)/i);
  if (m) return { type: m[1].toLowerCase(), id: Number(m[2]) };
  m = s.match(/imdb\.com\/(?:[a-z]{2}\/)?title\/(tt\d{5,10})/i);
  if (m) return { imdb: m[1] };
  m = s.match(/^\s*(tt\d{7,10})\s*$/);
  if (m) return { imdb: m[1] };
  return null;
}

export async function openLink(link) {
  const apiKey = await secureStorage.get("apikey");
  if (!apiKey) {
    toast("Add your TMDB token first, then try again");
    return false;
  }
  let type = link.type, id = link.id;
  if (link.imdb) {
    const r = await tmdbFetch(`/find/${link.imdb}?external_source=imdb_id`, apiKey);
    const hit = r?.movie_results?.[0] ? ["movie", r.movie_results[0]] : r?.tv_results?.[0] ? ["tv", r.tv_results[0]] : null;
    if (!hit) {
      toast("Couldn't find that title on TMDB");
      return false;
    }
    [type, { id }] = hit;
  }
  let item = null;
  try {
    item = await tmdbFetch(`/${type}/${id}`, apiKey);
  } catch {}
  if (!item?.id) {
    toast("Couldn't load that title");
    return false;
  }
  window.__sbNav.open({ ...item, media_type: type });
  return true;
}

async function handle(text) {
  if (text) text = String(text).replace(/^vidra:\/\//i, "streambert://"); // new link name, same links
  if (!text || !(await waitForApp())) return;
  const nav = window.__sbNav;
  const title = String(text).match(/^streambert:\/\/(?:open\/)?(movie|tv)\/(\d+)(?:\/?\?(.*))?/i);
  if (title) {
    const type = title[1].toLowerCase();
    const id = Number(title[2]);
    const q = new URLSearchParams(title[3] || "");
    try {
      const hist = JSON.parse(localStorage.getItem("streambert_history") || "[]");
      const s = q.get("s"), e = q.get("e");
      const hit =
        hist.find((h) => h.id === id && h.media_type === type && (s == null || (String(h.season) === s && String(h.episode) === e))) ||
        hist.find((h) => h.id === id && h.media_type === type);
      if (hit) return nav.open(hit);
    } catch {}
    try {
      await openLink({ type, id });
    } catch {
      toast("Couldn't open that title");
    }
    return;
  }
  if (/^streambert:\/\/party\//i.test(String(text))) {
    window.dispatchEvent(new CustomEvent("streambert:party-join", { detail: { link: String(text) } }));
    return;
  }
  const sc = String(text).match(/^streambert:\/\/(?:open\/)?([a-z-]+)/i);
  if (sc) {
    const what = sc[1].toLowerCase();
    if (what === "search") nav.openSearch();
    else if (what === "downloads") nav.go("downloads");
    else if (what === "library" || what === "history") nav.go("history");
    else if (what === "settings") nav.go("settings");
    else if (what === "continue" && !nav.continueWatching()) toast("Nothing to continue yet");
    return;
  }
  const link = parseLink(text);
  if (link) openLink(link).catch(() => toast("Couldn't open that link"));
}

/** taskbar jump list: the last few titles you watched */
function syncJumpList() {
  if (!window.electron?.setRecentItems) return;
  let hist = [];
  try {
    hist = JSON.parse(localStorage.getItem("streambert_history") || "[]");
  } catch {}
  const seen = new Set();
  const items = [];
  for (const h of hist) {
    const k = `${h.media_type}_${h.id}`;
    if (!h?.id || seen.has(k)) continue;
    seen.add(k);
    const ep = h.media_type === "tv" && h.season != null && h.episode != null;
    items.push({
      title: `${h.title || h.name || "Untitled"}${ep ? ` · S${h.season}E${h.episode}` : ""}`,
      url: `streambert://open/${h.media_type}/${h.id}${ep ? `?s=${h.season}&e=${h.episode}` : ""}`,
    });
    if (items.length >= 5) break;
  }
  const sig = JSON.stringify(items);
  if (sig === syncJumpList.last) return;
  syncJumpList.last = sig;
  window.electron.setRecentItems(items).catch(() => {});
}

export function initIncoming() {
  if (!window.electron) return;
  window.electron.onOpenLink?.((url) => handle(url));
  window.electron
    .takePendingLink?.()
    .then((url) => url && handle(url))
    .catch(() => {});
  setTimeout(syncJumpList, 4000);
  setInterval(syncJumpList, 60000);
  window.addEventListener("streambert:sync-applied", syncJumpList);
}
