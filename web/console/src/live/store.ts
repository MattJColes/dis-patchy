import { useEffect, useState } from "react";
import { create } from "zustand";
import { HOP_SECONDS, houseFor, nodes, routesFor, type EventKind, type LiveEvent, type NodeId } from "../topology";

export const stages = ["Placed", "Offered", "Assigned", "En route", "Delivered", "Billed"] as const;
export type Stage = (typeof stages)[number] | "Failed";

export interface Order {
  id: string;
  stage: Stage;
  driverId?: string;
  updatedAt: number;
  seenAt: number; // last event of any kind for this order, pings included
  offCourseAt?: number; // the last ping that put the courier somewhere odd
}

export interface FeedItem {
  id: number;
  kind: EventKind | "Lost";
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
  odd?: Oddity;
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
  orderId?: string; // the test order, once the runner has placed it
}

/** A packet reaching (or, at index 0, leaving) a node. */
export interface Arrival {
  node: NodeId;
  at: number;
  kind: EventKind;
  failed?: boolean;
  odd?: Oddity;
}

/** Quiet symptoms: the event arrived, but something about it is wrong. */
export type Oddity = "offCourse" | "duplicate";

export type Mode = "demo" | "live";
export type Connection = "offline" | "connecting" | "live" | "error";

const stageRank = (s: Stage) => (s === "Failed" ? 99 : stages.indexOf(s));

function advance(orders: Record<string, Order>, id: string | undefined, stage: Stage, now: number, extra: Partial<Order> = {}) {
  if (!id) return orders;
  const current = orders[id];
  if (current && stageRank(current.stage) >= stageRank(stage)) return orders;
  return { ...orders, [id]: { ...current, id, stage, updatedAt: now, seenAt: now, ...extra } };
}

// The live path is seconds apart at every step (pings are 1s, the smoke
// runner polls every 3s), so this long a silence means something broke.
export const STALL_MS = 20_000;
export const BURN_MS = 25_000;
// A broken order blocks the road for this long, then is gone: in the real
// system stuck work doesn't queue up for ever, it just gets lost.
export const LOST_AFTER_MS = 10_000;

export type Trouble = "stalled" | "burning";

/** How badly an order is going: stuck orders jam, then catch fire. */
export function trouble(o: Order, now: number): Trouble | undefined {
  if (o.stage === "Failed") return "burning";
  if (o.stage === "Delivered" || o.stage === "Billed") return undefined;
  const quiet = now - o.seenAt;
  return quiet > BURN_MS ? "burning" : quiet > STALL_MS ? "stalled" : undefined;
}

/** Dispatch takes the blame for orders that never got a courier. */
// ~2 km in degrees; couriers ping every few metres.
const MAX_JUMP_DEG = 0.02;

/** A ping with no usable position, or one that teleports the courier. */
export function offCourse(prev: [number, number] | undefined, lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return true;
  return !!prev && Math.hypot(lat - prev[0], lng - prev[1]) > MAX_JUMP_DEG;
}

// A lost courier rides up the garden path, dithers at the wrong door, rides back.
export const DETOUR_S = 8;

/** How far up the garden path a lost courier is, or undefined if not lost. */
export function detourAt(order: Order, now: number) {
  const s = order.offCourseAt === undefined ? Infinity : (now - order.offCourseAt) / 1000;
  if (s >= DETOUR_S) return undefined;
  return Math.min(1, s / 2.5, (DETOUR_S - s) / 2.5);
}

export function lostReason(o: Order) {
  if (o.stage === "Placed") return "it was never sent out to couriers";
  if (o.stage === "Offered" || (o.stage === "Failed" && !o.driverId)) return "no courier ever took the job";
  return "it never reached the customer";
}

/** True once a broken order has blocked the road long enough to vanish. */
export function isLost(o: Order, now: number) {
  if (o.stage === "Failed") return now - o.updatedAt > LOST_AFTER_MS;
  return trouble(o, now) !== undefined && now - o.seenAt > STALL_MS + LOST_AFTER_MS;
}

export function dispatchTrouble(orders: Record<string, Order>, now: number): Trouble | undefined {
  const t = Object.values(orders).filter((o) => !o.driverId).map((o) => trouble(o, now));
  return t.includes("burning") ? "burning" : t.includes("stalled") ? "stalled" : undefined;
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
      const order = Object.values(orders).find((o) => o.driverId === d.driverId && (o.stage === "Assigned" || o.stage === "En route"));
      if (!order) return orders;
      const next = advance(orders, order.id, "En route", now);
      return { ...next, [order.id]: { ...next[order.id], seenAt: now } };
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
const ODD_COLOR = "#d99a1c";
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
  /** Demo controls: how many deliveries run at once, and how many other cars share the roads. */
  demoOrders: number;
  traffic: number;
  setDemoOrders(n: number): void;
  setTraffic(n: number): void;
  setMode(mode: Mode): void;
  setConnection(c: Connection): void;
  setSmoke(run: SmokeRun | undefined): void;
  ingest(event: LiveEvent): void;
  prune(clock: number): void;
}

let seq = 0;
// When recent events arrived, so live mode can size road traffic to the real event volume.
const recent: number[] = [];
export function eventsPerSecond(windowMs = 10_000) {
  const since = Date.now() - windowMs;
  while (recent.length && recent[0] < since) recent.shift();
  return recent.length / (windowMs / 1000);
}

