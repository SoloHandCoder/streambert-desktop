import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { initI18n } from "./extras/i18n.js";
import { initMotion } from "./extras/motion.js";
import { initAppLock } from "./extras/appLock.js";
import { initPeople } from "./extras/people.js";
import { initReminders } from "./extras/reminders.js";
import { secureStorage } from "./utils/storage";

initI18n();
initMotion();
initAppLock();
const tmdbKey = async () => (await secureStorage.get("apikey")) || "";
initPeople(tmdbKey);
initReminders(tmdbKey);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
