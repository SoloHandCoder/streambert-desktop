// Chromecast for the desktop app.
//  - finds Cast devices on the local network (mDNS "_googlecast._tcp")
//  - plays streams and downloaded files on them with the Default Media Receiver
//  - streams go through a small relay on this computer, because most hosts
//    only answer with the Referer / Origin the in-app player used, which a
//    Chromecast can't send. HLS playlists are rewritten so segments use the
//    relay too. The relay only serves URLs it was handed for the current cast
//    (random token per cast), and stops when casting stops.
const { ipcMain } = require("electron");
const http = require("http");
const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let getMeta = () => null; // url → { referer, origin, userAgent }
let getWin = () => null;

// ── discovery ────────────────────────────────────────────────────────────────
function discover(timeoutMs = 3500) {
  return new Promise((resolve) => {
    let mdns;
    try {
      mdns = require("multicast-dns")();
    } catch {
      return resolve([]);
    }
    const found = new Map();
    const onResponse = (res) => {
      const all = [...(res.answers || []), ...(res.additionals || [])];
      const srv = all.filter((r) => r.type === "SRV");
      const a = all.filter((r) => r.type === "A");
      const txt = all.filter((r) => r.type === "TXT");
      for (const s of srv) {
        if (!/_googlecast\._tcp/.test(s.name)) continue;
        const host = a.find((x) => x.name === s.data.target)?.data;
        if (!host) continue;
        let name = s.name.split("._googlecast")[0];
        const t = txt.find((x) => x.name === s.name);
        for (const b of (t?.data || []).map((x) => x.toString())) if (b.startsWith("fn=")) name = b.slice(3);
        found.set(s.name, { id: s.name, name, host, port: s.data.port || 8009 });
      }
    };
    mdns.on("response", onResponse);
    try {
      mdns.query({ questions: [{ name: "_googlecast._tcp.local", type: "PTR" }] });
    } catch {}
    setTimeout(() => {
      try {
        mdns.destroy();
      } catch {}
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

// ── relay ────────────────────────────────────────────────────────────────────
let server = null, port = 0, token = "", allowFile = null, upstreamHeaders = {};

function lanAddress() {
  const nets = os.networkInterfaces();
  const all = [];
  for (const list of Object.values(nets)) for (const n of list || []) if (n.family === "IPv4" && !n.internal) all.push(n.address);
  return all.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) || all[0] || "127.0.0.1";
}

const relayUrl = (base, u) => `${base}/r/${token}?u=${encodeURIComponent(u)}`;

function rewritePlaylist(text, playlistUrl, base) {
  const abs = (u) => {
    try {
      return new URL(u, playlistUrl).toString();
    } catch {
      return u;
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${relayUrl(base, abs(u))}"`);
      return relayUrl(base, abs(line.trim()));
    })
    .join("\n");
}

// Node's HTTP client: unlike fetch it may send Referer / Origin
function upstream(target, headers, redirects = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(target);
    } catch (e) {
      return reject(e);
    }
    const lib = u.protocol === "https:" ? https : http;
    const r = lib.get(u, { headers: { "User-Agent": "Mozilla/5.0", ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(upstream(new URL(res.headers.location, u).toString(), headers, redirects - 1));
      }
      res.finalUrl = u.toString();
      resolve(res);
    });
    r.on("error", reject);
    r.setTimeout(20000, () => r.destroy(new Error("timeout")));
  });
}
const readAll = (res) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => resolve(Buffer.concat(chunks)));
    res.on("error", reject);
  });

