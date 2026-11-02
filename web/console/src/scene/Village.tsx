import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { CanvasTexture, Group, RepeatWrapping, Vector3 } from "three";
import { clock, detourAt, trouble, useLive, useNow } from "../live/store";
import { houseFor, houses, nodes, type House, type NodeId } from "../topology";
import { branch, bridges, doorAt, END_COTTAGE, footpaths, frontOf, gardenPath, NEIGHBOUR, river, road, routes, SHOPS, SQUARE, streets, TURN, type Street } from "./paths";
import { hopFor, seeded, Toon } from "./toon";

function stripes(color: string) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 8;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? "#fbf4e6" : color;
    g.fillRect(i * 8, 0, 8, 8);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function Window({ position }: { position: [number, number, number] }) {
  return (
    <Toon position={position} color="#ffd27a" emissive="#ffb84d" outline={0.02}>
      <boxGeometry args={[0.42, 0.5, 0.06]} />
    </Toon>
  );
}

interface ShopProps {
  position: [number, number, number];
  rotation: number;
  wall: string;
  awning: string;
  sign: string;
}

function Shop({ position, rotation, wall, awning, sign }: ShopProps) {
  const awningTexture = useMemo(() => stripes(awning), [awning]);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Toon position={[0, 0.95, 0]} color={wall}>
        <boxGeometry args={[2.4, 1.9, 2]} />
      </Toon>
      <Toon position={[0, 2.0, 0]} color="#4b5563">
        <boxGeometry args={[2.7, 0.22, 2.3]} />
      </Toon>
      <mesh position={[0, 1.45, 1.25]} rotation={[0.55, 0, 0]} castShadow>
        <boxGeometry args={[2.3, 0.06, 0.8]} />
        <meshToonMaterial map={awningTexture} />
      </mesh>
      <Window position={[-0.6, 0.85, 1.01]} />
      <Window position={[0.6, 0.85, 1.01]} />
      <Toon position={[0, 0.5, 1.01]} color="#3a4a5c" outline={0.02}>
        <boxGeometry args={[0.45, 1, 0.06]} />
      </Toon>
      {[-0.9, 0.85].map((x) => (
        <Toon key={x} position={[x, 0.18, 1.45]} color="#c99a5b" outline={0.02}>
          <boxGeometry args={[0.38, 0.36, 0.38]} />
        </Toon>
      ))}
      <Html position={[0, 2.55, 0.4]} center zIndexRange={[5, 0]} className="shop-sign">
        <span>{sign}</span>
      </Html>
    </group>
  );
}

function Cottage({
  position = [10.4, 0, -1.4],
  rotation = -0.7,
  roof = "#3b4a63",
  scale = 1,
}: {
  position?: [number, number, number];
  rotation?: number;
  roof?: string;
  scale?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <Toon position={[0, 1.05, 0]} color="#eadcc0">
        <boxGeometry args={[2.6, 2.1, 2.2]} />
      </Toon>
      <Toon position={[0, 2.55, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1.55, 1]} color={roof}>
        <cylinderGeometry args={[1.1, 1.1, 2.5, 3]} />
      </Toon>
      <Toon position={[0.8, 3.1, -0.4]} color="#8c5a3c">
        <boxGeometry args={[0.35, 0.8, 0.35]} />
      </Toon>
      <Toon position={[0.3, 0.6, 1.11]} color="#1f4d45" outline={0.02}>
        <boxGeometry args={[0.6, 1.2, 0.06]} />
      </Toon>
      <Window position={[-0.6, 1.2, 1.11]} />
      <Toon position={[1.05, 0.25, 1.35]} color="#c96a3b" outline={0.02}>
        <cylinderGeometry args={[0.18, 0.13, 0.35, 10]} />
      </Toon>
      <Toon position={[1.05, 0.55, 1.35]} color="#6f9e4f" outline={0.02}>
        <icosahedronGeometry args={[0.28, 0]} />
      </Toon>
    </group>
  );
}

/** Stepping stones up to the neighbour's door, where lost couriers go. */
function GardenPath() {
  return gardenPath.getSpacedPoints(9).map((p, i) => (
    <mesh key={i} position={[p.x, 0.07, p.z]} receiveShadow>
      <cylinderGeometry args={[0.28, 0.3, 0.06, 8]} />
      <meshToonMaterial color="#cdbf9f" />
    </mesh>
  ));
}

export const DEPOT: [number, number, number] = [1.4, 0, 11.2];

