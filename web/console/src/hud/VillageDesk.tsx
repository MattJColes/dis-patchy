import { inFlight, trouble, useLive, useNow } from "../live/store";
import { smokeSteps } from "../live/demo";
import { nodes } from "../topology";
import { useCompactView } from "../useCompactView";
import { SmokePanel } from "../smoke/SmokePanel";
import { Controls } from "./Controls";
import { OrderTimeline } from "./OrderTimeline";

/** The same mounted controls become a disclosure on small screens. */
export function VillageDesk() {
  const compact = useCompactView();
  const orders = useLive((s) => s.orders);
  const traffic = useLive((s) => s.visibleTraffic);
  const smoke = useLive((s) => s.smoke);
  const now = useNow(1000);
  const running = smoke && !smoke.done;
  const incidents = Object.values(orders).filter((order) => trouble(order, now)).length
    + (smoke?.steps.some((step) => step.status === "failed") ? 1 : 0);
  return (
    <details className="village-desk" open={!compact}>
      <summary className="desk-toggle">
        <span>Village desk <small>{inFlight(orders)} parcels · {traffic} cars</small></span>
        {incidents > 0 && <span className="desk-incidents" role="status">🚨 {incidents} incident{incidents > 1 ? "s" : ""}</span>}
        <span className="desk-progress">
          {running && `🧪 ${smoke.steps.filter((step) => step.status === "passed").length}/${smoke.steps[0]?.total ?? smokeSteps.length} `}
          <span className="desk-action"><span className="desk-open-label">Open</span><span className="desk-close-label">Close</span></span>
        </span>
      </summary>
      <div className="desk-content">
        <SmokePanel />
        <OrderTimeline />
        <Controls />
        <section className="service-key" aria-label="Cloud services">
          <h2>Above the village</h2>
          {Object.values(nodes).filter((node) => !node.actor).map((node) => (
            <span key={node.id}><i style={{ background: node.color }} aria-hidden="true" />{node.label}</span>
          ))}
        </section>
      </div>
    </details>
  );
}
