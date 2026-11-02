import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3, type Group } from "three";
import { clock, detourAt, trouble, useLive, useNow, type Order, type Trouble } from "../live/store";
import { houseFor, houses, type House } from "../topology";
import { worldAt } from "../live/world";
import { Fire } from "./Fire";
import { gardenPath, routes } from "./paths";
import { Toon } from "./toon";

// ponytail: a courier's progress is guessed from its ping count (the smoke
// run and the demo both send ten), not from its coordinates; map real
// lat/lng onto the road if routes ever vary.
const PINGS_PER_TRIP = 10;

/** Where along its ride a courier should be: at the shop until it starts moving, then towards the door. */
function targetProgress(order: Order, pings: number, collectAt: number) {
  if (order.stage === "Delivered" || order.stage === "Billed") return 1;
  if (pings === 0) return collectAt;
  return collectAt + (1 - collectAt) * Math.min(0.92, 0.03 + pings / PINGS_PER_TRIP);
}

const MAX_SPEED = 0.15; // of the ride per second, so the trip out of the depot reads as a ride

/** A headlamp and its beam, switched on after dark and in storms. */
function Headlight() {
  const beam = useRef<Group>(null);
  const live = useLive((s) => s.mode === "live");
  useFrame(() => {
    const w = worldAt(clock(), live);
    if (beam.current) beam.current.visible = w.daylight < 0.35 || w.weather === "storm";
  });
  return (
    <group ref={beam} visible={false}>
      <Toon position={[0, 1.0, 0.68]} rotation={[Math.PI / 2, 0, 0]} color="#fff3b0" emissive="#ffe27a" outline={0.015}>
        <cylinderGeometry args={[0.1, 0.1, 0.06, 12]} />
      </Toon>
      {/* the beam: a soft cone spreading forward along the road */}
      <mesh position={[0, 0.7, 1.9]} rotation={[-Math.PI / 2 + 0.2, 0, 0]}>
        <coneGeometry args={[0.7, 2.4, 20, 1, true]} />
        <meshBasicMaterial color="#ffe9a0" transparent opacity={0.28} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Gopher({ withBug }: { withBug: boolean }) {
  return (
    <group>
      <Headlight />
      {/* scooter */}
      <Toon position={[0, 0.42, 0]} color="#f2e6c8">
        <boxGeometry args={[0.5, 0.3, 1.15]} />
      </Toon>
      <Toon position={[0, 0.8, 0.5]} rotation={[-0.3, 0, 0]} color="#f2e6c8" outline={0.025}>
        <boxGeometry args={[0.14, 0.7, 0.14]} />
      </Toon>
      <Toon position={[0, 1.15, 0.6]} color="#2f3542" outline={0.02}>
        <boxGeometry args={[0.6, 0.07, 0.07]} />
      </Toon>
      {[-0.42, 0.42].map((z) => (
        <Toon key={z} position={[0, 0.22, z]} rotation={[0, 0, Math.PI / 2]} color="#2f3542" outline={0.02}>
          <cylinderGeometry args={[0.22, 0.22, 0.16, 16]} />
        </Toon>
      ))}
      {/* parcels on the back */}
      <Toon position={[0, 0.82, -0.42]} color="#c99a5b" outline={0.03}>
        <boxGeometry args={[0.46, 0.4, 0.42]} />
      </Toon>
      <Toon position={[0, 1.2, -0.42]} color="#d9ad6e" outline={0.03}>
        <boxGeometry args={[0.38, 0.32, 0.36]} />
      </Toon>
      {withBug && (
        <Toon position={[0.05, 1.42, -0.42]} color="#e0393e" outline={0.02}>
          <sphereGeometry args={[0.1, 10, 10]} />
        </Toon>
      )}
      {/* the gopher */}
      <Toon position={[0, 1.05, 0.02]} color="#79c7e3">
        <capsuleGeometry args={[0.32, 0.4, 6, 14]} />
      </Toon>
      <Toon position={[0, 1.45, 0.02]} scale={[1, 0.6, 1]} color="#e07b39">
        <sphereGeometry args={[0.36, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </Toon>
      {[-0.14, 0.14].map((x) => (
        <group key={x} position={[x, 1.25, 0.28]}>
          <Toon color="#ffffff" outline={0.02}>
            <sphereGeometry args={[0.12, 12, 12]} />
          </Toon>
          <mesh position={[0, 0, 0.1]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshBasicMaterial color="#1b1e27" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// Broken couriers block the road: anyone behind them on the same route
// queues behind the jam instead of riding through it.
export const blockers = new Map<string, Vector3>();
const SAMPLES = 120;
const samples = Object.fromEntries(houses.map((h) => [h, routes[h].curve.getSpacedPoints(SAMPLES)])) as Record<House, Vector3[]>;
const lengths = Object.fromEntries(houses.map((h) => [h, routes[h].curve.getLength()])) as Record<House, number>;
const JAM_LENGTH = 6.2; // the blocker plus the cars queued behind it

/** The furthest a courier on `house`'s route may ride before hitting a jam. */
function clearUntil(house: House, from: number, self: string) {
  let limit = 1;
  for (const [id, at] of blockers) {
    if (id === self) continue;
    let best = -1;
    let bestD = 0.6; // only blockers actually on this route count
    samples[house].forEach((p, i) => {
      const d = p.distanceTo(at);
      if (d < bestD) [best, bestD] = [i, d];
    });
    const u = best / SAMPLES;
    if (best >= 0 && u > from - 0.01) limit = Math.min(limit, u - JAM_LENGTH / lengths[house]);
  }
  return Math.max(0, limit);
}

export const carColors = ["#d9413e", "#3d7fd9", "#f2c14e", "#8e5bd6", "#3f9e4f"];

export function Car({ color }: { color: string }) {
  return (
    <group>
      <Toon position={[0, 0.38, 0]} color={color}>
        <boxGeometry args={[0.9, 0.4, 1.5]} />
      </Toon>
      <Toon position={[0, 0.74, -0.1]} color="#e8eef2" outline={0.025}>
        <boxGeometry args={[0.72, 0.34, 0.8]} />
      </Toon>
      {[-0.5, 0.5].map((z) =>
        [-0.46, 0.46].map((x) => (
          <Toon key={`${x}${z}`} position={[x, 0.16, z]} rotation={[0, 0, Math.PI / 2]} color="#2f3542" outline={0.015}>
            <cylinderGeometry args={[0.16, 0.16, 0.12, 12]} />
          </Toon>
        )),
      )}
    </group>
  );
}

/** Cars queued nose to tail behind a stuck courier, honking. */
function Jam({ seed, honk }: { seed: number; honk: boolean }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    // Impatient cars lurch forward and stop.
    ref.current?.children.forEach((c, i) => (c.position.y = Math.max(0, Math.sin(clock() * 7 + i * 2)) * 0.06));
  });
  return (
    <group>
      <group ref={ref}>
        {[1.7, 3.5, 5.3].map((z, i) => (
          <group key={z} position={[0, 0, -z]}>
            <Car color={carColors[(seed + i) % carColors.length]} />
          </group>
        ))}
      </group>
      {honk && (
        <Html position={[0, 2.2, -3.5]} center zIndexRange={[8, 0]} className="bubble honk">
          <div>
            <span className="icons">📢🚗🚗</span>
            <small>HONK! Stuck in traffic</small>
          </div>
        </Html>
      )}
    </group>
  );
}

const TEST = "#7c4dff";

/** A pulsing ring on the road under the smoke test's courier. */
function Spotlight() {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const s = 1 + Math.sin(clock() * 4) * 0.12;
    ref.current?.scale.set(s, 1, s);
  });
  return (
    <group ref={ref}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
        <ringGeometry args={[1.0, 1.3, 32]} />
        <meshBasicMaterial color={TEST} />
      </mesh>
    </group>
  );
}

function Courier({ order, index, state, lost, test }: { order: Order; index: number; state?: Trouble; lost: boolean; test: boolean }) {
  const ref = useRef<Group>(null);
  const progress = useRef(0);
  const want = useRef(new Vector3());
  const house = houseFor(order.id);
  // At the shop, waiting for the parcel: no positions yet and the ride out is done.
  const collecting =
    (useLive.getState().drivers[order.driverId ?? ""]?.length ?? 0) === 0 && progress.current > routes[house].collectAt - 0.03 && order.stage === "Assigned";
  useEffect(() => () => void blockers.delete(order.id), [order.id]);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const pings = useLive.getState().drivers[order.driverId ?? ""]?.length ?? 0;
    const target = Math.min(targetProgress(useLive.getState().orders[order.id] ?? order, pings, routes[house].collectAt), clearUntil(house, progress.current, order.id));
    // Couriers only ever move forward; a jam ahead just holds them where they are.
    progress.current += Math.min(Math.max(0, target - progress.current) * Math.min(1, dt * 1.8), MAX_SPEED * dt);
    if (state) blockers.set(order.id, g.position.clone());
    else blockers.delete(order.id);
    const route = routes[house].curve;
    const p = route.getPointAt(progress.current);
    const tangent = route.getTangentAt(progress.current);
    const moving = Math.abs(target - progress.current) > 0.004;
    const bounce = Math.abs(Math.sin(clock() * (moving ? 11 : 3) + index)) * (moving ? 0.22 : 0.06);
    // Couriers on the same stretch of road ride side by side.
    const side = ((index % 3) - 1) * 0.35;
    const live = useLive.getState().orders[order.id] ?? order;
    const detour = detourAt(live, Date.now());
    if (detour === undefined) want.current.set(p.x + tangent.z * side, 0, p.z - tangent.x * side);
    else want.current.copy(gardenPath.getPointAt(detour));
    // Ease towards the target, so a wrong turn is a wander rather than a jump.
    const dx = want.current.x - g.position.x;
    const dz = want.current.z - g.position.z;
    const k = Math.min(1, dt * 3);
    g.position.set(g.position.x + dx * k, state === "burning" ? 0 : bounce, g.position.z + dz * k);
    g.rotation.y = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : Math.atan2(tangent.x, tangent.z);
  });
  return (
    <group ref={ref}>
      {/* a burning scooter has tipped over */}
      <group rotation={[0, 0, state === "burning" ? 1.2 : 0]} position={[state === "burning" ? 0.9 : 0, 0, 0]}>
        <Gopher withBug={index === 0} />
      </group>
      {state === "burning" && (
        <>
          <Fire size={2.4} />
          <Html position={[0, 6, 0]} center zIndexRange={[9, 0]} className="bubble alarm">
            <div>
              <span className="icons">🔥🛵🔥</span>
              <small>Courier down: {order.id.slice(0, 8)}</small>
            </div>
          </Html>
        </>
      )}
      {state && <Jam seed={index} honk={state === "stalled"} />}
      {collecting && !state && !test && (
        <Html position={[0, 2.6, 0]} center zIndexRange={[8, 0]} className="bubble">
          <div>
            <span className="icons">🏪📦</span>
            <small>Collecting</small>
          </div>
        </Html>
      )}
      {test && (
        <>
          <Spotlight />
          <Html position={[0, 3.4, 0]} center zIndexRange={[9, 0]} className="bubble test">
            <div>
              <span className="icons">🧪📦</span>
              <small>Test delivery</small>
            </div>
          </Html>
        </>
      )}
      {lost && !state && (
        <Html position={[0, 2.6, 0]} center zIndexRange={[8, 0]} className="bubble lost">
          <div>
            <span className="icons">🤔📦</span>
            <small>Is this the right house?</small>
          </div>
        </Html>
      )}
    </group>
  );
}

export function Couriers() {
  const orders = useLive((s) => s.orders);
  const now = useNow();
  const testOrder = useLive((s) => s.smoke?.orderId);
  const riding = Object.values(orders).filter((o) => o.driverId);
  return riding.map((o, i) => (
    <Courier key={o.id} order={o} index={i} state={trouble(o, now)} lost={detourAt(o, now) !== undefined} test={o.id === testOrder} />
  ));
}
