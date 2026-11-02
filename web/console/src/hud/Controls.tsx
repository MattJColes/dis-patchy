import { eventsPerSecond, inFlight, useLive, useNow } from "../live/store";
import { TEAL } from "../scene/Packets";
import { ROUTE_COLOR } from "../scene/Village";

export const MAX_DELIVERIES = 20;
export const MAX_CARS = 20;

/** Live mode sizes road traffic to the real event volume: about one car per two events a second. */
export const liveCars = () => Math.min(MAX_CARS, Math.round(eventsPerSecond() / 2));

function Slider(props: { label: string; hint: string; value: number; shown: number; max: number; live: boolean; cruising?: boolean; onChange(n: number): void }) {
  return (
    // The explanation is a tooltip, so the panel stays short enough to sit under the smoke test.
    <label className="slider" title={props.hint}>
      <span className="row">
        <span>{props.label}</span>
        <output>
          {props.shown}
          {!props.live && !props.cruising && props.shown !== props.value && <small> → {props.value}</small>}
        </output>
      </span>
      <input
        type="range"
        min={0}
        max={props.live ? Math.max(props.max, props.shown) : props.max}
        value={props.live ? props.shown : props.value}
        disabled={props.live}
        onChange={(e) => props.onChange(Number(e.target.value))}
        aria-valuetext={props.cruising && !props.live ? `${props.value} cruising cars; ${props.shown} cars including queues` : `${props.shown} ${props.label.toLowerCase()}`}
        aria-description={props.hint}
      />
      {props.cruising && !props.live && <small className="slider-target">Cruising target: {props.value}</small>}
    </label>
  );
}

/** How busy the village is: deliveries in progress, and the other traffic sharing the roads. */
export function Controls() {
  const mode = useLive((s) => s.mode);
  const orders = useLive((s) => s.orders);
  const { demoOrders, traffic, visibleTraffic, setDemoOrders, setTraffic } = useLive();
  useNow(1000);
  const live = mode === "live";
  return (
    <section className="panel controls" aria-label="Village controls">
      <h2>Village pace</h2>
      <Slider
        label="Deliveries in progress"
        hint={live ? "Parcels on their way right now." : "Keep this many parcels on their way."}
        value={demoOrders}
        shown={inFlight(orders)}
        max={MAX_DELIVERIES}
        live={live}
        onChange={setDemoOrders}
      />
      <Slider
        label="Other traffic"
        hint={live ? "Cars in view including queues. Cruising cars follow real event volume." : "Set cruising cars. The current count is cars in view, including queues and town traffic."}
        value={traffic}
        shown={visibleTraffic}
        max={MAX_CARS}
        live={live}
        cruising
        onChange={setTraffic}
      />
      <p className="route-key" aria-label="Route legend">
        <span style={{ ["--c" as string]: ROUTE_COLOR.ok }}>Delivery roads</span>
        <span style={{ ["--c" as string]: TEAL }}>Cloud messages</span>
      </p>
    </section>
  );
}
