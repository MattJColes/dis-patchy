import catalog from "../../../../services/console/catalog.json";

export interface Fleet {
  shops: typeof catalog.shops;
  depots: typeof catalog.depots;
  vehicles: typeof catalog.vehicles;
  drivers: { id: string; name: string; vehicleId: string; depotId: string; status: "AVAILABLE" | "OFFERED" | "BUSY" | "OFFLINE" }[];
}

export const demoFleet: Fleet = { ...catalog, drivers: [
  { id: "demo-courier-1", name: "Courier 1", vehicleId: "scooter-1", depotId: "riverside", status: "AVAILABLE" },
  { id: "demo-courier-2", name: "Courier 2", vehicleId: "scooter-2", depotId: "riverside", status: "AVAILABLE" },
] };

export const scenarios = [
  { id: "smoke", label: "One parcel", hint: "Follow a parcel from the shop to a completed delivery." },
  { id: "rush", label: "Rush hour", hint: "Three shops place orders for a fleet of two couriers." },
  { id: "ignored-offer", label: "Ignored offer", hint: "Leave an offer unanswered and observe dispatch." },
  { id: "retry-race", label: "Concurrent retries", hint: "Place two orders at once with the same retry key." },
  { id: "malformed-ping", label: "Bad location message", hint: "Send malformed JSON to the tracking API." },
  { id: "stale-pings", label: "Old location arrives late", hint: "Send a new position followed by an older one." },
  { id: "interrupted-pings", label: "Courier goes quiet", hint: "Stop sending positions partway through a trip." },
  { id: "duplicate-proof", label: "Repeated delivery proof", hint: "Upload the same proof twice and observe delivery events." },
] as const;
export type Scenario = typeof scenarios[number]["id"];

export function isFleet(value: unknown): value is Fleet {
  if (!value || typeof value !== "object") return false;
  const fleet = value as Fleet;
  return Array.isArray(fleet.shops) && Array.isArray(fleet.depots) && Array.isArray(fleet.vehicles) &&
    Array.isArray(fleet.drivers) && fleet.drivers.every((d) => typeof d.id === "string" && typeof d.name === "string" &&
      typeof d.vehicleId === "string" && typeof d.depotId === "string" && ["AVAILABLE", "OFFERED", "BUSY", "OFFLINE"].includes(d.status));
}
