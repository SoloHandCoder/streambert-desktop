// "Download season" (same flow as the Android app): gets every episode's stream
// one after another and starts the downloads, keeping at most 2 running at once.
//  - HiAnime source: resolved directly (no player needed)
//  - other sources: each episode's player is loaded in a hidden, muted webview
//    until it requests its stream
import "./seasonDownload.css";

const MAX_PARALLEL = 2;
let running = null;

// webContents ids of hidden capture players: the Movie/TV pages ignore their streams
window.__sbCaptureIds = window.__sbCaptureIds || new Set();

function banner() {
  let el = document.getElementById("sb-season-dl");
  if (!el) {
    el = document.createElement("div");
    el.id = "sb-season-dl";
    el.innerHTML =
      '<div class="sb-sdl__text"></div><button class="sb-sdl__x" type="button">Stop</button><div class="sb-sdl__bar"><div class="sb-sdl__fill"></div></div>';
    el.querySelector(".sb-sdl__x").onclick = () => {
      if (running) running.cancelled = true;
      else hide();
    };
    document.body.appendChild(el);
  }
  return el;
}
function show(text, frac) {
  const el = banner();
  el.querySelector(".sb-sdl__text").textContent = text;
  el.querySelector(".sb-sdl__fill").style.width = `${Math.round((frac || 0) * 100)}%`;
  el.querySelector(".sb-sdl__x").textContent = running ? "Stop" : "Close";
  el.classList.add("sb-sdl--on");
}
function hide(delay = 0) {
  setTimeout(() => document.getElementById("sb-season-dl")?.classList.remove("sb-sdl--on"), delay);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KICK_JS = `(() => { const v = document.querySelector('video');
  if (v) { v.muted = true; v.play().catch(() => {}); return { playing: false }; }
  const b = document.querySelector('.play-button, .vjs-big-play-button, .jw-display-icon-container, [class*="play" i] button, button[aria-label*="play" i], #play, .plyr__control--overlaid');
  if (b) b.click();
  return null; })()`;

/** Loads an embed player hidden + muted until it requests an .m3u8 stream. */
export async function captureStream(embedUrl, timeoutMs = 45000) {
  const wv = document.createElement("webview");
  wv.setAttribute("partition", "persist:player");
  wv.setAttribute("allowpopups", "false");
  wv.style.cssText = "position:fixed;left:-20000px;top:0;width:960px;height:540px;opacity:0;pointer-events:none";
  const found = [];
  const early = []; // streams seen before this webview's id is known
  let wcId = null;
  let done;
  const first = new Promise((r) => (done = r));
  const take = (url) => {
    found.push(url);
    done();
  };
  const onFound = window.electron.onM3u8Found((url, fromId) => {
    if (wcId == null) early.push([url, fromId]);
    else if (fromId === wcId) take(url);
  });
  // webview methods only work after dom-ready (before that nothing can play yet)
  wv.addEventListener("dom-ready", () => {
    try {
      wv.setAudioMuted(true);
      if (wcId == null) {
        wcId = wv.getWebContentsId();
        window.__sbCaptureIds.add(wcId);
        for (const [u, id] of early) if (id === wcId) take(u);
      }
    } catch {}
  });
  wv.src = embedUrl;
  document.body.appendChild(wv);
  const kick = setInterval(() => {
    if (wcId != null) window.electron.playerTick?.(wcId, KICK_JS).catch(() => {});
  }, 2500);
  try {
    await Promise.race([first, sleep(timeoutMs)]);
    if (found.length) await sleep(2000); // let master/variant playlists settle
  } finally {
    clearInterval(kick);
    window.electron.offM3u8Found(onFound);
    try {
      wv.src = "about:blank";
    } catch {}
    wv.remove();
    setTimeout(() => window.__sbCaptureIds.delete(wcId), 5000);
  }
  if (!found.length) return null;
  // the master playlist (all qualities) usually comes first or says so
  return found.find((u) => /master|playlist/i.test(u)) || found[0];
}

async function runningCount() {
  try {
    return (await window.electron.getDownloads()).filter((d) => d.status === "downloading").length;
  } catch {
    return 0;
  }
}

/**
 * baseName "Show (2020)", tmdbId, season, posterPath,
 * episodes [{ episode_number, _tmdbSeason?, _tmdbAbsolute? }],
 * skip Set of episode numbers already downloaded / downloading,
 * async (HiAnime), animeTitle, dubMode, embedUrl(ep),
 * onStarted(entry) → lets the app show the new download right away
 */
export async function downloadSeason(o) {
  const el = window.electron;
  if (!el?.runDownload) return;
  if (running) {
    show("A season download is already running…", running.frac);
    return;
  }
  let downloadPath = "", folder = "";
  try {
    downloadPath = JSON.parse(localStorage.getItem("streambert_downloadPath") || '""') || "";
    folder = JSON.parse(localStorage.getItem("streambert_downloaderFolder") || '""') || "";
  } catch {}
  const full = await (await import("./smartDownloads.js")).storageLimitReached();
  if (full) {
    show(full, 0);
    hide(6000);
    return;
  }
  const dl = folder ? await el.checkDownloader(folder).catch(() => null) : null;
  if (!downloadPath || !dl?.exists) {
    show("Set a download folder and the downloader in Settings → Downloads first.", 0);
    hide(5000);
    return;
  }
  const todo = o.episodes.filter((ep) => !o.skip?.has(ep.episode_number));
  if (!todo.length) {
    show("All episodes of this season are already downloaded.", 1);
    hide(3000);
    return;
  }
  const job = (running = { cancelled: false, frac: 0 });
  let ok = 0;
  const failed = [];
  const s2 = String(o.season).padStart(2, "0");
  try {
    for (let i = 0; i < todo.length; i++) {
      if (job.cancelled) break;
      const ep = todo[i];
      const n = ep.episode_number;
      job.frac = i / todo.length;
      // wait for a free slot, so stream links are fresh when the download starts
      while (!job.cancelled && (await runningCount()) >= MAX_PARALLEL) {
        show(`Season ${o.season}: ${ok} started · waiting for a download to finish before episode ${n}…`, job.frac);
        await sleep(4000);
      }
      if (job.cancelled) break;
      show(`${o.label ? o.label + " · " : ""}Season ${o.season}: getting episode ${n} (${i + 1}/${todo.length})…`, job.frac);
      let url = null;
      try {
        if (o.async) {
          const r = await el.resolveHiAnime({
            title: o.animeTitle,
            seasonNumber: o.season,
            episodeNumber: n,
            translationType: o.dubMode || "sub",
          });
          url = r?.ok ? r.url : null;
        } else {
          const embed = o.embedUrl(ep);
          url = embed ? await captureStream(embed, 45000) : null;
        }
      } catch {
        url = null;
      }
      if (job.cancelled) break;
      if (!url) {
        failed.push(n);
        continue;
      }
      const name = `${o.baseName} S${s2} E${String(n).padStart(2, "0")}`;
      const res = await el.runDownload({
        token: dl.token,
        m3u8Url: url,
        name,
        downloadPath,
        mediaId: o.tmdbId,
        mediaType: "tv",
        season: o.season,
        episode: n,
        posterPath: o.posterPath || null,
        tmdbId: o.tmdbId,
        subtitles: [],
        quality: (await import("./quality.js")).getDefaultQuality(),
      });
      if (res?.ok) {
        ok++;
        o.onStarted?.({
          id: res.id,
          name,
          m3u8Url: url,
          downloadPath,
          filePath: null,
          status: "downloading",
          progress: 0,
          speed: "",
          size: "",
          totalFragments: 0,
          lastMessage: "Starting…",
          startedAt: Date.now(),
          mediaId: o.tmdbId,
          mediaType: "tv",
          season: o.season,
          episode: n,
          posterPath: o.posterPath || null,
          tmdbId: o.tmdbId,
          subtitles: [],
          subtitlePaths: [],
        });
      } else failed.push(n);
    }
  } finally {
    running = null;
  }
  const parts = [];
  if (ok) parts.push(`${ok} episode${ok === 1 ? "" : "s"} added to Downloads`);
  if (failed.length) parts.push(`couldn't get E${failed.join(", E")} (try another source)`);
  if (job.cancelled) parts.unshift("Stopped");
  show(parts.join(" · ") || "Nothing to download", 1);
  hide(6000);
}