function Depot() {
  return (
    <group position={DEPOT} rotation={[0, 0.2, 0]}>
      <Toon position={[0, 0.7, 0]} color="#f2e6c8">
        <boxGeometry args={[2.2, 1.4, 1.6]} />
      </Toon>
      <Toon position={[0, 1.55, 0]} color="#e07b39">
        <boxGeometry args={[2.5, 0.25, 1.9]} />
      </Toon>
      <Toon position={[0, 0.5, 0.81]} color="#3a4a5c" outline={0.02}>
        <boxGeometry args={[1.3, 0.95, 0.06]} />
      </Toon>
      <Html position={[0, 2.05, 0.3]} center zIndexRange={[5, 0]} className="shop-sign">
        <span>🛵</span>
      </Html>
    </group>
  );
}

function Person({ color }: { color: string }) {
  return (
    <>
      <Toon position={[0, 0.35, 0]} color={color} outline={0.025}>
        <capsuleGeometry args={[0.18, 0.3, 4, 10]} />
      </Toon>
      <Toon position={[0, 0.78, 0]} color="#f3cfa6" outline={0.025}>
        <sphereGeometry args={[0.2, 14, 14]} />
      </Toon>
    </>
  );
}

/** A villager who hops on the spot, higher when a shop sends an order. */
function Villager({ position, color, phase }: { position: [number, number, number]; color: string; phase: number }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const t = clock();
    const order = hopFor("shop", t - phase * 0.1);
    const idle = Math.max(0, Math.sin(t * 2.4 + phase)) * 0.15;
    ref.current?.position.setY(idle + order.y * 0.6);
  });
  return (
    <group position={position}>
      <group ref={ref}>
        <Person color={color} />
      </group>
    </group>
  );
}

/** When a node last had a delivery (not just an email) land on it. */
function lastDelivery(node: NodeId, t: number) {
  let last = -Infinity;
  for (const a of useLive.getState().arrivals) if (a.node === node && a.kind === "OrderDelivered" && a.at <= t && a.at > last) last = a.at;
  return last;
}

const OUT_FOR = 2.8; // seconds a resident stays out collecting

/** A customer who steps out to collect their parcel, bouncing, then goes back in; emails get a hop in the doorway. */
function Resident({ house, color }: { house: House; color: string }) {
  const ref = useRef<Group>(null);
  const inside = useMemo(() => frontOf(house, doorAt(house) + 0.15), [house]);
  const outside = useMemo(() => frontOf(house, doorAt(house) + 1.0), [house]);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = clock();
    const d = t - lastDelivery(house, t);
    const out = d < OUT_FOR ? Math.min(1, d / 0.5, (OUT_FOR - d) / 0.5) : 0;
    g.position.lerpVectors(inside, outside, out);
    const hop = hopFor(house, t);
    g.position.y = hop.y * 0.5 + (out > 0.9 ? Math.abs(Math.sin(t * 9)) * 0.35 : 0);
    g.visible = out > 0 || hop.y > 0;
  });
  return (
    <group ref={ref} visible={false}>
      <Person color={color} />
    </group>
  );
}

function Tree({ position, scale }: { position: [number, number, number]; scale: number }) {
  return (
    <group position={position} scale={scale}>
      <Toon position={[0, 0.4, 0]} color="#7a5232" outline={0.025}>
        <cylinderGeometry args={[0.1, 0.14, 0.8, 6]} />
      </Toon>
      <Toon position={[0, 1.05, 0]} color="#6f9e4f" outline={0.03}>
        <icosahedronGeometry args={[0.55, 0]} />
      </Toon>
      <Toon position={[0.25, 1.45, 0.1]} color="#8fbf5f" outline={0.03}>
        <icosahedronGeometry args={[0.38, 0]} />
      </Toon>
    </group>
  );
}

const keepClear: [number, number, number][] = [
  ...SHOPS.map((s) => s.position),
  [10.4, 0, -1.4],
  DEPOT,
  NEIGHBOUR,
  [7.6, 0, -1.4],
  [1.0, 0, 1.9],
];

