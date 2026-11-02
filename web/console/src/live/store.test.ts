import { describe, expect, it } from "vitest";
import { edges, houseFor, houses, nodes, routesFor, type LiveEvent } from "../topology";
import { BURN_MS, dispatchTrouble, eventsPerSecond, isLost, LOST_AFTER_MS, lostReason, markBilled, offCourse, reduceOrders, sceneWorldAt, STALL_MS, trouble, useLive, type Order } from "./store";

const ev = (kind: LiveEvent["kind"], detail: Record<string, unknown>): LiveEvent => ({ kind, at: "", detail });

function play(...events: LiveEvent[]) {
  return events.reduce<Record<string, Order>>((orders, e) => reduceOrders(orders, e, 0), {});
}

describe("reduceOrders", () => {
  it("walks an order through every stage", () => {
    const orders = play(
      ev("OrderPlaced", { orderId: "o1" }),
      ev("WorkflowStatus", { orderId: "o1", status: "RUNNING" }),
      ev("DriverAssigned", { orderId: "o1", driverId: "d1" }),
      ev("Ping", { driverId: "d1", lat: 1, lng: 2 }),
      ev("OrderDelivered", { orderId: "o1" }),
    );
    expect(markBilled(orders, "o1", 0).o1.stage).toBe("Billed");
  });

  it("never moves an order backwards on a redelivered event", () => {
    const orders = play(ev("DriverAssigned", { orderId: "o1", driverId: "d1" }), ev("OrderPlaced", { orderId: "o1" }));
    expect(orders.o1.stage).toBe("Assigned");
  });

  it("marks an order failed when its dispatch workflow fails", () => {
    const orders = play(ev("OrderPlaced", { orderId: "o1" }), ev("WorkflowStatus", { orderId: "o1", status: "FAILED" }));
    expect(orders.o1.stage).toBe("Failed");
  });

  it("ignores pings from drivers with no assigned order", () => {
    const before = play(ev("OrderPlaced", { orderId: "o1" }));
    expect(reduceOrders(before, ev("Ping", { driverId: "stranger" }), 0)).toBe(before);
  });

  it("only bills delivered orders", () => {
    const orders = play(ev("OrderPlaced", { orderId: "o1" }));
    expect(markBilled(orders, "o1", 0).o1.stage).toBe("Placed");
  });
});

describe("trouble", () => {
  const at = (orders: Record<string, Order>, e: LiveEvent, now: number) => reduceOrders(orders, e, now);
  const enRoute = () => at(at({}, ev("DriverAssigned", { orderId: "o1", driverId: "d1" }), 0), ev("Ping", { driverId: "d1" }), 0);

  it("jams an order that has gone quiet", () => {
    expect(trouble(enRoute().o1, STALL_MS + 1)).toBe("stalled");
  });

  it("sets a long-quiet order on fire", () => {
    expect(trouble(enRoute().o1, BURN_MS + 1)).toBe("burning");
  });

  it("keeps an en-route order fresh while pings keep coming", () => {
    const orders = at(enRoute(), ev("Ping", { driverId: "d1" }), STALL_MS);
    expect(trouble(orders.o1, STALL_MS + 1)).toBeUndefined();
  });

  it("never troubles a delivered order", () => {
    const orders = at(enRoute(), ev("OrderDelivered", { orderId: "o1" }), 0);
    expect(trouble(orders.o1, BURN_MS * 10)).toBeUndefined();
  });

  it("blames dispatch for a failed order with no courier", () => {
    const orders = play(ev("OrderPlaced", { orderId: "o1" }), ev("WorkflowStatus", { orderId: "o1", status: "FAILED" }));
    expect(dispatchTrouble(orders, 0)).toBe("burning");
  });

  it("leaves dispatch alone when the stuck order has a courier", () => {
    expect(dispatchTrouble(enRoute(), BURN_MS + 1)).toBeUndefined();
  });
});

