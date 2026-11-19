// Small main-process helpers for the extras: Trakt requests (no CORS in the
// renderer) and saving the stats card image.
const { app, ipcMain, dialog, BrowserWindow } = require("electron");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

function allowedTrakt(url) {
  if (/^https:\/\/api\.trakt\.tv\//.test(url)) return true;
  // local mock server, only in a development / test copy
  return !app.isPackaged && /^http:\/\/127\.0\.0\.1:\d+\//.test(url);
}

function request({ method = "GET", url, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const data = body != null ? Buffer.from(String(body)) : null;
    const req = lib.request(u, { method, headers: { ...headers, ...(data ? { "Content-Length": data.length } : {}) } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, data: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout")));
    if (data) req.write(data);
    req.end();
  });
}

function register() {
  ipcMain.handle("trakt-fetch", async (_, args = {}) => {
    if (!allowedTrakt(String(args.url || ""))) throw new Error("blocked");
    return request(args);
  });
  ipcMain.handle("save-image", async (e, { dataUrl, name } = {}) => {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
    if (!m) return { ok: false };
    const win = BrowserWindow.fromWebContents(e.sender);
    const safe = String(name || "streambert.png").replace(/[^A-Za-z0-9._-]/g, "_");
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath("pictures"), safe),
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, Buffer.from(m[1], "base64"));
    return { ok: true, path: r.filePath };
  });
}

module.exports = { register };
