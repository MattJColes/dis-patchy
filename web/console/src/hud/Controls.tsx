import { eventsPerSecond, inFlight, useLive, useNow } from "../live/store";

export const MAX_DELIVERIES = 20;
export const MAX_CARS = 20;

/** Live mode sizes road traffic to the real event volume: about one car per two events a second. */
export const liveCars = () => Math.min(MAX_CARS, Math.round(eventsPerSecond() / 2));

function Slider(props: { label: string; hint: string; value: number; shown: number; max: number; live: boolean; onChange(n: number): void }) {
  return (
    <label className="slider">
      <span className="row">
        <span>{props.label}</span>
        <output>
          {props.shown}
          {!props.live && props.shown !== props.value && <small> → {props.value}</small>}
        </output>
      </span>
      <input
        type="range"
        min={0}
        max={props.max}
        value={props.live ? props.shown : props.value}
        disabled={props.live}
        onChange={(e) => props.onChange(Number(e.target.value))}
        aria-valuetext={`${props.shown} ${props.label.toLowerCase()}`}
      />
      <small className="hint">{props.hint}</small>
    </label>
  );
}

/** How busy the village is: deliveries in progress, and the other traffic sharing the roads. */
export function Controls() {
  const mode = useLive((s) => s.mode);
  const orders = useLive((s) => s.orders);
  const { demoOrders, traffic, setDemoOrders, setTraffic } = useLive();
  useNow(1000);
  const live = mode === "live";
  return (
    <section className="panel controls" aria-label="Village controls">
      <h2>How busy</h2>
      <Slider
        label="Deliveries in progress"
        hint={live ? "Orders on their way right now." : "Orders the shops keep in flight at once."}
        value={demoOrders}
        shown={inFlight(orders)}
        max={MAX_DELIVERIES}
        live={live}
        onChange={setDemoOrders}
      />
      <Slider
        label="Other traffic"
        hint={live ? "Sized to the events flowing through the system." : "Other requests sharing the system. More cars, slower deliveries, more jams."}
        value={traffic}
        shown={live ? liveCars() : traffic}
        max={MAX_CARS}
        live={live}
        onChange={setTraffic}
      />
    </section>
  );
}
