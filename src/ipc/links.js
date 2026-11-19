// streambert:// links (taskbar jump list, other apps) and the Windows jump list.
const { app, ipcMain } = require("electron");

let pending = null;
let getWin = () => null;

const linkFrom = (argv) => (argv || []).find((a) => /^streambert:\/\//i.test(String(a))) || null;

function handleArgv(argv) {
  const link = linkFrom(argv);
  if (!link) return;
  const w = getWin();
  if (w && !w.isDestroyed() && !w.webContents.isLoading()) w.webContents.send("open-link", link);
  else pending = link;
}

function register(getMainWindow) {
  getWin = getMainWindow;
  // only the installed app registers itself (never a dev / test copy)
  if (app.isPackaged) {
    try {
      app.setAsDefaultProtocolClient("streambert");
    } catch {}
  }
  pending = linkFrom(process.argv);
  app.on("open-url", (e, url) => {
    e.preventDefault();
    handleArgv([url]);
  });

  ipcMain.handle("take-pending-link", () => {
    const p = pending;
    pending = null;
    return p;
  });

  ipcMain.handle("set-recent-items", (_, items) => {
    if (process.platform !== "win32" || !app.isPackaged || !Array.isArray(items)) return false;
    const task = (title, url, description) => ({
      type: "task",
      title: String(title).slice(0, 60),
      description: description || String(title).slice(0, 120),
      program: process.execPath,
      args: `"${String(url).replace(/"/g, "")}"`,
      iconPath: process.execPath,
      iconIndex: 0,
    });
    const recent = items
      .filter((i) => i && /^streambert:\/\/open\/(movie|tv)\/\d+/.test(i.url))
      .slice(0, 5)
      .map((i) => task(i.title, i.url, `Continue ${i.title}`));
    try {
      app.setJumpList([
        ...(recent.length ? [{ type: "custom", name: "Continue watching", items: recent }] : []),
        {
          type: "tasks",
          items: [
            task("Search", "streambert://open/search", "Search movies and series"),
            task("Downloads", "streambert://open/downloads", "Open your downloads"),
          ],
        },
      ]);
      return true;
    } catch {
      return false;
    }
  });
}

module.exports = { register, handleArgv };
