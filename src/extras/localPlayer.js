// Built-in player for downloaded files (same player as the Android app).
// Shows public/sb-player.html in a full-window overlay; files are read through
// the sbmedia:// protocol (src/ipc/localMedia.js). Falls back to mpv/VLC/the
// system player for formats Chromium can't play or when turned off in Settings.
import { trackWatchSecond } from "./libraryExtras.js";
import { openCastPicker } from "./CastUI";

const SETTING = "streambert_builtInPlayer"; // default on
const PLAYABLE = /\.(mp4|m4v|webm|mkv|mov|m3u8)$/i;

export const builtInPlayerEnabled = () => {
  try {
    return JSON.parse(localStorage.getItem(SETTING) ?? "true") !== false;
  } catch {
    return true;
  }
};
export const setBuiltInPlayer = (on) => {
  try {
    localStorage.setItem(SETTING, JSON.stringify(!!on));
  } catch {}
};
export const canPlayBuiltIn = (filePath) => builtInPlayerEnabled() && PLAYABLE.test(String(filePath || ""));

export function mediaUrl(filePath) {
  const parts = String(filePath).replace(/\\/g, "/").split("/");
  return "sbmedia://file/" + parts.map(encodeURIComponent).join("/");
}

let current = null;

function onMessage(e) {
  if (!current || e.source !== current.frame.contentWindow) return;
  const d = e.data;
  if (!d || typeof d !== "object" || d.__sb !== "player") return;
  if (d.cmd === "close") closeLocalPlayer();
  else if (d.cmd === "position") savePos(Number(d.t) || 0, Number(d.d) || 0);
  else if (d.cmd === "cast") {
    const c = current;
    openCastPicker({
      filePath: c.filePath,
      title: c.title,
      poster_path: c.media?.poster_path || null,
      startTime: Number(d.t) || 0,
      onStarted: () => closeLocalPlayer(),
    });
  }
}

function savePos(t, d) {
  const c = current;
  if (!c || !(t > 0)) return;
  // watch statistics: count the time since the last report while it plays
  if (c.media?.id && c.lastT != null && t > c.lastT && t - c.lastT < 30) {
    trackWatchSecond(c.media, Math.round(t - c.lastT));
  }
  c.lastT = t;
  try {
    // near the end → start from the beginning next time
    const keep = d > 0 && t > d - 30 ? 0 : Math.floor(t);
    if (c.progressKey) localStorage.setItem("streambert_" + c.progressKey, JSON.stringify(keep));
    if (c.durKey && d > 0) localStorage.setItem("streambert_" + c.durKey, JSON.stringify(d));
  } catch {}
}

function onKey(e) {
  // Escape while the overlay (not the player frame) has focus
  if (e.key === "Escape" && current && !document.fullscreenElement) {
    e.preventDefault();
    e.stopPropagation();
    closeLocalPlayer();
  }
}

export function closeLocalPlayer() {
  if (!current) return false;
  const { root, frame } = current;
  window.removeEventListener("message", onMessage);
  window.removeEventListener("keydown", onKey, true);
  try {
    frame.contentWindow?.postMessage({ __sb: "host", cmd: "pause" }, "*");
  } catch {}
  current = null;
  try {
    frame.src = "about:blank";
  } catch {}
  root.remove();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  window.dispatchEvent(new Event("streambert:local-player-closed"));
  return true;
}

/**
 * filePath, seconds (start), subtitlePaths [{path,label,lang}] or [path],
 * title, media {id, media_type, title, poster_path} (stats),
 * progressKey / durKey: storage keys the Downloads page uses for resume.
 */
export function openLocalPlayer({ filePath, seconds = 0, subtitlePaths = [], title = "", media = null, progressKey = null, durKey = null }) {
  closeLocalPlayer();
  const subs = [];
  for (const [i, s] of (subtitlePaths || []).entries()) {
    const sp = typeof s === "string" ? s : s?.path;
    if (!sp || !/\.(vtt|srt)$/i.test(sp)) continue; // the player converts SRT → VTT
    const name = sp.split(/[\\/]/).pop();
    subs.push({
      url: mediaUrl(sp),
      label: (typeof s === "object" && (s.label || s.lang)) || name.replace(/\.(vtt|srt)$/i, "") || `Subtitle ${i + 1}`,
      lang: ((typeof s === "object" && s.lang) || "und").slice(0, 8),
    });
  }
  const p = new URLSearchParams();
  p.set("src", mediaUrl(filePath));
  if (title) p.set("title", title);
  if (seconds > 0) p.set("t", String(Math.floor(seconds)));
  p.set("close", "1");
  p.set("pc", "1");
  if (window.electron?.castDiscover && !/\.m3u8$/i.test(filePath)) p.set("cast", "1");
  if (/\.m3u8$/i.test(filePath)) p.set("type", "hls");
  if (subs.length) p.set("subs", JSON.stringify(subs));
  p.set("key", progressKey || String(filePath));

  const root = document.createElement("div");
  root.className = "sb-local-player";
  const top = document.documentElement.hasAttribute("data-win-titlebar") ? 32 : 0;
  root.style.cssText = `position:fixed;left:0;right:0;bottom:0;top:${top}px;z-index:2147483600;background:#000`;
  const frame = document.createElement("iframe");
  frame.src = `sb-player.html?${p.toString()}`;
  frame.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
  frame.setAttribute("allowfullscreen", "");
  frame.title = title || "Player";
  frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#000";
  frame.addEventListener("load", () => {
    try {
      frame.focus();
      frame.contentWindow?.focus();
    } catch {}
  });
  root.appendChild(frame);
  document.body.appendChild(root);
  current = { root, frame, media, progressKey, durKey, lastT: null, filePath, title };
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", onKey, true);
}
