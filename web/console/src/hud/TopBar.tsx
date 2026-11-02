import { motion } from "motion/react";
import { clock, useLive, useNow, type Mode } from "../live/store";
import { worldAt } from "../live/world";

const weatherText = { clear: "", rain: "Rain", storm: "Storm" };

/** The village clock and weather, and whether demo deliveries are running slow. */
function SkyChip({ live }: { live: boolean }) {
  useNow(1000);
  const w = worldAt(clock(), live);
  const hh = Math.floor(w.hour);
  const mm = Math.floor((w.hour - hh) * 60);
  // The icon is the sky you'd see: rain trumps sun, night trumps a clear sky.
  const icon = w.weather === "storm" ? "⛈️" : w.weather === "rain" ? "🌧️" : w.daylight > 0.15 ? "☀️" : "🌙";
  const slow = !live && w.slow > 1;
  return (
    <span className="sky" title={live ? "Your local time" : "Simulated time and weather"}>
      {icon} {String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}
      {weatherText[w.weather] && <span> · {weatherText[w.weather]}</span>}
      {w.peak && <span> · 🚦 Peak hour</span>}
      {slow && <strong> · deliveries slower</strong>}
    </span>
  );
}

const connectionText = { offline: "Offline", connecting: "Connecting", live: "Live", error: "Disconnected" };

export function TopBar(props: { email?: string; liveAvailable: boolean; onMode(mode: Mode): void; onSignIn(): void; onSignOut(): void }) {
  const mode = useLive((s) => s.mode);
  const connection = useLive((s) => s.connection);
  const status = mode === "demo" ? "demo" : connection;
  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M8 18h24v17H8z" fill="#f3dfb8" />
          <path d="M5 18 20 5l15 13z" fill="#bd6c49" />
          <path d="M8 18h24v17H8zM5 18 20 5l15 13z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M17 25h7v10h-7z" fill="#427d78" />
          <path d="M11 23h4v5h-4zM27 23h3v5h-3z" fill="#fffaf0" />
        </svg>
        <div>
          <h1>dis-patchy</h1>
          <p>The village delivery desk</p>
        </div>
      </div>

      <div className="mode" role="tablist" aria-label="Data source">
        {(["demo", "live"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? "on" : ""}
            onClick={() => props.onMode(m)}
            disabled={m === "live" && !props.liveAvailable}
            title={m === "live" && !props.liveAvailable ? "Deploy DisPatchy-Console to watch the real system" : undefined}
          >
            {mode === m && <motion.span layoutId="mode-pill" className="pill" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
            <span className="label">{m === "demo" ? "Demo" : "Live"}</span>
          </button>
        ))}
      </div>

      <div className="right">
        <SkyChip live={mode === "live"} />
        <span className={`status ${status}`}>
          <span className="dot" />
          {status === "demo" ? "Demo village" : connectionText[connection]}
        </span>
        {props.email ? (
          <button className="ghost" onClick={props.onSignOut} title="Sign out">
            {props.email}
          </button>
        ) : (
          props.liveAvailable && (
            <button className="ghost" onClick={props.onSignIn}>
              Sign in
            </button>
          )
        )}
      </div>
    </header>
  );
}
