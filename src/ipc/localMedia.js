// sbmedia:// — lets the built-in player (public/sb-player.html) read downloaded
// videos and their subtitles from disk, with seeking (Range) support.
//   sbmedia://file/C%3A/Users/me/Videos/Movie.mp4   (each path part URL-encoded)
// Only video / subtitle / HLS files are served; nothing else on disk.
const { protocol, net } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const SCHEME = "sbmedia";
const ALLOWED = new Set([
  ".mp4", ".m4v", ".mkv", ".webm", ".mov", ".ts", ".m2ts", ".m3u8", ".m4s", ".aac", ".m4a",
  ".vtt", ".srt",
]);
const TYPES = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mkv": "video/x-matroska", ".webm": "video/webm",
  ".mov": "video/quicktime", ".ts": "video/mp2t", ".m2ts": "video/mp2t", ".m3u8": "application/vnd.apple.mpegurl",
  ".m4s": "video/iso.segment", ".aac": "audio/aac", ".m4a": "audio/mp4", ".vtt": "text/vtt", ".srt": "text/plain",
};

/** call before app "ready" */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

function toPath(url) {
  const u = new URL(url);
  const parts = u.pathname.split("/").map((p) => decodeURIComponent(p));
  let p = parts.slice(1).join("/"); // drop the leading ""
  if (process.platform !== "win32" && !p.startsWith("/")) p = "/" + p;
  return path.normalize(p);
}

/** call after app "ready" */
function registerHandler() {
  protocol.handle(SCHEME, async (req) => {
    try {
      const p = toPath(req.url);
      const ext = path.extname(p).toLowerCase();
      if (!ALLOWED.has(ext)) return new Response("Not allowed", { status: 403 });
      const real = fs.realpathSync(p);
      if (!ALLOWED.has(path.extname(real).toLowerCase())) return new Response("Not allowed", { status: 403 });
      const size = fs.statSync(real).size;
      const type = TYPES[ext] || "application/octet-stream";
      const range = req.headers.get("range");
      const m = range && /bytes=(\d*)-(\d*)/.exec(range);
      if (m && size > 0) {
        let start = m[1] === "" ? Math.max(0, size - Number(m[2] || 0)) : Number(m[1]);
        let end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
        if (start > end || start >= size) {
          return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        }
        const stream = fs.createReadStream(real, { start, end });
        return new Response(require("stream").Readable.toWeb(stream), {
          status: 206,
          headers: {
            "Content-Type": type,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Accept-Ranges": "bytes",
          },
        });
      }
      const res = await net.fetch(pathToFileURL(real).toString());
      return new Response(res.body, {
        status: 200,
        headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

module.exports = { registerScheme, registerHandler };
