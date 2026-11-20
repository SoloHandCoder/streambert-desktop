// App lock for the desktop: a PIN asked when Vidra starts and after it
// was in the background for a while. (The Android app uses fingerprint / phone
// PIN instead.) Only a salted SHA-256 hash of the PIN is stored.
import "./appLock.css";
import { t } from "./i18n.js";

const KEY = "__sb_lock"; // { enabled, salt, hash, timeoutMs }
const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    return {};
  }
};
const write = (v) => localStorage.setItem(KEY, JSON.stringify(v));

async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const getLock = () => {
  const l = read();
  return { enabled: !!l.enabled && !!l.hash, timeoutMs: l.timeoutMs ?? 0 };
};
export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint32Array(4)).join("-");
  write({ ...read(), enabled: true, salt, hash: await hashPin(pin, salt) });
}
export async function checkPin(pin) {
  const l = read();
  return !!l.hash && (await hashPin(pin, l.salt)) === l.hash;
}
export function disableLock() {
  write({ timeoutMs: read().timeoutMs ?? 0 });
}
export function setLockTimeout(ms) {
  write({ ...read(), timeoutMs: ms });
}

let shown = false;
export function showLock() {
  if (shown || !getLock().enabled) return;
  shown = true;
  const el = document.createElement("div");
  el.className = "sb-lock";
  el.innerHTML = `<div class="sb-lock__box">
      <img class="sb-lock__logo" src="./logo.svg" alt="" />
      <div class="sb-lock__title"></div>
      <input class="sb-lock__input" type="password" inputmode="numeric" autocomplete="off" maxlength="12" />
      <div class="sb-lock__msg"></div>
      <button class="btn btn-primary sb-lock__btn" type="button"></button>
    </div>`;
  el.querySelector(".sb-lock__title").textContent = t("Enter your PIN");
  el.querySelector(".sb-lock__btn").textContent = t("Unlock");
  const input = el.querySelector("input");
  const msg = el.querySelector(".sb-lock__msg");
  let tries = 0;
  const attempt = async () => {
    if (!input.value) return;
    if (await checkPin(input.value)) {
      el.classList.add("sb-lock--out");
      setTimeout(() => el.remove(), 250);
      shown = false;
      return;
    }
    tries++;
    input.value = "";
    msg.textContent = t("Wrong PIN");
    el.querySelector(".sb-lock__box").classList.remove("shake");
    void el.offsetWidth;
    el.querySelector(".sb-lock__box").classList.add("shake");
    // slow down guessing
    if (tries >= 5) {
      input.disabled = true;
      setTimeout(() => {
        input.disabled = false;
        input.focus();
      }, 15000);
    }
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && attempt());
  el.querySelector(".sb-lock__btn").addEventListener("click", attempt);
  // nothing behind the lock can be clicked or typed into
  el.addEventListener("keydown", (e) => e.stopPropagation());
  document.body.appendChild(el);
  setTimeout(() => input.focus(), 50);
}

export function initAppLock() {
  if (!getLock().enabled) return;
  showLock();
  let hiddenAt = 0;
  const away = () => (hiddenAt = Date.now());
  const back = () => {
    if (!hiddenAt) return;
    const { enabled, timeoutMs } = getLock();
    if (enabled && Date.now() - hiddenAt >= timeoutMs) showLock();
    hiddenAt = 0;
  };
  document.addEventListener("visibilitychange", () => (document.hidden ? away() : back()));
  window.addEventListener("blur", () => !hiddenAt && getLock().timeoutMs > 0 && away());
  window.addEventListener("focus", back);
}