async function handleRelay(req, res, base) {
  const u = new URL(req.url, "http://x");
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[1] !== token || !token) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader("Access-Control-Allow-Origin", "*");
  // a downloaded file
  if (parts[0] === "f" && allowFile) {
    const size = fs.statSync(allowFile).size;
    const type = /\.webm$/i.test(allowFile) ? "video/webm" : /\.mkv$/i.test(allowFile) ? "video/x-matroska" : "video/mp4";
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    if (m) {
      const start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
      const end = m[2] === "" || m[1] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
      res.writeHead(206, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      fs.createReadStream(allowFile, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": size });
      fs.createReadStream(allowFile).pipe(res);
    }
    return;
  }
  // a stream URL (playlist, segment, key, subtitle)
  const target = u.searchParams.get("u");
  if (parts[0] !== "r" || !/^https?:\/\//i.test(target || "")) {
    res.writeHead(400).end();
    return;
  }
  try {
    const headers = { ...upstreamHeaders };
    if (req.headers.range) headers.Range = req.headers.range;
    const up = await upstream(target, headers);
    const ctype = up.headers["content-type"] || "";
    const isPlaylist = /mpegurl/i.test(ctype) || /\.m3u8(\?|$)/i.test(target);
    if (isPlaylist) {
      const text = (await readAll(up)).toString("utf8");
      if (text.trimStart().startsWith("#EXTM3U")) {
        const body = rewritePlaylist(text, up.finalUrl || target, base);
        res.writeHead(up.statusCode, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-cache" });
        res.end(body);
        return;
      }
      res.writeHead(up.statusCode, { "Content-Type": ctype || "application/octet-stream" });
      res.end(text);
      return;
    }
    const out = { "Content-Type": ctype || "application/octet-stream" };
    for (const h of ["content-length", "content-range", "accept-ranges"]) if (up.headers[h]) out[h] = up.headers[h];
    res.writeHead(up.statusCode, out);
    req.on("close", () => up.destroy());
    up.pipe(res);
  } catch {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  }
}

function startRelay(host = "0.0.0.0") {
  return new Promise((resolve, reject) => {
    if (server) return resolve();
    server = http.createServer((req, res) => handleRelay(req, res, `http://${host === "127.0.0.1" ? "127.0.0.1" : lanAddress()}:${port}`));
    server.on("error", reject);
    server.listen(0, host, () => {
      port = server.address().port;
      resolve();
    });
  });
}
function stopRelay() {
  try {
    server?.close();
  } catch {}
  server = null;
  token = "";
  allowFile = null;
}

// ── casting ──────────────────────────────────────────────────────────────────
let session = null; // { client, player, device }

function send(state) {
  const w = getWin();
  if (w && !w.isDestroyed()) w.webContents.send("cast-state", state);
}

function stopCast() {
  const s = session;
  session = null;
  try {
    s?.player?.stop?.(() => {});
  } catch {}
  setTimeout(() => {
    try {
      s?.client?.close();
    } catch {}
  }, 500);
  stopRelay();
  send({ state: "idle" });
}

function connect(device) {
  const { Client, DefaultMediaReceiver } = require("castv2-client");
  return new Promise((resolve, reject) => {
    const client = new Client();
    const fail = (e) => {
      try {
        client.close();
      } catch {}
      reject(e);
    };
    client.on("error", (e) => {
      if (session?.client === client) stopCast();
      fail(e);
    });
    client.connect({ host: device.host, port: device.port || 8009 }, () => {
      client.launch(DefaultMediaReceiver, (err, player) => (err ? fail(err) : resolve({ client, player })));
    });
  });
}

async function cast({ device, url, filePath, title, poster, subtitle, startTime = 0, local = false } = {}) {
  if (!device?.host) throw new Error("No device");
  stopCast();
  token = crypto.randomBytes(16).toString("hex");
  await startRelay(local ? "127.0.0.1" : "0.0.0.0");
  const base = `http://${local ? "127.0.0.1" : lanAddress()}:${port}`;
  let contentId, contentType;
  if (filePath) {
    allowFile = fs.realpathSync(filePath);
    contentId = `${base}/f/${token}/${encodeURIComponent(path.basename(allowFile))}`;
    contentType = /\.webm$/i.test(allowFile) ? "video/webm" : "video/mp4";
  } else {
    const meta = getMeta(url) || {};
    upstreamHeaders = {};
    if (meta.referer) upstreamHeaders.Referer = meta.referer;
    if (meta.origin) upstreamHeaders.Origin = meta.origin;
    if (meta.userAgent) upstreamHeaders["User-Agent"] = meta.userAgent;
    contentId = relayUrl(base, url);
    contentType = /\.mp4(\?|$)/i.test(url) ? "video/mp4" : "application/x-mpegURL";
  }
  if (local) return { contentId, contentType }; // self-test of the relay only
  const { client, player } = await connect(device);
  session = { client, player, device };
  player.on("status", (st) => send({ state: st?.playerState === "PAUSED" ? "paused" : st?.playerState === "IDLE" ? "idle" : "playing", device: device.name, currentTime: st?.currentTime }));
  await new Promise((resolve, reject) =>
    player.load(
      {
        contentId,
        contentType,
        streamType: "BUFFERED",
        metadata: {
          type: 0,
          metadataType: 0,
          title: title || "Vidra",
          subtitle: subtitle || "",
          images: poster ? [{ url: poster }] : [],
        },
      },
      { autoplay: true, currentTime: Math.max(0, Number(startTime) || 0) },
      (err) => (err ? reject(err) : resolve()),
    ),
  );
  send({ state: "playing", device: device.name, title });
  return { ok: true };
}

function control(cmd, value) {
  const p = session?.player;
  if (!p) return false;
  const cb = () => {};
  if (cmd === "pause") p.pause(cb);
  else if (cmd === "play") p.play(cb);
  else if (cmd === "seek") p.seek(Math.max(0, Number(value) || 0), cb);
  else if (cmd === "stop") stopCast();
  return true;
}

function register(getMainWindow, { getStreamMeta } = {}) {
  getWin = getMainWindow;
  if (getStreamMeta) getMeta = getStreamMeta;
  ipcMain.handle("cast-discover", () => discover());
  ipcMain.handle("cast-start", async (_, args) => {
    try {
      return await cast(args);
    } catch (e) {
      stopRelay();
      return { ok: false, error: String(e?.message || e) };
    }
  });
  ipcMain.handle("cast-control", (_, { cmd, value } = {}) => control(cmd, value));
}

module.exports = { register, stopCast, _test: { cast, rewritePlaylist, startRelay, stopRelay } };
