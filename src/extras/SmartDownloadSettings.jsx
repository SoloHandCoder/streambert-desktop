// Settings → Downloads: smart downloads + storage limit (desktop)
import { useEffect, useState } from "react";
import { getAutoNext, setAutoNext, getStorageLimitGB, setStorageLimitGB } from "./smartDownloads.js";

function Chips({ options, value, onPick }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          className={"btn btn--sm " + (value === v ? "btn-primary" : "btn-ghost")}
          onClick={() => onPick(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function SmartDownloadSettings() {
  const [next, setNext] = useState(getAutoNext);
  const [limit, setLimit] = useState(getStorageLimitGB);
  const [used, setUsed] = useState(null);
  useEffect(() => {
    window.electron
      ?.getDownloadsSize?.()
      .then((r) => setUsed(r?.bytes ?? null))
      .catch(() => {});
  }, []);
  const gb = (b) => (b / 1e9 >= 10 ? Math.round(b / 1e9) : (b / 1e9).toFixed(1)) + " GB";
  return (
    <div style={{ marginBottom: 40, maxWidth: 680 }}>
      <div className="settings-section-title">Smart downloads</div>
      <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.6 }}>
        When you finish an episode, download the next ones of that show automatically, using the source you
        watch with. Needs the download folder and downloader set above.
      </div>
      <Chips
        options={[[0, "Off"], [1, "Next 1"], [2, "Next 2"], [3, "Next 3"]]}
        value={next}
        onPick={(v) => {
          setAutoNext(v);
          setNext(v);
        }}
      />
      <div className="settings-section-title" style={{ marginTop: 26 }}>Storage limit</div>
      <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.6 }}>
        New downloads (and smart downloads) stop once your downloads take up this much space.
        {used != null && ` Downloads use ${gb(used)} right now.`}
      </div>
      <Chips
        options={[[0, "No limit"], [10, "10 GB"], [25, "25 GB"], [50, "50 GB"], [100, "100 GB"], [250, "250 GB"], [500, "500 GB"]]}
        value={limit}
        onPick={(v) => {
          setStorageLimitGB(v);
          setLimit(v);
        }}
      />
    </div>
  );
}
