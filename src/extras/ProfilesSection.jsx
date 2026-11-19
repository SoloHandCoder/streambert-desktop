// Settings → Profiles (desktop): add, edit, switch and delete profiles.
import { useEffect, useState } from "react";
import {
  COLORS,
  getMeta,
  createProfile,
  updateProfile,
  deleteProfile,
  switchProfile,
  setAskOnStart,
} from "./profiles.js";

function Avatar({ p, size = 44 }) {
  return (
    <span
      className="sb-avatar"
      style={{ width: size, height: size, background: p.color, fontSize: Math.round(size * 0.46) }}
    >
      {(p.name || "?").trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Switch({ value, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!value}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!value)}
      style={{
        background: value ? "var(--red)" : "var(--surface2)",
        border: "1px solid " + (value ? "var(--red)" : "var(--border)"),
        borderRadius: 20,
        width: 44,
        height: 24,
        position: "relative",
        flexShrink: 0,
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.2s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: value ? 22 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 0.2s",
        }}
      />
    </button>
  );
}

const TIMEOUTS = [
  { ms: 0, label: "Immediately" },
  { ms: 60_000, label: "After 1 minute" },
  { ms: 300_000, label: "After 5 minutes" },
  { ms: 900_000, label: "After 15 minutes" },
];

export default function ProfilesSection() {
  const [meta, setMeta] = useState(getMeta);
  const [editing, setEditing] = useState(null); // {id|null, name, color}
  const [msg, setMsg] = useState("");

  const refresh = () => setMeta(getMeta());
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener("streambert:sync-applied", h);
    return () => window.removeEventListener("streambert:sync-applied", h);
  }, []);

  const flash = (t) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 2600);
  };

  const saveEdit = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    if (editing.id) updateProfile(editing.id, { name, color: editing.color });
    else createProfile(name, editing.color);
    setEditing(null);
    refresh();
  };

  const row = { display: "flex", alignItems: "center", gap: 12, padding: "10px 0" };

  return (
    <div style={{ marginBottom: 40 }}>
      <div className="settings-section-title">Profiles</div>
      <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12, lineHeight: 1.6 }}>
        Each profile has its own history, saved list, progress and watched episodes. Settings and downloads are
        shared. Profiles sync with the Android app through Cloud Sync.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {meta.list.map((p) => {
          const cur = p.id === meta.current;
          return (
            <div
              key={p.id}
              style={{
                ...row,
                padding: "10px 12px",
                borderRadius: 10,
                background: cur ? "var(--red-dim)" : "var(--surface2)",
                border: "1px solid " + (cur ? "var(--red)" : "var(--border)"),
              }}
            >
              <Avatar p={p} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>{p.name}</div>
                <div style={{ fontSize: 12, color: cur ? "var(--red)" : "var(--text3)" }}>
                  {cur ? "Watching now" : "Click Switch to use this profile"}
                </div>
              </div>
              {!cur && (
                <button className="btn btn-secondary btn--sm" onClick={() => switchProfile(p.id)}>
                  Switch
                </button>
              )}
              <button
                className="icon-btn"
                aria-label={`Edit ${p.name}`}
                onClick={() => setEditing({ id: p.id, name: p.name, color: p.color })}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              </button>
            </div>
          );
        })}
      </div>

      {editing ? (
        <div style={{ marginTop: 12, padding: 14, borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)" }}>
          <input
            className="apikey-input"
            style={{ marginBottom: 12 }}
            placeholder="Name"
            maxLength={24}
            value={editing.name}
            autoFocus
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && saveEdit()}
          />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setEditing({ ...editing, color: c })}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: c,
                  border: editing.color === c ? "3px solid #fff" : "3px solid transparent",
                  boxShadow: editing.color === c ? "0 0 0 2px " + c : "none",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={saveEdit} disabled={!editing.name.trim()}>
              {editing.id ? "Save" : "Add profile"}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            {editing.id && editing.id !== meta.current && (
              <button
                className="btn btn-ghost"
                style={{ color: "var(--red)", marginLeft: "auto" }}
                onClick={() => {
                  if (confirm(`Delete profile “${editing.name}” and its history?`)) {
                    deleteProfile(editing.id);
                    setEditing(null);
                    refresh();
                  }
                }}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ) : (
        meta.list.length < 8 && (
          <button
            className="btn btn-secondary"
            style={{ marginTop: 12 }}
            onClick={() => setEditing({ id: null, name: "", color: COLORS[meta.list.length % COLORS.length] })}
          >
            + Add profile
          </button>
        )
      )}

      {meta.list.length > 1 && (
        <div style={{ ...row, marginTop: 8 }}>
          <Switch
            value={meta.askOnStart}
            label="Ask who's watching"
            onChange={(v) => {
              setAskOnStart(v);
              refresh();
            }}
          />
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>Ask “Who's watching?” on start</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>Shows the profile picker when the app opens.</div>
          </div>
        </div>
      )}

      {msg && <div style={{ marginTop: 10, fontSize: 13, color: "var(--red)" }}>{msg}</div>}
    </div>
  );
}