/** Orders still on their way: placed but not yet delivered, failed or lost. */
export const inFlight = (orders: Record<string, Order>) =>
  Object.values(orders).filter((o) => o.stage !== "Delivered" && o.stage !== "Billed" && o.stage !== "Failed").length;
const lostIds = new Set<string>();
export const clock = () => performance.now() / 1000;

/** Date.now(), re-rendering every `ms`. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const empty = () => ({ orders: {}, feed: [], packets: [], arrivals: [], drivers: {}, smoke: undefined, lastPingFeed: {} });

function smokeAfter(run: SmokeRun | undefined, step: SmokeStep & { runId: string }): SmokeRun {
  const base = run?.runId === step.runId ? run : { runId: step.runId, steps: [], done: false };
  const steps = [...base.steps.filter((x) => x.index !== step.index), step].sort((a, b) => a.index - b.index);
  const done = step.status === "failed" || (step.status === "passed" && step.index === step.total - 1);
  // The runner names the order it placed in that step's detail: "order <uuid>, and …".
  const orderId = base.orderId ?? step.detail?.match(/order ([0-9a-f-]{36})/)?.[1];
  return { runId: step.runId, steps, done, orderId };
}

export const useLive = create<State>((set, get) => ({
  mode: "demo",
  connection: "offline",
  ...empty(),
  setMode: (mode) => set({ mode, ...empty() }),
  setConnection: (connection) => set({ connection }),
  setSmoke: (smoke) => set({ smoke }),
  demoOrders: 4,
  traffic: 6,
  setDemoOrders: (demoOrders) => set({ demoOrders }),
  setTraffic: (traffic) => set({ traffic }),

  ingest(event) {
    const now = Date.now();
    recent.push(now);
    const t = clock();
    const s = get();
    const color = kindColor[event.kind];
    const d = event.detail as Record<string, unknown>;

    const failed = event.kind === "WorkflowStatus" && d.status !== "RUNNING";
    const driverId = String(d.driverId ?? "");
    const stage = s.orders[String(d.orderId)]?.stage;
    const odd: Oddity | undefined =
      event.kind === "Ping" && offCourse(s.drivers[driverId]?.at(-1), Number(d.lat), Number(d.lng))
        ? "offCourse"
        : event.kind === "OrderDelivered" && (stage === "Delivered" || stage === "Billed")
          ? "duplicate"
          : undefined;
    const house = houseFor(String(d.orderId ?? ""));
    const packets = routesFor(event).map((route) => {
      const path = route.map((n) => (n === "customer" ? house : n));
      return { id: ++seq, kind: event.kind, path, color, startedAt: t, odd };
    });
    const arrivals = packets.flatMap((p) => p.path.map((node, i) => ({ node, at: t + i * HOP_SECONDS, kind: event.kind, failed, odd })));

    let { feed, lastPingFeed, drivers, smoke } = s;
    const quietPing = event.kind === "Ping" && !odd && now - (lastPingFeed[driverId] ?? 0) < PING_FEED_GAP_MS;
    if (!quietPing) {
      const text =
        odd === "offCourse"
          ? `⚠️ Courier ${short(d.driverId)} says they're somewhere impossible`
          : odd === "duplicate"
            ? `⚠️ Order ${short(d.orderId)} was reported delivered twice`
            : describe(event);
      feed = [{ id: ++seq, kind: event.kind, text, color: odd ? ODD_COLOR : color, at: now }, ...feed].slice(0, FEED_SIZE);
      if (event.kind === "Ping") lastPingFeed = { ...lastPingFeed, [driverId]: now };
    }
    // A new job starts the courier's trip from the shops again.
    if (event.kind === "DriverAssigned") drivers = { ...drivers, [driverId]: [] };
    // A bad position stays off the trail, so the next good ping isn't a jump too.
    if (event.kind === "Ping" && !odd) {
      drivers = { ...drivers, [driverId]: [...(drivers[driverId] ?? []), [Number(d.lat), Number(d.lng)] as [number, number]].slice(-MAX_TRAIL) };
    }
    if (event.kind === "SmokeStep") smoke = smokeAfter(smoke, d as unknown as SmokeStep & { runId: string });

    // A lost order stays lost, even if a late event for it turns up.
    let orders = lostIds.has(String(d.orderId)) ? s.orders : reduceOrders(s.orders, event, now);
    if (odd === "offCourse") {
      const lost = Object.values(orders).find((o) => o.driverId === driverId && o.stage === "En route");
      if (lost) orders = { ...orders, [lost.id]: { ...lost, offCourseAt: now } };
    }

    set({
      orders,
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
    const now = Date.now();
    const lost = Object.values(s.orders).filter((o) => isLost(o, now));
    lost.forEach((o) => lostIds.add(o.id));
    const orders = Object.fromEntries(
      Object.entries(s.orders).filter(([, o]) => !lost.includes(o) && (o.stage !== "Billed" || o.updatedAt > now - LINGER_MS)),
    );
    const feed = lost.length
      ? [
          ...lost.map((o) => ({
            id: ++seq,
            kind: "Lost" as const,
            text: `🕳️ Order ${short(o.id)} is lost: ${lostReason(o)}`,
            color: "#d9413e",
            at: now,
          })),
          ...s.feed,
        ].slice(0, FEED_SIZE)
      : s.feed;
    const changed =
      packets.length !== s.packets.length || arrivals.length !== s.arrivals.length || Object.keys(orders).length !== Object.keys(s.orders).length;
    if (changed) set({ packets, arrivals, orders, feed });
  },
}));
