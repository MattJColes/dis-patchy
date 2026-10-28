import { Html } from "@react-three/drei";
import { useEffect, useState } from "react";
import { clock, useLive, type Arrival } from "../live/store";
import { nodes, type NodeId } from "../topology";

const SHOW_FOR = 2.6; // seconds

/** What a node says when something lands on it, as in the banner. */
function speech(a: Arrival): { icons: string; text: string } | undefined {
  switch (`${a.node}:${a.kind}`) {
    case "shop:OrderPlaced":
      return { icons: "🛍️📦", text: "New order!" };
    case "customer:OrderPlaced":
      return { icons: "💬📦", text: "Order confirmed" };
    case "driver:WorkflowStatus":
      return { icons: "📨", text: "Job offer" };
    case "driver:DriverAssigned":
      return { icons: "👍🛵", text: "On my way" };
    case "customer:DriverAssigned":
      return { icons: "💬🛵", text: "Driver assigned" };
    case "customer:OrderDelivered":
      return { icons: "📸✅", text: "Delivered" };
    case "billing:OrderDelivered":
      return { icons: "🏪💲", text: "Line item" };
    case "dispatch:WorkflowStatus":
      return a.failed ? { icons: "🐞❌", text: "No driver" } : undefined;
  }
}

const lift = (node: NodeId) => (nodes[node].actor ? 2.6 : 1.6);

export function Bubbles() {
  const [now, setNow] = useState(clock());
  useEffect(() => {
    const id = setInterval(() => setNow(clock()), 200);
    return () => clearInterval(id);
  }, []);
  const arrivals = useLive((s) => s.arrivals);

  const latest = new Map<NodeId, { a: Arrival; say: NonNullable<ReturnType<typeof speech>> }>();
  for (const a of arrivals) {
    const say = speech(a);
    if (say && a.at <= now && now - a.at < SHOW_FOR && (latest.get(a.node)?.a.at ?? -1) < a.at) latest.set(a.node, { a, say });
  }

  return [...latest.values()].map(({ a, say }) => {
    const [x, y, z] = nodes[a.node].position;
    return (
      <Html key={`${a.node}${a.at}`} position={[x, y + lift(a.node), z]} center zIndexRange={[8, 0]} className="bubble">
        <div>
          <span className="icons">{say.icons}</span>
          <small>{say.text}</small>
        </div>
      </Html>
    );
  });
}
