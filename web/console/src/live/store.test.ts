import { describe, expect, it } from "vitest";
import { edges, nodes, routesFor, type LiveEvent } from "../topology";
import { markBilled, reduceOrders, type Order } from "./store";

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
