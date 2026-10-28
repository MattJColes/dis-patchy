// Demo mode plays scripted orders through the same store as live mode, so
// the page shows the system working without a deployment or any traffic.
import type { LiveEvent } from "../topology";
import { useLive } from "./store";

const shops = ["corner-deli", "bloom-florist", "page-turners", "brew-lab"];
const MAX_ACTIVE = 4;

let timers: ReturnType<typeof setTimeout>[] = [];
const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

const emit = (kind: LiveEvent["kind"], detail: Record<string, unknown>) =>
  useLive.getState().ingest({ kind, at: new Date().toISOString(), detail });

const id = () => crypto.randomUUID();

/**
 * One order's whole life, from placement to delivery; returns its length in
 * ms. onStep(n) fires as smoke step n would pass.
 */
function playOrder(opts: { failed?: boolean; onStep?: (step: number, ok: boolean) => void } = {}): number {
  const orderId = id();
  const driverId = id();
  const shopId = shops[Math.floor(Math.random() * shops.length)];
  const step = opts.onStep ?? (() => {});
  const from = [51.495 + Math.random() * 0.02, -0.15 + Math.random() * 0.05];
  const to = [51.495 + Math.random() * 0.02, -0.15 + Math.random() * 0.05];

  later(0, () => (step(1, true), emit("OrderPlaced", { orderId, shopId })));
  later(1800, () => (step(2, true), emit("WorkflowStatus", { orderId, status: "RUNNING" })));
  if (opts.failed) {
    later(6000, () => (step(3, false), emit("WorkflowStatus", { orderId, status: "FAILED" })));
    return 6000;
  }
  later(4200, () => (step(3, true), emit("DriverAssigned", { orderId, driverId })));
  const pings = 10;
  for (let i = 0; i < pings; i++) {
    const f = i / (pings - 1);
    const wobble = Math.sin(f * Math.PI) * 0.004 * (Math.random() - 0.5);
    later(5200 + i * 1000, () => {
      emit("Ping", { driverId, lat: from[0] + f * (to[0] - from[0]) + wobble, lng: from[1] + f * (to[1] - from[1]) - wobble });
    });
  }
  const arrived = 5200 + pings * 1000;
  later(arrived, () => step(4, true));
  later(arrived + 600, () => step(5, true));
  later(arrived + 1200, () => (step(6, true), emit("OrderDelivered", { orderId, shopId })));
  later(arrived + 2400, () => step(7, true));
  return arrived + 2400;
}

export const smokeSteps = [
  "Preparing the smoke shop and driver",
  "Placing an order",
  "Waiting for the driver offer",
  "Accepting the offer",
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
    emit("SmokeStep", { runId, index, total, step: smokeSteps[index], status, detail: detail || undefined });

  report(0, "running");
  later(900, () => {
    report(0, "passed", "signed in as smoke-shop@dispatchy.test and smoke-driver@dispatchy.test");
    report(1, "running");
    playOrder({
      onStep: (n, ok) => {
        report(n, ok ? "passed" : "failed");
        if (ok && n + 1 < total) report(n + 1, "running");
      },
    });
  });
}

export function startDemo() {
  stopDemo();
  let active = 0;
  const tick = () => {
    if (active < MAX_ACTIVE) {
      active++;
      const ms = playOrder({ failed: Math.random() < 0.12 });
      later(ms, () => active--);
    }
    later(2500 + Math.random() * 3500, tick);
  };
  tick();
}

export function stopDemo() {
  timers.forEach(clearTimeout);
  timers = [];
}
