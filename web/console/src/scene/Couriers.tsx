import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, type RefObject } from "react";
import { Vector3, type CatmullRomCurve3, type Group } from "three";
import { clock, detourAt, sceneWorldAt, trouble, useLive, useNow, type Order, type Trouble } from "../live/store";
import { houseFor, houses, type House } from "../topology";
import { Fire } from "./Fire";
import { Model } from "./Models";
import { gardenPath, LANE_OFFSET, roadPose, routes } from "./paths";
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
    const w = sceneWorldAt(clock(), live);
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
      <Model name="scooter" color="#eac998" outline={0.025} />
      <Toon position={[0, 1.15, 0.6]} color="#2f3542" outline={0.02}>
        <boxGeometry args={[0.6, 0.07, 0.07]} />
      </Toon>
      {[-0.42, 0.42].map((z) => (
        <group key={z} position={[0, 0.22, z]} rotation={[0, 0, Math.PI / 2]}>
          <Toon color="#3d4145" outline={0.02}>
            <cylinderGeometry args={[0.22, 0.22, 0.16, 10]} />
          </Toon>
          <Toon position={[0, -0.085, 0]} color="#efdfc3" outline={0.01}>
            <cylinderGeometry args={[0.11, 0.11, 0.015, 10]} />
          </Toon>
        </group>
      ))}
      {/* parcels on the back */}
      <Model name="parcel" position={[0, 0.82, -0.42]} color="#c99a5b" outline={0.025} />
      <Model name="parcel" position={[0, 1.18, -0.42]} scale={0.8} color="#d9ad6e" outline={0.025} />
      <Toon position={[0, 0.83, -0.64]} color="#f4dfb5" outline={0}>
        <boxGeometry args={[0.08, 0.38, 0.015]} />
      </Toon>
      {withBug && (
        <Toon position={[0.05, 1.42, -0.42]} color="#e0393e" outline={0.02}>
          <sphereGeometry args={[0.1, 10, 10]} />
        </Toon>
      )}
      {/* the gopher */}
      <Model name="gopher" color="#79c7e3" emissive="#79c7e3" glow={0.08} outline={0.025} />
      <Toon position={[0, 1.55, 0.02]} scale={[1, 0.62, 1]} color="#c87953">
        <sphereGeometry args={[0.39, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </Toon>
      <Toon position={[0, 1.54, 0.29]} color="#c87953" outline={0.02}>
        <boxGeometry args={[0.52, 0.05, 0.23]} />
      </Toon>
      {[-0.14, 0.14].map((x) => (
        <group key={x} position={[x, 1.36, 0.31]}>
          <Toon color="#ffffff" outline={0.02}>
            <sphereGeometry args={[0.14, 10, 8]} />
          </Toon>
          <mesh position={[0, 0, 0.1]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshBasicMaterial color="#1b1e27" />
          </mesh>
        </group>
      ))}
      <Toon position={[0, 1.18, 0.36]} scale={[1, 0.72, 0.6]} color="#f6dfba" outline={0.015}>
        <sphereGeometry args={[0.14, 10, 6]} />
      </Toon>
      <Toon position={[0, 1.24, 0.45]} color="#423a36" outline={0}>
        <sphereGeometry args={[0.055, 8, 6]} />
      </Toon>
      <Toon position={[0, 1.1, 0.45]} color="#fffaf0" outline={0.01}>
        <boxGeometry args={[0.09, 0.1, 0.025]} />
      </Toon>
      <mesh position={[0, 1.1, 0.465]}>
        <boxGeometry args={[0.008, 0.09, 0.005]} />
        <meshBasicMaterial color="#493e37" />
      </mesh>
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

export const carColors = ["#c97f69", "#6b98ac", "#e3bb6b", "#9f8aad", "#7d9d78"];

export function Car({ color }: { color: string }) {
  return (
    <group name="village-car" userData={{ trafficCar: true }}>
      <Model name="carBody" scale={[1, 1, 0.84]} color={color} />
      <Model name="carCabin" scale={[1, 1.1, 0.9]} color="#b9cec9" outline={0.018} />
      <Model name="softBox" position={[0, 1.06, -0.12]} scale={[0.68, 0.13, 0.58]} color={color} outline={0.015} />
      <Model name="softBox" position={[0, 0.57, 0.47]} scale={[0.69, 0.13, 0.28]} color={color} outline={0.012} />
      {[-0.3, 0.3].map((x) => (
        <Model key={x} name="softBox" position={[x, 0.83, 0.21]} rotation={[-0.3, 0, 0]} scale={[0.045, 0.43, 0.045]} color={color} outline={0.008} />
      ))}
      {[-0.66, 0.66].map((z) => (
        <Model key={z} name="softBox" position={[0, 0.3, z]} scale={[0.7, 0.1, 0.065]} color="#e7ddc8" outline={0.012} />
      ))}
      {[-0.29, 0.29].map((x) => (
        <Toon key={x} position={[x, 0.45, 0.65]} color="#ffe5ab" emissive="#ffe5ab" glow={0.2} outline={0.01}>
          <sphereGeometry args={[0.11, 8, 6]} />
        </Toon>
      ))}
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
function Jam({ seed, honk, route, progress, side }: { seed: number; honk: boolean; route: CatmullRomCurve3; progress: RefObject<number>; side: number }) {
  const ref = useRef<Group>(null);
  const bubble = useRef<Group>(null);
  const length = route.getLength();
  const poseAt = (distance: number) => roadPose(route, Math.max(0, progress.current - distance / length), side);
  useFrame(() => {
    // Impatient cars lurch forward and stop.
    ref.current?.children.forEach((c, i) => {
      const pose = poseAt(1.7 + i * 1.8);
      c.position.copy(pose.position);
      c.position.y = Math.max(0, Math.sin(clock() * 7 + i * 2)) * 0.06;
      c.rotation.y = pose.angle;
    });
    bubble.current?.position.copy(poseAt(3.5).position);
  });
  return (
    <group>
      <group ref={ref}>
        {[1.7, 3.5, 5.3].map((distance, i) => (
          <group key={distance} name={`jam-car-${seed}-${i}`} position={poseAt(distance).position} rotation={[0, poseAt(distance).angle, 0]} scale={0.8}>
            <Car color={carColors[(seed + i) % carColors.length]} />
          </group>
        ))}
      </group>
      {honk && (
        <group ref={bubble} position={poseAt(3.5).position}>
          <Html position={[0, 2.2, 0]} center zIndexRange={[8, 0]} className="bubble honk">
            <div>
              <span className="icons">📢🚗🚗</span>
              <small>HONK! Stuck in traffic</small>
            </div>
          </Html>
        </group>
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
  const wandering = useRef(false);
  const house = houseFor(order.id);
  const side = ((index % 3) - 1) * LANE_OFFSET;
  const initial = useRef(roadPose(routes[house].curve, 0, side)).current;
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
    const live = useLive.getState().orders[order.id] ?? order;
    const detour = detourAt(live, Date.now());
    if (detour !== undefined) wandering.current = true;
    if (detour === undefined) want.current.set(p.x + tangent.z * side, 0, p.z - tangent.x * side);
    else want.current.copy(gardenPath.getPointAt(detour));
    // Ease towards the target, so a wrong turn is a wander rather than a jump.
    const dx = want.current.x - g.position.x;
    const dz = want.current.z - g.position.z;
    // Route progress already eases; easing world coordinates cuts across bends and bridges.
    const k = wandering.current ? Math.min(1, dt * 3) : 1;
    g.position.set(g.position.x + dx * k, state === "burning" ? 0 : bounce, g.position.z + dz * k);
    if (detour === undefined && Math.hypot(dx, dz) < 0.05) wandering.current = false;
    g.rotation.y = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : Math.atan2(tangent.x, tangent.z);
  });
  return (
    <>
    <group ref={ref} name={`courier-${order.id}`} position={initial.position} rotation={[0, initial.angle, 0]}>
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
    {state && <Jam seed={index} honk={state === "stalled"} route={routes[house].curve} progress={progress} side={side} />}
    </>
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
