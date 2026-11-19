// Watch party UI: a button on movie / show pages, the party panel (start / join,
// people, chat, reactions) and floating reactions over everything.
import { useEffect, useRef, useState } from "react";
import { getParty, joinParty, leaveParty, onParty, sameMedia, sendChat, sendReaction } from "./party.js";
import "./party.css";

const EMOJI = ["😂", "😮", "😍", "👏", "😢", "🔥"];
const openPanel = () => window.dispatchEvent(new Event("streambert:party-open"));

function profileName() {
  try {
    const m = JSON.parse(localStorage.getItem("__sb_profiles") || "null");
    const p = m?.list?.find((x) => x.id === m.current);
    return localStorage.getItem("__sb_party_name") || p?.name || "Me";
  } catch {
    return "Me";
  }
}

function useParty() {
  const [p, setP] = useState(getParty);
  useEffect(() => onParty(setP), []);
  return p;
}

function PartyIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M16 14.2c2.6.2 4.4 1.8 5 4.8" />
    </svg>
  );
}

/** button for the movie / show page */
export function PartyButton() {
  const p = useParty();
  return (
    <button className={`btn btn-secondary${p ? " sbpt-active" : ""}`} onClick={openPanel}>
      <PartyIcon />
      {p ? `Party · ${p.members.length}` : "Watch party"}
    </button>
  );
}

const mediaLabel = (m) => (m ? `${m.title || ""}${m.media_type === "tv" && m.season != null ? ` S${m.season}E${m.episode}` : ""}` : "");

