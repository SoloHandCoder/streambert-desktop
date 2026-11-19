import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { initI18n } from "./extras/i18n.js";
import { initMotion } from "./extras/motion.js";
import { initAppLock } from "./extras/appLock.js";

initI18n();
initMotion();
initAppLock();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
