import { CatmullRomCurve3, QuadraticBezierCurve3, Vector3 } from "three";
import { nodes, type NodeId } from "../topology";

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

export const river = new CatmullRomCurve3([
  new Vector3(-7, 0, 16),
  new Vector3(-3.6, 0, 8),
  new Vector3(-3.2, 0, 3.2),
  new Vector3(-4.4, 0, -3),
  new Vector3(-3.8, 0, -14),
]);

/** The road parameter closest to the river, where the bridge goes. */
export const bridgeAt = (() => {
  let best = 0;
  let bestDistance = Infinity;
  const riverPoints = river.getSpacedPoints(200);
  for (let i = 0; i <= 200; i++) {
    const p = road.getPointAt(i / 200);
    const d = Math.min(...riverPoints.map((r) => r.distanceTo(p)));
    if (d < bestDistance) [best, bestDistance] = [i / 200, d];
  }
  return best;
})();