/** mounted once by the app */
export function PartyDock() {
  const p = useParty();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profileName);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const chatRef = useRef(null);
  const [pops, setPops] = useState([]);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const h = (e) => {
      if (openRef.current) return; // the chat is open anyway
      const id = Math.random();
      setPops((a) => [...a.slice(-2), { id, ...e.detail }]);
      setTimeout(() => setPops((a) => a.filter((x) => x.id !== id)), 4500);
    };
    window.addEventListener("streambert:party-message", h);
    return () => window.removeEventListener("streambert:party-message", h);
  }, []);
  useEffect(() => {
    if (open) setPops([]);
  }, [open]);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("streambert:party-open", h);
    return () => window.removeEventListener("streambert:party-open", h);
  }, []);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: 1e9 });
  }, [p?.chat?.length, open]);
  useEffect(() => {
    if (!open) return;
    const prev = window.__sbSheetBack;
    window.__sbSheetBack = () => (setOpen(false), true);
    return () => (window.__sbSheetBack = prev);
  }, [open]);

  const start = async (joinCode) => {
    setErr("");
    setBusy(joinCode ? "join" : "start");
    try {
      localStorage.setItem("__sb_party_name", name.trim() || "Me");
      await joinParty(joinCode || null, name.trim() || "Me");
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy("");
    }
  };

  if (!open) {
    if (!p) return null;
    return (
      <>
        {pops.length > 0 && (
          <div className="sbpt-pops">
            {pops.map((m) => (
              <button key={m.id} className={`sbpt-pop${m.sys ? " sys" : ""}`} onClick={() => setOpen(true)}>
                <span className="sbpt-pop-name" data-no-i18n>
                  {m.host && <span className="sbpt-crown" aria-label="Host">👑</span>}
                  {m.name}
                </span>
                <span className="sbpt-pop-text" data-no-i18n={m.sys ? undefined : true}>{m.text}</span>
              </button>
            ))}
          </div>
        )}
        <button className="sbpt-pill" onClick={() => setOpen(true)} title="Watch party">
          <PartyIcon size={18} />
          <span>{p.members.length}</span>
          {p.isHost && <span className="sbpt-crown" title="You're the host">👑</span>}
          {p.status !== "connected" && <span className="sbpt-dot" />}
        </button>
      </>
    );
  }
  const host = p?.members.find((m) => m.id === p.hostId);

  const elsewhere = p?.remoteMedia && !sameMedia(p.remoteMedia, p.media) ? p.remoteMedia : null;

  return (
    <div className="sbpt-panel" role="dialog" aria-label="Watch party">
      <div className="sbpt-head">
        <PartyIcon size={18} />
        <div className="sbpt-title">
          Watch party
          {p && (
            <div className="sbpt-hostline">
              {p.isHost ? (
                <span className="sbpt-host-tag">👑 You're the host</span>
              ) : host ? (
                <>
                  <span className="sbpt-hosted">Hosted by</span>{" "}
                  <span className="sbpt-host-tag" data-no-i18n>👑 {host.name}</span>
                </>
              ) : null}
            </div>
          )}
        </div>
        <button className="icon-btn sbpt-x" onClick={() => setOpen(false)} aria-label="Close">✕</button>
      </div>

      {!p ? (
        <div className="sbpt-body">
          <div className="sbx-muted" style={{ lineHeight: 1.6, marginBottom: 12 }}>
            Watch together: play, pause and jumping stay in sync, and you can chat. Everyone needs Streambert and the same
            source. Messages are end-to-end encrypted with the party code.
          </div>
          <label className="sbpt-label">Your name</label>
          <input className="sbx-input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary sbpt-wide" disabled={!!busy} onClick={() => start(null)}>
            {busy === "start" ? "Starting…" : "Start a party"}
          </button>
          <div className="sbpt-or">or join one</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="sbx-input"
              placeholder="Party code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && code.trim() && start(code)}
              style={{ letterSpacing: 2, fontWeight: 700 }}
            />
            <button className="btn btn-secondary" disabled={!!busy || !code.trim()} onClick={() => start(code)}>
              {busy === "join" ? "…" : "Join"}
            </button>
          </div>
          {err && <div className="sbpt-err">{err}</div>}
        </div>
      ) : (
        <div className="sbpt-body sbpt-live">
          <div className="sbpt-code-row">
            <div>
              <div className="sbx-muted" style={{ fontSize: 12 }}>Party code</div>
              <div className="sbpt-code" data-no-i18n>{p.code}</div>
            </div>
            <button
              className="btn btn-ghost btn--sm"
              onClick={() => {
                navigator.clipboard?.writeText(p.code).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <button className="btn btn-ghost btn--sm" onClick={() => leaveParty()}>Leave</button>
          </div>
          {p.status !== "connected" && <div className="sbpt-err">Reconnecting…</div>}
          <div className="sbpt-members">
            {[...p.members].sort((a, b) => (b.id === p.hostId) - (a.id === p.hostId)).map((m) => (
              <span key={m.id} className={`sbpt-member${m.me ? " me" : ""}${m.id === p.hostId ? " host" : ""}`} data-no-i18n>
                {m.id === p.hostId && <span className="sbpt-crown">👑</span>}
                {m.name}
                {m.id === p.hostId && <span className="sbpt-host-label">Host</span>}
              </span>
            ))}
          </div>
          {p.members.length < 2 && <div className="sbx-muted" style={{ margin: "6px 0" }}>Send the code to a friend so they can join.</div>}
          {elsewhere && (
            <div className="sbpt-elsewhere">
              <span data-no-i18n>{elsewhere.by}</span>&nbsp;is watching&nbsp;<b data-no-i18n>{mediaLabel(elsewhere)}</b>
              <button
                className="btn btn-primary btn--sm"
                onClick={() => window.__sbNav?.open?.({ id: elsewhere.id, media_type: elsewhere.media_type, title: elsewhere.title, name: elsewhere.title, season: elsewhere.season, episode: elsewhere.episode })}
              >
                Open it
              </button>
            </div>
          )}
          <div className="sbpt-chat" ref={chatRef}>
            {p.chat.map((c, i) =>
              c.sys ? (
                <div key={i} className="sbpt-sys" data-no-i18n>{c.text}</div>
              ) : (
                <div key={i} className={`sbpt-msg${c.me ? " me" : ""}`} data-no-i18n>
                  {!c.me && (
                    <span className="sbpt-who">
                      {c.from === p.hostId && <span className="sbpt-crown">👑</span>}
                      {c.name}
                    </span>
                  )}
                  {c.text}
                </div>
              ),
            )}
          </div>
          <div className="sbpt-emoji">
            {EMOJI.map((e) => (
              <button key={e} onClick={() => sendReaction(e)} aria-label={`React ${e}`}>{e}</button>
            ))}
          </div>
          <form
            className="sbpt-send"
            onSubmit={(e) => {
              e.preventDefault();
              sendChat(text);
              setText("");
            }}
          >
            <input className="sbx-input" placeholder="Message" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
            <button className="btn btn-primary" type="submit" disabled={!text.trim()}>Send</button>
          </form>
        </div>
      )}
    </div>
  );
}

/** floating emoji reactions (mounted once) */
export function PartyReactions() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const h = (e) => {
      const id = Math.random();
      const x = 8 + Math.random() * 28;
      setItems((a) => [...a, { id, x, ...e.detail }]);
      setTimeout(() => setItems((a) => a.filter((i) => i.id !== id)), 2600);
    };
    window.addEventListener("streambert:party-react", h);
    return () => window.removeEventListener("streambert:party-react", h);
  }, []);
  return (
    <div className="sbpt-reactions" aria-hidden="true">
      {items.map((i) => (
        <div key={i.id} className="sbpt-react" style={{ right: `${i.x}%` }}>
          <span className="sbpt-react-emoji">{i.emoji}</span>
          <span className="sbpt-react-name">{i.me ? "" : i.name}</span>
        </div>
      ))}
    </div>
  );
}
