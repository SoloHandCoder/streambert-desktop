// Watch party: watch together with friends on other phones / computers.
// Play, pause and seeking stay in sync; there's a small chat and reactions.
//
// Messages go through a free public MQTT server (several, with fallback), end-
// to-end encrypted: the AES-GCM key is derived from the room code (PBKDF2), the
// topic is a hash of the code. The server only ever sees random-looking bytes.
// mqtt.js is loaded only when a party starts.

const BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt", "wss://test.mosquitto.org:8081/mqtt"];
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const EVT = "streambert:party";

let S = null; // { code, client, key, topic, me, name, members: Map, chat: [], media, applying, last }
const listeners = new Set();
const emit = () => {
  const st = getParty();
  listeners.forEach((f) => f(st));
  window.dispatchEvent(new CustomEvent(EVT, { detail: st }));
};
export const onParty = (f) => (listeners.add(f), () => listeners.delete(f));
export function getParty() {
  if (!S) return null;
  return {
    code: S.code,
    me: S.me,
    name: S.name,
    status: S.status,
    members: [...S.members.values()].sort((a, b) => a.joinedAt - b.joinedAt),
    chat: S.chat.slice(-100),
    media: S.media,
    remoteMedia: S.remoteMedia,
  };
}

export function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(10));
  const s = [...r].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
const cleanCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function derive(code) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(cleanCode(code)), "PBKDF2", false, ["deriveKey", "deriveBits"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("streambert-party-v1"), iterations: 150000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode("streambert-party-topic"), iterations: 1000, hash: "SHA-256" }, base, 128);
  const topic = "sbparty/" + [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { key, topic };
}
async function seal(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, S.key, new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
async function open(buf) {
  const b = new Uint8Array(buf);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, S.key, b.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

function send(msg) {
  if (!S?.client?.connected) return;
  seal({ ...msg, from: S.me, name: S.name, at: Date.now() })
    .then((data) => S?.client?.publish(S.topic, data, { qos: 0 }))
    .catch(() => {});
}

async function connect(broker) {
  const { default: mqtt } = await import("mqtt");
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(broker, { clientId: "sb_" + Math.random().toString(16).slice(2, 12), clean: true, connectTimeout: 8000, reconnectPeriod: 3000, keepalive: 30 });
    const t = setTimeout(() => {
      client.end(true);
      reject(new Error("timeout"));
    }, 9000);
    client.once("connect", () => {
      clearTimeout(t);
      resolve(client);
    });
    client.once("error", (e) => {
      clearTimeout(t);
      client.end(true);
      reject(e);
    });
  });
}