function useTrees() {
  return useMemo(() => {
    const rand = seeded(7);
    const roadPoints = [...Object.values(streets), ...footpaths].flatMap((c) => c.getSpacedPoints(60));
    const riverPoints = [...river.getSpacedPoints(80), ...branch.getSpacedPoints(60)];
    const trees: { position: [number, number, number]; scale: number }[] = [];
    // Capped, so a crowded layout leaves fewer trees rather than hanging the page.
    for (let tries = 0; trees.length < 46 && tries < 4000; tries++) {
      const p = new Vector3(-15 + rand() * 30, 0, -11 + rand() * 23);
      const clear =
        roadPoints.every((r) => r.distanceTo(p) > 1.6) &&
        riverPoints.every((r) => r.distanceTo(p) > 2) &&
        keepClear.every((k) => p.distanceTo(new Vector3(...k)) > 2.4);
      if (clear) trees.push({ position: [p.x, 0, p.z], scale: 0.8 + rand() * 0.6 });
    }
    return trees;
  }, []);
}

export const ROUTE_COLOR = { ok: "#1aa39a", odd: "#e0a21c", bad: "#d9413e" };
type Health = keyof typeof ROUTE_COLOR;

/** Each street's dashed route line, coloured by the worst courier on it. */
function StreetLines() {
  const orders = useLive((s) => s.orders);
  const now = useNow(500);
  const health: Record<Street, Health> = { high: "ok", orchard: "ok", depot: "ok" };
  for (const o of Object.values(orders)) {
    if (!o.driverId) continue;
    const h: Health = trouble(o, now) ? "bad" : detourAt(o, now) !== undefined ? "odd" : "ok";
    // A lost courier wanders off Orchard Lane, so that lane goes amber too.
    const on = h === "odd" ? [...routes[houseFor(o.id)].streets, "orchard" as const] : routes[houseFor(o.id)].streets;
    for (const st of on) if (h === "bad" || health[st] === "ok") health[st] = h;
  }
  return (Object.keys(streets) as Street[]).map((st) => (
    <Line
      key={st}
      points={streets[st].getSpacedPoints(80).map((p) => [p.x, 0.12, p.z] as [number, number, number])}
      color={ROUTE_COLOR[health[st]]}
      lineWidth={health[st] === "ok" ? 2.5 : 4}
      dashed
      dashSize={0.35}
      gapSize={0.3}
    />
  ));
}

function Bridge({ street, at, wide }: { street: typeof road; at: number; wide: boolean }) {
  const p = street.getPointAt(at);
  const tangent = street.getTangentAt(at);
  const angle = Math.atan2(tangent.x, tangent.z);
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, angle, 0]}>
      <Toon position={[0, 0.22, 0]} color="#b8b2a7">
        <boxGeometry args={[wide ? 1.8 : 1.2, 0.24, 3.2]} />
      </Toon>
      {(wide ? [-0.9, 0.9] : [-0.6, 0.6]).map((x) => (
        <Toon key={x} position={[x, 0.5, 0]} color="#9c968b" outline={0.025}>
          <boxGeometry args={[0.16, 0.36, 3.2]} />
        </Toon>
      ))}
    </group>
  );
}

function Lamp({ at }: { at: number }) {
  const p = road.getPointAt(at);
  const n = road.getTangentAt(at).cross(new Vector3(0, 1, 0)).multiplyScalar(1.1);
  return (
    <group position={[p.x + n.x, 0, p.z + n.z]}>
      <Toon position={[0, 0.7, 0]} color="#2f3542" outline={0.02}>
        <cylinderGeometry args={[0.05, 0.07, 1.4, 6]} />
      </Toon>
      <Toon position={[0, 1.5, 0]} color="#ffd27a" emissive="#ffb84d" outline={0.025}>
        <boxGeometry args={[0.24, 0.3, 0.24]} />
      </Toon>
    </group>
  );
}

// Patchwork farmland behind the village: crops, a lavender field, hedgerows and haystacks.
const CROPS = ["#cfd98a", "#e6cf7a", "#a9c46c", "#9b86c9", "#d8b86a", "#b7cf7d"];

