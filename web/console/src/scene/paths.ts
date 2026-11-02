import { Box3, CatmullRomCurve3, QuadraticBezierCurve3, Vector3 } from "three";
import { nodes, type House, type NodeId } from "../topology";

const curves = new Map<string, QuadraticBezierCurve3>();

/** The arc a packet follows between two nodes, cached per direction. */
export function arc(a: NodeId, b: NodeId): QuadraticBezierCurve3 {
  const key = `${a}>${b}`;
  let c = curves.get(key);
  if (!c) {
    const start = new Vector3(...nodes[a].position);
    const end = new Vector3(...nodes[b].position);
    const mid = start.clone().lerp(end, 0.5);
    mid.y = Math.max(start.y, end.y) + 0.8 + start.distanceTo(end) * 0.12;
    c = new QuadraticBezierCurve3(start, mid, end);
    curves.set(key, c);
  }
  return c;
}

/** The village road, from the shop row to the customer's door. */
export const road = new CatmullRomCurve3([
  new Vector3(-8.2, 0, 1.6),
  new Vector3(-5, 0, 2.6),
  new Vector3(-2.2, 0, 3.6),
  new Vector3(1.2, 0, 4.6),
  new Vector3(4.6, 0, 4),
  new Vector3(7.4, 0, 2.6),
  new Vector3(8.6, 0, 1.6),
]);

/** The neighbour's house: the wrong address a lost courier ends up at. */
export const NEIGHBOUR: [number, number, number] = [4.6, 0, 0.2];
// The houses on Orchard Row sit at odd angles, doors roughly towards the camera.
export const TURN = { customer2: -0.25, customer3: -0.15, neighbour: -0.4 };

const v = (x: number, z: number) => new Vector3(x, 0, z);

/** A point in front of a cottage at `pos` turned by `turn`, `out` units from its door. */
const front = (pos: [number, number, number], turn: number, out: number) =>
  v(pos[0] + 0.3 * Math.cos(turn) + out * Math.sin(turn), pos[2] + out * Math.cos(turn) - 0.3 * Math.sin(turn));

export const doorstep = (h: "customer2" | "customer3") => front(nodes[h].position, TURN[h], 1.6);
const nextDoor = (out: number) => front(NEIGHBOUR, TURN.neighbour, out);

/** The big cottage at the end of the high street. */
export const END_COTTAGE: [number, number, number] = [10.4, 0, -1.4];
const END_TURN = -0.7;

/** A point `out` units in front of a customer's door (its door is at about 0.8, or 1.1 for the big cottage). */
export const frontOf = (h: House, out: number) =>
  h === "customer" ? front(END_COTTAGE, END_TURN, out) : front(nodes[h].position, TURN[h], out);
export const doorAt = (h: House) => (h === "customer" ? 1.15 : 0.8);

// Orchard Row leaves the high street here and rejoins it near its end.
const ROW_FROM = 0.5;

export type Street = "high" | "orchard" | "depot";

export const streets: Record<Street, CatmullRomCurve3> = {
  high: road,
  // A residential row north of the high street: house, neighbour, house.
  orchard: new CatmullRomCurve3([
    road.getPointAt(ROW_FROM),
    v(0.6, 3.9),
    doorstep("customer3"),
    v(2.6, 3.0),
    nextDoor(1.6),
    v(6.0, 1.0),
    doorstep("customer2"),
    road.getPointAt(0.97),
  ]),
  // The depot sits out past the river's branch, away from the shops and houses.
  depot: new CatmullRomCurve3([v(1.5, 10.3), v(1.3, 8.6), v(1.1, 6.4), road.getPointAt(0.55)]), // joins at DEPOT_JOINS
};

/** The few steps from Orchard Row up to the neighbour's door. */
export const gardenPath = new CatmullRomCurve3([nextDoor(1.6), nextDoor(1.25), nextDoor(0.95)]);

export const SHOPS: { position: [number, number, number]; rotation: number; wall: string; awning: string; sign: string; name: string }[] = [
  { position: [-10.8, 0, -3.4], rotation: 0.5, wall: "#f3d9a8", awning: "#c87953", sign: "🥐", name: "Boulangerie" },
  { position: [-7.2, 0, -5.8], rotation: 0.25, wall: "#e6ddcc", awning: "#6e9eab", sign: "📚", name: "Librairie" },
  { position: [-12.2, 0, 2.6], rotation: 1.05, wall: "#efe3c4", awning: "#7e9b76", sign: "🥬", name: "Marché" },
];

/** The cobbled square at the top of the high street, where couriers collect from the shops. */
export const SQUARE = v(-8.9, 0.3);