describe("lost orders", () => {
  const failed = () => play(ev("OrderPlaced", { orderId: "o1" }), ev("WorkflowStatus", { orderId: "o1", status: "FAILED" })).o1;

  it("keeps a failed order on screen for the blocking period", () => {
    expect(isLost(failed(), LOST_AFTER_MS)).toBe(false);
  });

  it("loses a failed order once the blocking period is over", () => {
    expect(isLost(failed(), LOST_AFTER_MS + 1)).toBe(true);
  });

  it("loses a stuck order once it has blocked for the full period", () => {
    const o = play(ev("OrderPlaced", { orderId: "o1" })).o1;
    expect(isLost(o, STALL_MS + LOST_AFTER_MS + 1)).toBe(true);
  });

  it("explains a lost order in terms of the delivery", () => {
    expect(lostReason(failed())).toBe("no courier ever took the job");
  });
});

describe("houseFor", () => {
  it("always sends an order to the same house", () => {
    expect(houseFor("order-42")).toBe(houseFor("order-42"));
  });

  it("uses every house across many orders", () => {
    const used = new Set(Array.from({ length: 50 }, (_, i) => houseFor(`order-${i}`)));
    expect(used.size).toBe(houses.length);
  });
});

describe("offCourse", () => {
  it("flags a ping with no position", () => {
    expect(offCourse(undefined, 0, 0)).toBe(true);
  });

  it("flags a ping with an unreadable position", () => {
    expect(offCourse(undefined, Number(undefined), 1)).toBe(true);
  });

  it("flags a ping kilometres from the last one", () => {
    expect(offCourse([51.5, -0.12], 51.6, -0.12)).toBe(true);
  });

  it("accepts a ping a few metres on", () => {
    expect(offCourse([51.5, -0.12], 51.5001, -0.1201)).toBe(false);
  });
});

describe("ingest", () => {
  const send = (kind: LiveEvent["kind"], detail: Record<string, unknown>) => useLive.getState().ingest(ev(kind, detail));

  it("sends a courier with a bad ping up the garden path", () => {
    useLive.getState().setMode("demo");
    send("DriverAssigned", { orderId: "o1", driverId: "d1" });
    send("Ping", { driverId: "d1", lat: 51.5, lng: -0.12 });
    send("Ping", { driverId: "d1", lat: 0, lng: 0 });
    expect(useLive.getState().orders.o1.offCourseAt).toBeDefined();
  });

  it("marks a second delivery of the same order as a duplicate", () => {
    useLive.getState().setMode("demo");
    send("OrderDelivered", { orderId: "o1" });
    send("OrderDelivered", { orderId: "o1" });
    expect(useLive.getState().arrivals.filter((a) => a.odd === "duplicate").length).toBeGreaterThan(0);
  });
});

describe("topology", () => {
  it("routes delivered orders to both notifications and billing", () => {
    const ends = routesFor(ev("OrderDelivered", {})).map((p) => p.at(-1));
    expect(ends).toEqual(["customer", "billing"]);
  });

  it("only draws conduits between known nodes", () => {
    for (const [a, b] of edges) {
      expect(nodes[a]).toBeDefined();
      expect(nodes[b]).toBeDefined();
    }
  });
});

describe("scene controls", () => {
  it("changes the sky without changing order health or event timestamps", () => {
    const state = useLive.getState();
    state.setMode("live");
    state.ingest(ev("DriverAssigned", { orderId: "scene-order", driverId: "scene-driver" }));
    const before = useLive.getState();
    state.setSceneHour(0);
    state.setSceneWeather("storm");
    const after = useLive.getState();
    expect(sceneWorldAt(0, true).hour).toBe(0);
    expect(sceneWorldAt(0, true).weather).toBe("storm");
    expect(after.orders).toBe(before.orders);
    expect(after.feed).toBe(before.feed);
    expect(after.arrivals).toBe(before.arrivals);
    const order = after.orders["scene-order"];
    expect(trouble(order, order.seenAt + STALL_MS)).toBeUndefined();
    expect(trouble(order, order.seenAt + STALL_MS + 1)).toBe("stalled");
    state.setMode("demo");
  });

  it("rejects invalid clock input before changing scene state", () => {
    for (const hour of [NaN, Infinity, -1, 24]) {
      expect(() => useLive.getState().setSceneHour(hour)).toThrow(RangeError);
    }
  });

  it("does not carry demo event volume into live road traffic", () => {
    const state = useLive.getState();
    state.setMode("demo");
    state.ingest(ev("OrderPlaced", { orderId: "demo-volume" }));
    expect(eventsPerSecond()).toBeGreaterThan(0);
    state.setMode("live");
    expect(eventsPerSecond()).toBe(0);
    state.setMode("demo");
  });
});