function Fields() {
  const fields = useMemo(() => {
    const rand = seeded(3);
    const out: { x: number; z: number; w: number; d: number; color: string; turn: number }[] = [];
    for (let row = 0; row < 3; row++)
      for (let x = -32; x < 32; ) {
        const w = 5 + rand() * 6;
        out.push({ x: x + w / 2, z: -15 - row * 6.5, w, d: 5.6, color: CROPS[Math.floor(rand() * CROPS.length)], turn: (rand() - 0.5) * 0.08 });
        x += w + 0.5;
      }
    return out;
  }, []);
  const stacks = useMemo(() => {
    const rand = seeded(5);
    return Array.from({ length: 9 }, () => [-26 + rand() * 52, -14 - rand() * 18] as [number, number]);
  }, []);
  return (
    <group>
      {fields.map((f, i) => (
        <group key={i} position={[f.x, 0.02, f.z]} rotation={[0, f.turn, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[f.w, f.d]} />
            <meshToonMaterial color={f.color} />
          </mesh>
          {/* the hedgerow along the field's near edge */}
          <Toon position={[0, 0.25, f.d / 2 + 0.25]} color="#5f8a45" outline={0.02}>
            <boxGeometry args={[f.w, 0.5, 0.4]} />
          </Toon>
        </group>
      ))}
      {stacks.map(([x, z], i) => (
        <Toon key={i} position={[x, 0.45, z]} rotation={[0, 0, Math.PI / 2]} color="#e2c06a" outline={0.025}>
          <cylinderGeometry args={[0.45, 0.45, 0.9, 14]} />
        </Toon>
      ))}
    </group>
  );
}

export function Village() {
  const trees = useTrees();
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[90, 90]} />
        <meshToonMaterial color="#efe5cc" />
      </mesh>
      {[
        [-11, 6, 4],
        [6, -7, 5],
        [12, 7, 3.5],
        [-12, -8, 3],
      ].map(([x, z, r], i) => (
        <mesh key={i} position={[x, 0.01, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[r, 24]} />
          <meshToonMaterial color="#d3dfa7" />
        </mesh>
      ))}
      <mesh position={[0, 0.03, 0]} scale={[1, 0.04, 1]} receiveShadow>
        <tubeGeometry args={[river, 120, 1.15, 8, false]} />
        <meshToonMaterial color="#5aa7d8" />
      </mesh>
      <mesh position={[0, 0.03, 0]} scale={[1, 0.04, 1]} receiveShadow>
        <tubeGeometry args={[branch, 100, 0.8, 8, false]} />
        <meshToonMaterial color="#5aa7d8" />
      </mesh>
      {(Object.keys(streets) as Street[]).map((st) => (
        <mesh key={st} position={[0, 0.06, 0]} scale={[1, 0.05, 1]} receiveShadow>
          <tubeGeometry args={[streets[st], 120, st === "high" ? 0.75 : 0.5, 8, false]} />
          <meshToonMaterial color="#e6d3a9" />
        </mesh>
      ))}
      <StreetLines />
      {/* the shops' square and the footpaths up to each shop door */}
      <mesh position={[SQUARE.x, 0.05, SQUARE.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[1.5, 24]} />
        <meshToonMaterial color="#d8c69e" />
      </mesh>
      {footpaths.map((f, i) => (
        <mesh key={i} position={[0, 0.05, 0]} scale={[1, 0.05, 1]} receiveShadow>
          <tubeGeometry args={[f, 24, 0.38, 8, false]} />
          <meshToonMaterial color="#d8c69e" />
        </mesh>
      ))}
      {bridges.map((b, i) => (
        <Bridge key={i} street={b.street} at={b.at} wide={b.street === road} />
      ))}
      {SHOPS.map((shop) => (
        <Shop key={shop.sign} {...shop} />
      ))}
      <Villager position={[-8.2, 0, -1.3]} color="#e86f3e" phase={0} />
      <Villager position={[-7.4, 0, -0.2]} color="#3d6fc4" phase={1.7} />
      <Villager position={[-9.2, 0, 0.4]} color="#3f9e4f" phase={3.1} />
      <Cottage position={END_COTTAGE} />
      {houses.map((h, i) => (
        <Resident key={h} house={h} color={["#d9487a", "#3d7fd9", "#f2c14e"][i]} />
      ))}
      <Cottage position={[nodes.customer2.position[0], 0, nodes.customer2.position[2]]} rotation={TURN.customer2} roof="#4f7a3a" scale={0.7} />
      <Cottage position={[nodes.customer3.position[0], 0, nodes.customer3.position[2]]} rotation={TURN.customer3} roof="#6b4f8c" scale={0.7} />
      <Cottage position={NEIGHBOUR} rotation={TURN.neighbour} roof="#8c3b3b" scale={0.7} />
      <GardenPath />
      <Depot />
      {[0.12, 0.42, 0.62, 0.86].map((at) => (
        <Lamp key={at} at={at} />
      ))}
      {trees.map((t, i) => (
        <Tree key={i} {...t} />
      ))}
      <Fields />
    </group>
  );
}