/** Footpaths from each shop's door to the square. */
export const footpaths = SHOPS.map(({ position: [x, , z], rotation: r }) => {
  const door = v(x + Math.sin(r) * 1.7, z + Math.cos(r) * 1.7);
  return new CatmullRomCurve3([door, door.clone().lerp(SQUARE, 0.5).add(v(0.3, 0.3)), SQUARE]);
});

const upTo = (curve: CatmullRomCurve3, to: number, n = 24) => Array.from({ length: n }, (_, i) => curve.getPointAt((to * i) / (n - 1)));
const row = streets.orchard.points;
const DEPOT_JOINS = 0.55;

// Out of the depot, up the depot lane, then west along the high street to the square.
const collect = [...streets.depot.points, ...Array.from({ length: 20 }, (_, i) => road.getPointAt(DEPOT_JOINS * (1 - (i + 1) / 20))), SQUARE];
const collectLength = new CatmullRomCurve3(collect).getLength();

function journey(deliver: Vector3[], via: Street[]) {
  const curve = new CatmullRomCurve3([...collect, ...deliver]);
  // How far along the whole ride the courier is when it reaches the shops.
  return { curve, streets: ["depot", "high", ...via] as Street[], collectAt: collectLength / curve.getLength() };
}

/** A courier's whole ride, depot to shop to its order's house, and the streets it uses. */
export const routes: Record<House, { curve: CatmullRomCurve3; streets: Street[]; collectAt: number }> = {
  customer: journey(upTo(road, 1), []),
  customer2: journey([...upTo(road, ROW_FROM), ...row.slice(1, 7)], ["orchard"]),
  customer3: journey([...upTo(road, ROW_FROM), ...row.slice(1, 3)], ["orchard"]),
};

export const river = new CatmullRomCurve3([
  new Vector3(-20, 0, 70),
  new Vector3(-13, 0, 40),
  new Vector3(-7, 0, 16),
  new Vector3(-3.6, 0, 8),
  new Vector3(-3.2, 0, 3.2),
  new Vector3(-4.4, 0, -3),
  new Vector3(-3.8, 0, -14),
  new Vector3(-5.2, 0, -36),
  new Vector3(-1.8, 0, -70),
]);

/** The river's branch: it splits off south of the high street and runs past the depot. */
export const branch = new CatmullRomCurve3([v(-3.5, 7.4), v(-0.8, 7.0), v(1.8, 7.8), v(3.6, 9.6), v(5.0, 14), v(10, 36), v(20, 70)]);

const fieldWater = [...river.getSpacedPoints(400), ...branch.getSpacedPoints(200)];
const waterEnvelope = new Box3().setFromPoints(fieldWater).expandByScalar(8);

/** Gentle farmland rolls; village streets and the river valley stay flat. */
export function rollingHeight(x: number, z: number) {
  const fade = Math.min(1, Math.max(0, (-z - 17) / 20));
  if (fade === 0) return 0;
  let bank = 1;
  if (waterEnvelope.containsPoint(new Vector3(x, 0, z))) {
    let distance = Infinity;
    for (const point of fieldWater) distance = Math.min(distance, Math.hypot(x - point.x, z - point.z));
    bank = Math.min(1, Math.max(0, (distance - 3.5) / 4.5));
  }
  return fade * bank * (0.8 + 0.35 * Math.sin(x / 16) + 0.35 * Math.cos(z / 21));
}

/** Leave bank clearance for the slightly rotated vineyard plots and their hedges. */
export function fieldIsDry(x: number, z: number, width: number, depth: number) {
  const bounds = new Box3(new Vector3(x - width / 2 - 2, -1, z - depth / 2 - 2), new Vector3(x + width / 2 + 2, 1, z + depth / 2 + 2));
  return fieldWater.every((point) => !bounds.containsPoint(point));
}

/** The parameter along `street` closest to `water`, where a bridge goes. */
function crossing(street: CatmullRomCurve3, water: CatmullRomCurve3) {
  let best = 0;
  let bestDistance = Infinity;
  const waterPoints = water.getSpacedPoints(200);
  for (let i = 0; i <= 200; i++) {
    const p = street.getPointAt(i / 200);
    const d = Math.min(...waterPoints.map((r) => r.distanceTo(p)));
    if (d < bestDistance) [best, bestDistance] = [i / 200, d];
  }
  return best;
}

/** Where each bridge goes: the high street over the river, the depot lane over its branch. */
export const bridges: { street: CatmullRomCurve3; at: number }[] = [
  { street: road, at: crossing(road, river) },
  { street: streets.depot, at: crossing(streets.depot, branch) },
];
