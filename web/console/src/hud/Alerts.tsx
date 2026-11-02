import { trouble, useLive, useNow, type Order } from "../live/store";

// What the customer would notice, not which part of the system went quiet.
const stuck: Partial<Record<Order["stage"], string>> = {
  Placed: "hasn't been sent out to couriers",
  Offered: "is waiting for a courier to take the job",
  Assigned: "hasn't left the shop",
  "En route": "has stopped on its way to the customer",
};

function line(o: Order, now: number) {
  const id = o.id.slice(0, 8);
  if (o.stage === "Failed") return o.driverId ? `🔥 Order ${id} won't arrive: the delivery was abandoned` : `🔥 Order ${id} won't arrive: no courier took the job`;
  const icon = trouble(o, now) === "burning" ? "🔥" : "🚧";
  return `${icon} Order ${id} ${stuck[o.stage]} (${Math.round((now - o.seenAt) / 1000)}s)`;
}

/** The siren: every order in trouble, plus a failed smoke run. */
export function Alerts() {
  const orders = useLive((s) => s.orders);
  const smoke = useLive((s) => s.smoke);
  const now = useNow();

  const lines = Object.values(orders)
    .filter((o) => trouble(o, now))
    .map((o) => line(o, now));
  const failedStep = smoke?.steps.find((s) => s.status === "failed");
  if (failedStep) lines.unshift(`💥 The test delivery failed while ${failedStep.step.toLowerCase()}`);
  if (lines.length === 0) return null;

  return (
    <>
      <div className="siren" aria-hidden />
      <section className="alerts" aria-label="Incidents">
        {/* Only the count is live, so the ticking timers aren't read out every second. */}
        <h2 role="alert">
          🚨 {lines.length} incident{lines.length > 1 ? "s" : ""}
        </h2>
        <ul>
          {lines.slice(0, 4).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
