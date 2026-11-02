// The system as the console draws it: one node per stack plus the people at
// the edges, and the route each live event takes between them.

export type NodeId =
  | "shop" | "driver" | "customer" | "customer2" | "customer3"
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
export const CLOUD_OFFSET = [-1.5, 5, 3] as const;
const cloudPosition = (x: number, y: number, z: number): [number, number, number] =>
  [x + CLOUD_OFFSET[0], y + CLOUD_OFFSET[1], z + CLOUD_OFFSET[2]];

export const nodes: Record<NodeId, SystemNode> = {
  bus: { id: "bus", label: "EventBridge", services: "the dis-patchy bus", color: "#8e5bd6", position: cloudPosition(0.5, 10.9, -3.8) },
  orders: { id: "orders", label: "Orders", services: "API Gateway · Lambda · DynamoDB · SES", color: "#f39c34", position: cloudPosition(-3.6, 11.1, -4.2) },
  dispatch: { id: "dispatch", label: "Dispatch", services: "SQS · Step Functions · SNS", color: "#3d7fd9", position: cloudPosition(-1.8, 12.6, -5.4) },
  tracking: { id: "tracking", label: "Tracking", services: "Kinesis · Lambda · DynamoDB TTL", color: "#e8613a", position: cloudPosition(2.8, 12.6, -5.4) },
  proof: { id: "proof", label: "Proof", services: "S3 presigned URLs · events", color: "#3f9e4f", position: cloudPosition(4.6, 11.1, -4.2) },
  notifications: { id: "notifications", label: "Notifications", services: "EventBridge · SQS · SES", color: "#d9487a", position: cloudPosition(2.6, 9.9, -3.0) },
  billing: { id: "billing", label: "Billing", services: "SQS · DynamoDB · S3 invoices", color: "#1f9e95", position: cloudPosition(-1.5, 9.9, -3.0) },
  shop: { id: "shop", label: "Shops", services: "place orders", color: "#c9762b", position: [-8.6, 0.7, -0.6], actor: true },
  driver: { id: "driver", label: "Courier depot", services: "accepts, pings, proves", color: "#4aa9c9", position: [0.4, 0.7, 11.3], actor: true },
  customer: { id: "customer", label: "Customer", services: "three emails per order", color: "#2b6e5a", position: [9.6, 0.9, -0.2], actor: true },
  customer2: { id: "customer2", label: "Customer", services: "three emails per order", color: "#2b6e5a", position: [7.6, 0.9, -1.4], actor: true },
  customer3: { id: "customer3", label: "Customer", services: "three emails per order", color: "#2b6e5a", position: [1.0, 0.9, 1.9], actor: true },
};

export const eventKinds = ["OrderPlaced", "WorkflowStatus", "DriverAssigned", "OrderCollected", "Ping", "OrderDelivered",
  "NotificationAccepted", "BillingLineRecorded", "SmokeStep", "FleetSnapshot"] as const;
export type EventKind = typeof eventKinds[number];

export interface LiveEvent {
  kind: EventKind;
  at: string;
  detail: Record<string, unknown>;
}

type Path = NodeId[];

export const houses = ["customer", "customer2", "customer3"] as const satisfies NodeId[];
export type House = (typeof houses)[number];
export const isHouse = (n: NodeId): n is House => (houses as readonly NodeId[]).includes(n);

/**
 * Which house an order goes to. Events carry no address, so this is a stable
 * hash of the order ID: it spreads the traffic, it isn't where anyone lives.
 */
export function houseFor(orderId: string): House {
  let h = 0;
  for (const c of orderId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return houses[h % houses.length];
}

// Fan-out paths stop at the consumer. Actual completion events continue to
// the customer or shop. "customer" stands for the order's illustrative house.
export function routesFor(event: LiveEvent): Path[] {
  switch (event.kind) {
    case "OrderPlaced":
      return [["shop", "orders", "bus", "dispatch"]];
    case "WorkflowStatus":
      // A failed workflow goes nowhere; the one-node path marks it on dispatch.
      return event.detail.status === "RUNNING" ? [["dispatch", "driver"]] : [["dispatch"]];
    case "DriverAssigned":
      return [["driver", "dispatch", "bus", "notifications"]];
    case "OrderCollected":
      return [["shop", "driver", "dispatch", "bus"]];
    case "Ping":
      return [["driver", "tracking"]];
    case "OrderDelivered":
      return [["driver", "proof", "customer"], ["proof", "bus", "notifications"], ["bus", "billing"]];
    case "NotificationAccepted":
      return [[event.detail.notification === "OrderPlaced" ? "orders" : "notifications", "customer"]];
    case "BillingLineRecorded":
      return [["billing", "shop"]];
    case "SmokeStep":
    case "FleetSnapshot":
      return [];
  }
}

const allRoutes: LiveEvent[] = [
  { kind: "OrderPlaced", at: "", detail: {} },
  { kind: "WorkflowStatus", at: "", detail: { status: "RUNNING" } },
  { kind: "DriverAssigned", at: "", detail: {} },
  { kind: "OrderCollected", at: "", detail: {} },
  { kind: "Ping", at: "", detail: {} },
  { kind: "OrderDelivered", at: "", detail: {} },
  { kind: "NotificationAccepted", at: "", detail: {} },
  { kind: "NotificationAccepted", at: "", detail: { notification: "OrderPlaced" } },
  { kind: "BillingLineRecorded", at: "", detail: {} },
];

/** Every distinct hop any route uses, drawn as a conduit. */
export const edges: [NodeId, NodeId][] = (() => {
  const seen = new Map<string, [NodeId, NodeId]>();
  for (const e of allRoutes)
    for (const path of routesFor(e))
      for (let i = 1; i < path.length; i++) {
        for (const house of houses) {
          const swap = (n: NodeId) => (n === "customer" ? house : n);
          const pair = [swap(path[i - 1]), swap(path[i])].sort() as [NodeId, NodeId];
          seen.set(pair.join(">"), pair);
        }
      }
  return [...seen.values()];
})();

export const HOP_SECONDS = 0.75;
