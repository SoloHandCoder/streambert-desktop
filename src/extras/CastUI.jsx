// Chromecast UI (desktop): a "Cast to TV" button for the in-app players, the
// device picker, and a small "Casting to …" bar with play / pause / stop.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./cast.css";

const IMG = (p) => (p ? `https://image.tmdb.org/t/p/w500${p}` : null);

function CastIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
      <line x1="2" y1="20" x2="2.01" y2="20" />
    </svg>
  );
}

let pickerRoot = null;
/** what = { url } or { filePath }, plus title, subtitle, poster_path, startTime */
export function openCastPicker(what) {
  if (!window.electron?.castDiscover) return;
  const host = document.createElement("div");
  document.body.appendChild(host);
  pickerRoot?.unmount();
  pickerRoot = createRoot(host);
  const close = () => {
    pickerRoot?.unmount();
    pickerRoot = null;
    host.remove();
  };
  pickerRoot.render(<Picker what={what} onClose={close} />);
}

function Picker({ what, onClose }) {
  const [devices, setDevices] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState("");
  const scan = () => {
    setDevices(null);
    window.electron.castDiscover().then(setDevices).catch(() => setDevices([]));
  };
  useEffect(() => {
    scan();
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async (d) => {
    setBusy(d.id);
    setErr("");
    const r = await window.electron.castStart({
      device: d,
      url: what.url,
      filePath: what.filePath,
      title: what.title,
      subtitle: what.subtitle,
      poster: IMG(what.poster_path),
      startTime: what.startTime || 0,
    });
    setBusy(null);
    if (r?.ok) {
      what.onStarted?.();
      onClose();
    } else setErr(r?.error ? `Couldn't cast: ${r.error}` : "Couldn't cast to that device.");
  };
  return (
    <div className="sbx-sheet-overlay" onClick={onClose}>
      <div className="sbx-sheet sbc-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Cast to TV">
        <div className="sbx-sheet-title">Cast to TV</div>
        {devices === null && <div className="sbx-muted sbc-scan"><span className="sbc-dot" /> Looking for Chromecast devices…</div>}
        {devices?.length === 0 && (
          <div className="sbx-muted" style={{ lineHeight: 1.6 }}>
            No Chromecast or Google TV found. Make sure it's on and on the same Wi-Fi as this computer. If Windows asks,
            allow Streambert on private networks.
          </div>
        )}
        <div className="sbx-list-rows">
          {(devices || []).map((d) => (
            <button key={d.id} className="sbx-list-row" disabled={!!busy} onClick={() => start(d)}>
              <CastIcon size={18} />
              <span className="sbx-list-name">{d.name}</span>
              <span className="sbx-muted">{busy === d.id ? "Connecting…" : ""}</span>
            </button>
          ))}
        </div>
        {err && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 6 }}>{err}</div>}
        <div className="sbx-row-btns" style={{ marginTop: 12 }}>
          <button className="btn btn-ghost" onClick={scan} disabled={devices === null}>Search again</button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** Player overlay button. getWhat() returns the stream to cast, or null if none yet. */
export function CastButton({ getWhat, className = "player-overlay-btn" }) {
  const [hint, setHint] = useState("");
  if (!window.electron?.castDiscover) return null;
  return (
    <button
      className={className}
      title={hint || "Cast to TV"}
      onClick={async () => {
        const w = await getWhat();
        if (!w) {
          setHint("Start the video first, then cast");
          setTimeout(() => setHint(""), 3000);
          return;
        }
        openCastPicker(w);
      }}
    >
      <CastIcon />
    </button>
  );
}

/** "Casting to …" bar (mounted once by the app) */
export function CastBar() {
  const [st, setSt] = useState({ state: "idle" });
  useEffect(() => window.electron?.onCastState?.(setSt), []);
  if (!st || st.state === "idle") return null;
  const ctl = (cmd) => window.electron.castControl(cmd);
  return (
    <div className="sbc-bar" role="status">
      <CastIcon size={18} />
      <div className="sbc-bar__text">
        <div className="sbc-bar__title">{st.title || "Casting"}</div>
        <div className="sbx-muted">Casting to {st.device || "TV"}</div>
      </div>
      <button className="btn btn-ghost btn--sm" onClick={() => ctl(st.state === "paused" ? "play" : "pause")}>
        {st.state === "paused" ? "Play" : "Pause"}
      </button>
      <button className="btn btn-ghost btn--sm" onClick={() => ctl("stop")}>Stop</button>
    </div>
  );
}
