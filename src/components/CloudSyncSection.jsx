// Settings → Cloud Sync: sync history, saved titles, progress and watched
// episodes with the Streambert Android app through a private GitHub Gist.
import { useEffect, useState } from "react";
import { connect, disconnect, getStatus, onStatus, setAuto, syncNow } from "../sync/cloudSync";

function ago(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=gist&description=Streambert%20sync";

function Toggle({ value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        background: value ? "var(--red)" : "var(--surface2)",
        border: "1px solid " + (value ? "var(--red)" : "var(--border)"),
        borderRadius: 20,
        width: 40,
        height: 22,
        cursor: "pointer",
        position: "relative",
        flexShrink: 0,
        transition: "background 0.2s, border-color 0.2s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s",
        }}
      />
    </button>
  );
}

export default function CloudSyncSection() {
  const [st, setSt] = useState(getStatus);
  const [tok, setTok] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [, tick] = useState(0);

  useEffect(() => onStatus(setSt), []);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);

  const doConnect = async () => {
    setBusy(true);
    setErr("");
    try {
      await connect(tok);
      setTok("");
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
      setSt(getStatus());
    }
  };

  const shownError = err || st.lastError;

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">GitHub Gist sync</div>
      <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16, lineHeight: 1.6, maxWidth: 680 }}>
        Keeps every profile's history, saved titles, progress, watched episodes, ratings, lists and watch stats in sync with the Streambert Android app and
        your other computers. Everything is stored in a private (secret) Gist on your own GitHub account; your token
        is stored encrypted on this computer.
      </div>

      {!st.connected ? (
        <>
          <ol style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.8, paddingLeft: 20, marginBottom: 14 }}>
            <li>
              Create a token with only the <b>gist</b> permission:{" "}
              <a
                href={TOKEN_URL}
                onClick={(e) => {
                  e.preventDefault();
                  window.electron?.openExternal?.(TOKEN_URL);
                }}
                style={{ color: "var(--red)" }}
              >
                open GitHub ↗
              </a>
            </li>
            <li>Paste it below and click Connect.</li>
            <li>Use the same GitHub account on your phone (Settings → Profiles &amp; Privacy → Cloud sync).</li>
          </ol>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="apikey-input"
              style={{ flex: 1, minWidth: 260, marginBottom: 0 }}
              type="password"
              autoComplete="off"
              placeholder="GitHub token (ghp_… or github_pat_…)"
              value={tok}
              onChange={(e) => setTok(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && tok.trim() && doConnect()}
            />
            <button className="btn btn-primary" disabled={busy || !tok.trim()} onClick={doConnect}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "14px 16px",
              borderRadius: 10,
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              marginBottom: 14,
              maxWidth: 680,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: st.lastError ? "#f2994a" : "#4caf50",
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: "var(--text)" }}>Connected as {st.login}</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                {st.syncing ? "Syncing…" : `Last synced ${ago(st.lastSync)}`}
              </div>
            </div>
            <button className="btn btn-secondary" disabled={st.syncing} onClick={() => syncNow()}>
              Sync now
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                if (confirm("Disconnect cloud sync on this computer? Your data stays here and in the Gist.")) {
                  disconnect();
                }
              }}
            >
              Disconnect
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Toggle value={st.auto} onChange={(v) => setAuto(v)} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>Sync automatically</div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                On start, every 5 minutes, and when you minimize or close Streambert.
              </div>
            </div>
          </div>
        </>
      )}
      {shownError && <div style={{ marginTop: 12, fontSize: 13, color: "var(--red)" }}>{shownError}</div>}
    </div>
  );
}
