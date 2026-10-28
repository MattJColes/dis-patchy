import { create } from "zustand";
import { HOP_SECONDS, nodes, routesFor, type EventKind, type LiveEvent, type NodeId } from "../topology";

export const stages = ["Placed", "Offered", "Assigned", "En route", "Delivered", "Billed"] as const;
export type Stage = (typeof stages)[number] | "Failed";

export interface Order {
  id: string;
  stage: Stage;
  driverId?: string;
  updatedAt: number;
}

export interface FeedItem {
  id: number;
  kind: EventKind;
  text: string;
  color: string;
  at: number;
}

export interface Packet {
  id: number;
  kind: EventKind;
  path: NodeId[];
  color: string;
  startedAt: number; // seconds on the performance clock
}

export interface SmokeStep {
  index: number;
  total: number;
  step: string;
  status: "running" | "passed" | "failed";
  detail?: string;
}

export interface SmokeRun {
  runId: string;
  steps: SmokeStep[];
  done: boolean;
}

/** A packet reaching (or, at index 0, leaving) a node. */
export interface Arrival {
  node: NodeId;
  at: number;
  kind: EventKind;
  failed?: boolean;
}

export type Mode = "demo" | "live";
export type Connection = "offline" | "connecting" | "live" | "error";

const stageRank = (s: Stage) => (s === "Failed" ? 99 : stages.indexOf(s));

function advance(orders: Record<string, Order>, id: string | undefined, stage: Stage, now: number, extra: Partial<Order> = {}) {
  if (!id) return orders;
  const current = orders[id];
  if (current && stageRank(current.stage) >= stageRank(stage)) return orders;
  return { ...orders, [id]: { ...current, id, stage, updatedAt: now, ...extra } };
}

/**
 * Applies one event to the order list. Stages only move forward, so
 * redelivered or out-of-order events never undo progress.
 */
export function reduceOrders(orders: Record<string, Order>, event: LiveEvent, now: number): Record<string, Order> {
  const d = event.detail as Record<string, string>;
  switch (event.kind) {
    case "OrderPlaced":
      return advance(orders, d.orderId, "Placed", now);
    case "WorkflowStatus":
      if (d.status === "RUNNING") return advance(orders, d.orderId, "Offered", now);
      if (["FAILED", "TIMED_OUT", "ABORTED"].includes(d.status)) return advance(orders, d.orderId, "Failed", now);
      return orders;
    case "DriverAssigned":
      return advance(orders, d.orderId, "Assigned", now, { driverId: d.driverId });
    case "Ping": {
      const order = Object.values(orders).find((o) => o.driverId === d.driverId && o.stage === "Assigned");
      return advance(orders, order?.id, "En route", now);
    }
    case "OrderDelivered":
      return advance(orders, d.orderId, "Delivered", now);
    case "SmokeStep":
      return orders;
  }
}

/** Billing is a fan-out the console never hears from directly. */
export function markBilled(orders: Record<string, Order>, id: string, now: number) {
  return orders[id]?.stage === "Delivered" ? advance(orders, id, "Billed", now) : orders;
}

const short = (id: unknown) => String(id ?? "").slice(0, 8);

export function describe(event: LiveEvent): string {
  const d = event.detail as Record<string, string>;
  switch (event.kind) {
    case "OrderPlaced":
      return `Order ${short(d.orderId)} placed by ${d.shopId ?? "a shop"}`;
    case "WorkflowStatus":
      return `Dispatch workflow ${String(d.status).toLowerCase()} for ${short(d.orderId)}`;
    case "DriverAssigned":
      return `Driver ${short(d.driverId)} accepted ${short(d.orderId)}`;
    case "Ping":
      return `Driver ${short(d.driverId)} at ${Number(d.lat).toFixed(4)}, ${Number(d.lng).toFixed(4)}`;
    case "OrderDelivered":
      return `Order ${short(d.orderId)} delivered with proof photo`;
    case "SmokeStep":
      return `Smoke test: ${d.step} (${d.status})`;
  }
}

export const kindColor: Record<EventKind, string> = {
  OrderPlaced: nodes.orders.color,
  WorkflowStatus: nodes.dispatch.color,
  DriverAssigned: nodes.dispatch.color,
  Ping: nodes.tracking.color,
  OrderDelivered: nodes.proof.color,
  SmokeStep: "#2b2f3a",
};

