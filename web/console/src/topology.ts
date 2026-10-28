// The system as the console draws it: one node per stack plus the people at
// the edges, and the route each live event takes between them.

export type NodeId =
  | "shop" | "driver" | "customer"
  | "orders" | "dispatch" | "tracking" | "proof" | "notifications" | "billing" | "bus";

export interface SystemNode {
  id: NodeId;
  label: string;
  services: string;
  color: string;
  position: [number, number, number];
  actor?: boolean;
}

// Ground nodes sit in the village; the stacks float in the cloud above it,
// as in the README banner.
export const nodes: Record<NodeId, SystemNode> = {
  bus: { id: "bus", label: "EventBridge", services: "the dis-patchy bus", color: "#8e5bd6", position: [0.6, 7.4, -3.0] },
  orders: { id: "orders", label: "Orders", services: "API Gateway · Lambda · DynamoDB · SES", color: "#f39c34", position: [-4.0, 7.6, -2.6] },
  dispatch: { id: "dispatch", label: "Dispatch", services: "SQS · Step Functions · SNS", color: "#3d7fd9", position: [-1.8, 9.6, -4.6] },
  tracking: { id: "tracking", label: "Tracking", services: "Kinesis · Lambda · DynamoDB TTL", color: "#e8613a", position: [3.0, 9.6, -4.6] },
  proof: { id: "proof", label: "Proof", services: "S3 presigned URLs · events", color: "#3f9e4f", position: [5.2, 7.6, -2.6] },
  notifications: { id: "notifications", label: "Notifications", services: "EventBridge · SQS · SES", color: "#d9487a", position: [2.8, 5.6, -1.4] },
  billing: { id: "billing", label: "Billing", services: "SQS · DynamoDB · S3 invoices", color: "#1f9e95", position: [-1.6, 5.6, -1.4] },
  shop: { id: "shop", label: "Shops", services: "place orders", color: "#c9762b", position: [-8.6, 0.7, -0.6], actor: true },
  driver: { id: "driver", label: "Courier depot", services: "accepts, pings, proves", color: "#4aa9c9", position: [1.2, 0.7, 6.2], actor: true },
  customer: { id: "customer", label: "Customer", services: "three emails per order", color: "#2b6e5a", position: [9.6, 0.9, -0.2], actor: true },
};

export type EventKind = "OrderPlaced" | "WorkflowStatus" | "DriverAssigned" | "Ping" | "OrderDelivered" | "SmokeStep";

export interface LiveEvent {
  kind: EventKind;
  at: string;
  detail: Record<string, unknown>;
}

type Path = NodeId[];

// Routes include the hops the bus fans out to (emails, billing) even though
// only the triggering event reaches the console.
export function routesFor(event: LiveEvent): Path[] {
  switch (event.kind) {
    case "OrderPlaced":
      return [["shop", "orders", "bus", "dispatch"], ["orders", "customer"]];
    case "WorkflowStatus":
      // A failed workflow goes nowhere; the one-node path marks it on dispatch.
      return event.detail.status === "RUNNING" ? [["dispatch", "driver"]] : [["dispatch"]];
    case "DriverAssigned":
      return [["driver", "dispatch", "bus", "notifications", "customer"]];
    case "Ping":
      return [["driver", "tracking"]];
    case "OrderDelivered":
      return [["driver", "proof", "bus", "notifications", "customer"], ["bus", "billing"]];
    case "SmokeStep":
      return [];
  }
}

const allRoutes: LiveEvent[] = [
  { kind: "OrderPlaced", at: "", detail: {} },
  { kind: "WorkflowStatus", at: "", detail: { status: "RUNNING" } },
  { kind: "DriverAssigned", at: "", detail: {} },
  { kind: "Ping", at: "", detail: {} },
  { kind: "OrderDelivered", at: "", detail: {} },
];

/** Every distinct hop any route uses, drawn as a conduit. */
export const edges: [NodeId, NodeId][] = (() => {
  const seen = new Map<string, [NodeId, NodeId]>();
  for (const e of allRoutes)
    for (const path of routesFor(e))
      for (let i = 1; i < path.length; i++) {
        const pair = [path[i - 1], path[i]].sort() as [NodeId, NodeId];
        seen.set(pair.join(">"), pair);
      }
  return [...seen.values()];
})();

export const HOP_SECONDS = 0.75;