/** start a new party (code = null) or join one */
export async function joinParty(code, name) {
  await leaveParty();
  code = code ? cleanCode(code) : cleanCode(newCode());
  if (code.length < 8) throw new Error("That code looks too short.");
  const pretty = `${code.slice(0, 5)}-${code.slice(5)}`;
  const { key, topic } = await derive(code);
  S = { code: pretty, key, topic, me: Math.random().toString(36).slice(2, 10), name: (name || "Guest").slice(0, 24), members: new Map(), chat: [], status: "connecting", media: null, remoteMedia: null, applyUntil: 0 };
  S.members.set(S.me, { id: S.me, name: S.name, joinedAt: Date.now(), me: true });
  emit();
  let client = null, lastErr = null;
  for (const b of BROKERS) {
    try {
      client = await connect(b);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!S) return null;
  if (!client) {
    S = null;
    emit();
    throw new Error("Couldn't reach the watch party server. Check your connection and try again." + (lastErr ? "" : ""));
  }
  S.client = client;
  S.status = "connected";
  client.on("message", (topic, payload) => {
    if (!S || topic !== S.topic) return;
    open(payload)
      .then(onMessage)
      .catch(() => {}); // not ours / wrong key
  });
  client.on("reconnect", () => S && ((S.status = "reconnecting"), emit()));
  client.on("connect", () => {
    if (!S) return;
    S.status = "connected";
    client.subscribe(S.topic);
    send({ type: "hello", media: S.media });
    emit();
  });
  client.subscribe(S.topic, { qos: 0 });
  send({ type: "hello", media: S.media });
  S.ping = setInterval(() => {
    send({ type: "ping", media: S?.media, state: S?.lastState || null });
    // members that went quiet are gone
    const now = Date.now();
    for (const [id, m] of S.members) if (!m.me && now - (m.seenAt || 0) > 45000) S.members.delete(id);
    emit();
  }, 15000);
  emit();
  return getParty();
}

export async function leaveParty() {
  if (!S) return;
  const s = S;
  send({ type: "bye" });
  clearInterval(s.ping);
  S = null;
  setTimeout(() => {
    try {
      s.client?.end(true);
    } catch {}
  }, 300);
  emit();
}

function addChat(entry) {
  S.chat.push(entry);
  if (S.chat.length > 200) S.chat.splice(0, S.chat.length - 200);
}

let applyHandler = null;
/** the player registers how to apply remote play / pause / seek */
export const setPartyPlayer = (fn) => (applyHandler = fn);

function onMessage(m) {
  if (!S || !m || m.from === S.me) return;
  const known = S.members.get(m.from);
  S.members.set(m.from, { id: m.from, name: String(m.name || "Guest").slice(0, 24), joinedAt: known?.joinedAt || m.at || Date.now(), seenAt: Date.now() });
  if (m.media) S.remoteMedia = { ...m.media, by: m.name };
  switch (m.type) {
    case "hello":
      if (!known) addChat({ sys: true, text: `${m.name} joined`, at: Date.now() });
      send({ type: "ping", media: S.media, state: S.lastState || null }); // let them know we're here
      break;
    case "bye":
      S.members.delete(m.from);
      addChat({ sys: true, text: `${m.name} left`, at: Date.now() });
      break;
    case "chat":
      addChat({ from: m.from, name: m.name, text: String(m.text || "").slice(0, 500), at: m.at });
      break;
    case "react":
      window.dispatchEvent(new CustomEvent("streambert:party-react", { detail: { emoji: String(m.emoji || "").slice(0, 4), name: m.name } }));
      break;
    case "sync":
      if (!sameMedia(m.media, S.media)) break; // they're watching something else
      // apply, and ignore our own player's reaction to it for a moment
      S.applyUntil = Date.now() + 2500;
      applyHandler?.({ playing: !!m.playing, t: Number(m.t) + (m.playing ? Math.max(0, (Date.now() - m.at) / 1000) : 0) });
      addChat({ sys: true, text: `${m.name} ${m.reason === "seek" ? "jumped to " + fmt(m.t) : m.playing ? "pressed play" : "paused"}`, at: Date.now() });
      break;
  }
  emit();
}

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + ":" + String(mm).padStart(2, "0") : mm) + ":" + String(ss).padStart(2, "0");
};
const mediaKey = (x) => (x ? `${x.media_type}_${x.id}_${x.season ?? ""}_${x.episode ?? ""}` : "");
export const sameMedia = (a, b) => !!a && !!b && mediaKey(a) === mediaKey(b);

export function sendChat(text) {
  if (!S || !String(text).trim()) return;
  const t = String(text).trim().slice(0, 500);
  addChat({ from: S.me, name: S.name, text: t, at: Date.now(), me: true });
  send({ type: "chat", text: t });
  emit();
}
export function sendReaction(emoji) {
  if (!S) return;
  send({ type: "react", emoji });
  window.dispatchEvent(new CustomEvent("streambert:party-react", { detail: { emoji, name: S.name, me: true } }));
}

/**
 * The player calls this about every second with what it's showing.
 * media: { id, media_type, title, season?, episode? } | null; state: { playing, t } | null
 */
export function reportPlayer(media, state) {
  if (!S) return;
  if (mediaKey(media) !== mediaKey(S.media)) {
    S.media = media || null;
    send({ type: "ping", media: S.media });
    emit();
  }
  if (!state || !media) {
    S.lastState = null;
    return;
  }
  const now = Date.now();
  const prev = S.lastState;
  S.lastState = { ...state, at: now };
  if (now < S.applyUntil) return; // that change came from the party
  if (!prev) return;
  const expected = prev.playing ? prev.t + (now - prev.at) / 1000 : prev.t;
  let reason = null;
  if (state.playing !== prev.playing) reason = state.playing ? "play" : "pause";
  else if (Math.abs(state.t - expected) > 4) reason = "seek";
  if (reason) send({ type: "sync", media, playing: state.playing, t: state.t, reason });
}