export const MAX_TRAIL = 40;
const FEED_SIZE = 40;
// Pings arrive every few seconds per driver; the feed shows one in four.
const PING_FEED_GAP_MS = 4000;
const LINGER_MS = 20_000;

interface State {
  mode: Mode;
  connection: Connection;
  orders: Record<string, Order>;
  feed: FeedItem[];
  packets: Packet[];
  arrivals: Arrival[];
  drivers: Record<string, [number, number][]>;
  smoke?: SmokeRun;
  lastPingFeed: Record<string, number>;
  setMode(mode: Mode): void;
  setConnection(c: Connection): void;
  setSmoke(run: SmokeRun | undefined): void;
  ingest(event: LiveEvent): void;
  prune(clock: number): void;
}

let seq = 0;
export const clock = () => performance.now() / 1000;

const empty = () => ({ orders: {}, feed: [], packets: [], arrivals: [], drivers: {}, smoke: undefined, lastPingFeed: {} });

function smokeAfter(run: SmokeRun | undefined, step: SmokeStep & { runId: string }): SmokeRun {
  const base = run?.runId === step.runId ? run : { runId: step.runId, steps: [], done: false };
  const steps = [...base.steps.filter((x) => x.index !== step.index), step].sort((a, b) => a.index - b.index);
  const done = step.status === "failed" || (step.status === "passed" && step.index === step.total - 1);
  return { runId: step.runId, steps, done };
}

export const useLive = create<State>((set, get) => ({
  mode: "demo",
  connection: "offline",
  ...empty(),
  setMode: (mode) => set({ mode, ...empty() }),
  setConnection: (connection) => set({ connection }),
  setSmoke: (smoke) => set({ smoke }),

  ingest(event) {
    const now = Date.now();
    const t = clock();
    const s = get();
    const color = kindColor[event.kind];
    const d = event.detail as Record<string, unknown>;

    const failed = event.kind === "WorkflowStatus" && d.status !== "RUNNING";
    const packets = routesFor(event).map((path) => ({ id: ++seq, kind: event.kind, path, color, startedAt: t }));
    const arrivals = packets.flatMap((p) => p.path.map((node, i) => ({ node, at: t + i * HOP_SECONDS, kind: event.kind, failed })));

    let { feed, lastPingFeed, drivers, smoke } = s;
    const driverId = String(d.driverId ?? "");
    const quietPing = event.kind === "Ping" && now - (lastPingFeed[driverId] ?? 0) < PING_FEED_GAP_MS;
    if (!quietPing) {
      feed = [{ id: ++seq, kind: event.kind, text: describe(event), color, at: now }, ...feed].slice(0, FEED_SIZE);
      if (event.kind === "Ping") lastPingFeed = { ...lastPingFeed, [driverId]: now };
    }
    // A new job starts the courier's trip from the shops again.
    if (event.kind === "DriverAssigned") drivers = { ...drivers, [driverId]: [] };
    if (event.kind === "Ping") {
      drivers = { ...drivers, [driverId]: [...(drivers[driverId] ?? []), [Number(d.lat), Number(d.lng)] as [number, number]].slice(-MAX_TRAIL) };
    }
    if (event.kind === "SmokeStep") smoke = smokeAfter(smoke, d as unknown as SmokeStep & { runId: string });

    set({
      orders: reduceOrders(s.orders, event, now),
      feed,
      lastPingFeed,
      drivers,
      smoke,
      packets: [...s.packets, ...packets],
      arrivals: [...s.arrivals, ...arrivals],
    });

    const billed = event.kind === "OrderDelivered" && arrivals.find((a) => a.node === "billing" && a.at > t);
    if (billed) {
      const orderId = String(d.orderId);
      setTimeout(() => set((cur) => ({ orders: markBilled(cur.orders, orderId, Date.now()) })), (billed.at - t) * 1000);
    }
  },

  prune(t) {
    const s = get();
    const packets = s.packets.filter((p) => t - p.startedAt < p.path.length * HOP_SECONDS + 0.5);
    const arrivals = s.arrivals.filter((a) => t - a.at < 3);
    const cutoff = Date.now() - LINGER_MS;
    const orders = Object.fromEntries(
      Object.entries(s.orders).filter(([, o]) => !(o.stage === "Billed" || o.stage === "Failed") || o.updatedAt > cutoff),
    );
    const changed =
      packets.length !== s.packets.length || arrivals.length !== s.arrivals.length || Object.keys(orders).length !== Object.keys(s.orders).length;
    if (changed) set({ packets, arrivals, orders });
  },
}));
