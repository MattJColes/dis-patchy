// Demo mode plays scripted orders through the same store as live mode, so
// the page shows the system working without a deployment or any traffic.
import type { LiveEvent } from "../topology";
import { clock, sceneWorldAt, useLive } from "./store";
import { demoFleet } from "./assets";

const shops = demoFleet.shops.map((s) => s.id);

let timers: ReturnType<typeof setTimeout>[] = [];
// Rain, storms and peak hours stretch a delivery; the weather when it starts sets the pace.
let pace = 1;
let smokeRunning = false;
const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms * pace));

const emit = (kind: LiveEvent["kind"], detail: Record<string, unknown>) =>
  useLive.getState().ingest({ kind, at: new Date().toISOString(), detail });

const id = () => crypto.randomUUID();

/**
 * One order's whole life, from placement to delivery; returns its length in
 * ms. onStep(n) fires as smoke step n would pass.
 */
function playOrder(opts: { orderId?: string; failed?: boolean; stall?: boolean; onStep?: (step: number, ok: boolean) => void } = {}): number {
  const orderId = opts.orderId ?? id();
  const driverId = id();
  const shopId = shops[Math.floor(Math.random() * shops.length)];
  const step = opts.onStep ?? (() => {});
  const from = [51.495 + Math.random() * 0.02, -0.15 + Math.random() * 0.05];
  const to = [51.495 + Math.random() * 0.02, -0.15 + Math.random() * 0.05];

  later(0, () => (step(1, true), emit("OrderPlaced", { orderId, shopId })));
  later(900, () => emit("NotificationAccepted", { orderId, notification: "OrderPlaced" }));
  later(1800, () => (step(2, true), emit("WorkflowStatus", { orderId, status: "RUNNING" })));
  if (opts.failed) {
    later(6000, () => (step(3, false), emit("WorkflowStatus", { orderId, status: "FAILED" })));
    return 6000;
  }
  later(4200, () => (step(3, true), emit("DriverAssigned", { orderId, driverId })));
  later(5100, () => emit("NotificationAccepted", { orderId, notification: "DriverAssigned" }));
  // The courier rides from the depot to the shop to collect before it starts sending positions.
  const firstPing = 7700;
  later(firstPing - 400, () => (step(4, true), emit("OrderCollected", { orderId, driverId, shopId })));
  const pings = 10;
  // A stalled courier goes quiet partway: it jams, catches fire and is lost.
  if (opts.stall) {
    for (let i = 0; i < 4; i++) later(firstPing + i * 1000, () => emit("Ping", { driverId, lat: from[0], lng: from[1] }));
    return 40_000;
  }
  for (let i = 0; i < pings; i++) {
    const f = i / (pings - 1);
    const wobble = Math.sin(f * Math.PI) * 0.004 * (Math.random() - 0.5);
    later(firstPing + i * 1000, () => {
      emit("Ping", { driverId, lat: from[0] + f * (to[0] - from[0]) + wobble, lng: from[1] + f * (to[1] - from[1]) - wobble });
    });
  }
  const arrived = firstPing + pings * 1000;
  // Quieter faults: a ping with no position, and a delivery reported twice.
  // The pretend smoke run stays clean, like a passing real one.
  if (!opts.onStep && Math.random() < 0.15) later(firstPing + 4500, () => emit("Ping", { driverId, lat: 0, lng: 0 }));
  if (!opts.onStep && Math.random() < 0.1) later(arrived + 2600, () => emit("OrderDelivered", { orderId, shopId }));
  later(arrived, () => step(5, true));
  later(arrived + 600, () => step(6, true));
  later(arrived + 900, () => step(7, true));
  later(arrived + 1200, () => (step(8, true), emit("OrderDelivered", { orderId, shopId })));
  later(arrived + 2000, () => emit("NotificationAccepted", { orderId, notification: "OrderDelivered" }));
  later(arrived + 2400, () => emit("BillingLineRecorded", { orderId, shopId }));
  return arrived + 2400;
}

export const smokeSteps = [
  "Preparing the smoke shop and driver",
  "Placing an order",
  "Waiting for the driver offer",
  "Accepting the offer",
  "Collecting the parcel",
  "Driving to the customer",
  "Reading the ETA",
  "Uploading the proof photo",
  "Waiting for delivery",
];

/** A pretend smoke run: the same steps the real runner reports. */
export function playSmokeRun() {
  const runId = id();
  const total = smokeSteps.length;
  const report = (index: number, status: "running" | "passed" | "failed", detail = "") =>
    emit("SmokeStep", { runId, scenario: "smoke", index, total, step: smokeSteps[index], status, detail: detail || undefined });

  const orderId = id();
  // The demo village goes quiet while the test delivery plays, so it's the only thing moving.
  smokeRunning = true;
  report(0, "running");
  later(900, () => {
    report(0, "passed", "signed in as smoke-shop@dispatchy.test and smoke-driver@dispatchy.test");
    report(1, "running");
    playOrder({
      orderId,
      onStep: (n, ok) => {
        // Same wording as the real runner, so the console finds the order the same way.
        report(n, ok ? "passed" : "failed", n === 1 ? `order ${orderId}, and the idempotent retry returned it again` : "");
        if (ok && n + 1 < total) report(n + 1, "running");
        else smokeRunning = false;
      },
    });
  });
}

export function startDemo() {
  stopDemo();
  let active = 0;
  const tick = () => {
    const world = sceneWorldAt(clock(), false);
    const { demoOrders, traffic } = useLive.getState();
    // Peak hours bring a few more orders at once; storms and busy roads strand more couriers.
    const target = Math.min(20, demoOrders + (world.peak && demoOrders > 0 ? 2 : 0));
    if (active < target && !smokeRunning) {
      active++;
      const roll = Math.random();
      // Other traffic is load the deliveries share: it slows them and makes jams likelier.
      pace = world.slow * (1 + traffic / 25);
      const stallOver = (world.weather === "storm" ? 0.8 : 0.88) - traffic * 0.008;
      const ms = playOrder({ failed: roll < 0.12, stall: roll > stallOver });
      later(ms, () => active--);
    }
    pace = 1;
    // Catch up quickly when the slider asks for more deliveries than are running.
    const behind = active < target - 1;
    later(behind ? 400 + Math.random() * 600 : (2500 + Math.random() * 3500) / (world.peak ? 1.8 : 1), tick);
  };
  tick();
}

export function stopDemo() {
  smokeRunning = false;
  timers.forEach(clearTimeout);
  timers = [];
}
