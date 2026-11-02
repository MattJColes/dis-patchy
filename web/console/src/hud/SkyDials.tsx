import type { PointerEvent } from "react";
import { clock, sceneWorldAt, useLive, useNow } from "../live/store";
import type { Weather } from "../live/world";
import { useCompactView } from "../useCompactView";

const weatherChoices: { value: Weather; label: string; icon: string }[] = [
  { value: "clear", label: "Clear", icon: "☀️" },
  { value: "rain", label: "Rain", icon: "🌧️" },
  { value: "storm", label: "Storm", icon: "⛈️" },
];

/** One clock face for both reading and setting the scene's 24-hour day. */
export function SkyDials() {
  const compact = useCompactView();
  const { mode, sceneHour, sceneWeather, setSceneHour, setSceneWeather } = useLive();
  useNow(1000);
  const w = sceneWorldAt(clock(), mode === "live");
  const minutes = Math.floor(w.hour * 60);
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  function turnClock(e: PointerEvent<HTMLInputElement>) {
    const bounds = e.currentTarget.getBoundingClientRect();
    const angle = Math.atan2(e.clientX - bounds.left - bounds.width / 2, -(e.clientY - bounds.top - bounds.height / 2));
    const hour = ((angle / (Math.PI * 2) + 1) % 1) * 24;
    setSceneHour((Math.round(hour * 4) % 96) / 4);
  }
  return (
    <details className="sky-picker" open={!compact}>
      <summary className="sky-summary">{w.daylight < 0.15 ? "🌙" : "☀️"} {time} · {weatherChoices.find((choice) => choice.value === w.weather)!.label}<span aria-hidden="true">⌄</span></summary>
    <div className="sky-dials" aria-label={mode === "live" ? "Scene appearance only; no real weather feed" : "Simulated time and weather"}>
      <div className="sky-dial">
        <span className="dial-heading">Scene time</span>
        <div className="clock-face dial-face">
          <svg viewBox="0 0 80 80" aria-hidden="true">
            {[0, 6, 12, 18].map((hour) => (
              <g key={hour} transform={`rotate(${hour * 15} 40 40)`}>
                <path d="M40 6v5" stroke="currentColor" strokeWidth="2" />
              </g>
            ))}
            <text x="40" y="22">0</text><text x="62" y="43">6</text>
            <text x="40" y="65">12</text><text x="18" y="43">18</text>
            <path d="M40 40V15" transform={`rotate(${w.hour * 15} 40 40)`} stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="40" cy="40" r="4" fill="var(--orange)" />
          </svg>
          <input
            type="range" min="0" max="1425" step="15" value={Math.round(minutes / 15) * 15 % 1440}
            aria-label="Scene time" aria-valuetext={time}
            aria-description="24-hour clock. Drag the hand or use arrow keys. Changes the scene, never event timestamps."
            onChange={(e) => setSceneHour(Number(e.target.value) / 60)}
            onPointerDown={(e) => { e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); turnClock(e); }}
            onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) turnClock(e); }}
          />
        </div>
        <output className="dial-value" aria-live="off">{time}</output>
        <div className="dial-actions">
          <button aria-label="Set daytime" title="Daytime" aria-pressed={sceneHour === 12} onClick={() => setSceneHour(12)}>☀️</button>
          <button aria-label="Set nighttime" title="Nighttime" aria-pressed={sceneHour === 0} onClick={() => setSceneHour(0)}>🌙</button>
          <button className="dial-reset" aria-label="Reset scene time" aria-pressed={sceneHour === undefined} onClick={() => setSceneHour(undefined)}>Auto</button>
        </div>
      </div>
      <div className="sky-dial">
        <span className="dial-heading">Scene sky</span>
        <div className="weather-face dial-face" role="group" aria-label="Scene weather">
          {weatherChoices.map(({ value, label, icon }) => (
            <button key={value} className={`weather-${value}`} aria-label={`Set ${label.toLowerCase()} weather`}
              aria-pressed={w.weather === value} title={label} onClick={() => setSceneWeather(value)}>
              <span aria-hidden="true">{value === "clear" && w.daylight < 0.15 ? "🌙" : icon}</span>
            </button>
          ))}
        </div>
        <output className="dial-value">{weatherChoices.find((choice) => choice.value === w.weather)!.label}</output>
        <div className="dial-actions">
          <button className="dial-reset" aria-label="Reset scene weather" aria-pressed={sceneWeather === undefined} onClick={() => setSceneWeather(undefined)}>Auto</button>
        </div>
      </div>
      <small className="sky-context">
        {mode === "live" ? "Scene only · no weather feed" : `${w.peak ? "Peak hour · " : ""}${w.slow > 1 ? "Deliveries slower" : "Demo sky"}`}
      </small>
    </div>
    </details>
  );
}
