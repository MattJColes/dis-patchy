import { Html, Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, Group, PlaneGeometry, RepeatWrapping, SRGBColorSpace, Vector3 } from "three";
import { clock, detourAt, trouble, useLive, useNow } from "../live/store";
import { houseFor, houses, nodes, type House, type NodeId } from "../topology";
import { Model } from "./Models";
import { branch, bridges, doorAt, END_COTTAGE, fieldIsDry, footpaths, frontOf, gardenPath, NEIGHBOUR, river, road, rollingHeight, routes, SHOPS, SQUARE, streets, townRoad, TURN, type Street } from "./paths";
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
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

function cobbles() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#a49b87";
  g.fillRect(0, 0, 128, 128);
  const colors = ["#e7dcc4", "#ddd0b7", "#eee4d0", "#d3c6af"];
  for (let row = 0; row < 8; row++)
    for (let col = -1; col < 4; col++) {
      g.fillStyle = colors[(row + col + 4) % colors.length];
      g.fillRect(col * 32 + (row % 2) * 16 + 1, row * 16 + 1, 30, 14);
    }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(12, 1);
  return t;
}

function groundGrain() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#efe5cc";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#ded2b3";
  const rand = seeded(31);
  for (let i = 0; i < 64; i++) {
    const x = rand() * 128;
    const y = rand() * 128;
    g.beginPath();
    g.moveTo(x - 1, y + 2);
    g.lineTo(x, y);
    g.lineTo(x + 1, y + 2);
    g.stroke();
  }
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(24, 24);
  return texture;
}

function farmlandGeometry() {
  const geometry = new PlaneGeometry(240, 110, 80, 37);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i);
    const v = positions.getY(i);
    positions.setZ(i, rollingHeight(u, -60 - v));
  }
  geometry.computeVertexNormals();
  return geometry;
}

function Window({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Toon color="#ffdfa2" emissive="#ffb84d" glow={0.35} outline={0}>
        <boxGeometry args={[0.48, 0.62, 0.06]} />
      </Toon>
      <Model name="windowFrame" color="#f8ebd3" outline={0.015} />
      <Model name="shutters" color="#6e9eab" outline={0.018} />
    </group>
  );
}

interface ShopProps {
  position: [number, number, number];
  rotation: number;
  wall: string;
  awning: string;
  sign: string;
  name: string;
}

function Shop({ position, rotation, wall, awning, sign, name }: ShopProps) {
  const awningTexture = useMemo(() => stripes(awning), [awning]);
  const gl = useThree((s) => s.gl);
  // Keep labels on one DOM host while Canvas connects its pointer events.
  const portal = useMemo(() => ({ current: gl.domElement.parentElement! }), [gl]);
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Model name="softBox" position={[0, 1.18, 0]} scale={[2.4, 2.36, 2]} color={wall} />
      <Model name="roof" position={[0, 2.36, 0]} scale={[1.38, 0.85, 1.18]} color="#bd6c49" />
      <Model name="chimney" position={[0.78, 2.75, -0.3]} scale={0.8} color="#d5b393" outline={0.02} />
      <mesh position={[0, 1.48, 1.25]} rotation={[0.42, 0, 0]} castShadow>
        <boxGeometry args={[2.3, 0.06, 0.8]} />
        <meshToonMaterial map={awningTexture} />
      </mesh>
      <mesh position={[0, 1.25, 1.61]} castShadow>
        <boxGeometry args={[2.3, 0.2, 0.04]} />
        <meshToonMaterial map={awningTexture} />
      </mesh>
      {[-0.78, 0.78].map((x) => (
        <group key={x} position={[x, 0.85, 1.01]} scale={0.75}>
          <Window position={[0, 0, 0]} />
        </group>
      ))}
      <Toon position={[0, 0.53, 1.01]} color="#427d78" outline={0.02}>
        <boxGeometry args={[0.5, 1.05, 0.06]} />
      </Toon>
      <Model name="doorFrame" position={[0, 0, 1.05]} scale={0.85} color="#f6e7cb" outline={0.015} />
      {[-0.9, 0.85].map((x) => (
        <Toon key={x} position={[x, 0.18, 1.45]} color="#c99a5b" outline={0.02}>
          <boxGeometry args={[0.38, 0.36, 0.38]} />
        </Toon>
      ))}
      {[-1, 0, 1].map((i) =>
        name === "Boulangerie" ? (
          <Model key={i} name="bread" position={[0.85 + i * 0.12, 0.57, 1.45]} rotation={[-1.1, 0, i * 0.16]} color="#e3b46d" outline={0.01} />
        ) : name === "Librairie" ? (
          <Model key={i} name="softBox" position={[0.85 + i * 0.11, 0.5, 1.45]} scale={[0.09, 0.29, 0.24]} rotation={[0, 0, i * 0.12]} color={["#bd6c49", "#6e9eab", "#9b86b1"][i + 1]} outline={0.01} />
        ) : (
          <Toon key={i} position={[0.85 + i * 0.11, 0.42, 1.45]} color={i === 0 ? "#ce8a64" : "#86a66a"} outline={0.01}>
            <icosahedronGeometry args={[0.1, 0]} />
          </Toon>
        ),
      )}
      <Html portal={portal} position={[0, 3.65, 0.2]} center zIndexRange={[5, 0]} className="shop-sign">
        <span>{sign}<small>{name}</small></span>
      </Html>
    </group>
  );
}

function Cottage({
  position = [10.4, 0, -1.4],
  rotation = -0.7,
  roof = "#bd6c49",
  scale = 1,
}: {
  position?: [number, number, number];
  rotation?: number;
  roof?: string;
  scale?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      <Model name="softBox" position={[0, 1.05, 0]} scale={[2.6, 2.1, 2.2]} color="#eadcc0" />
      <Model name="roof" position={[0, 2.1, 0]} scale={[1.5, 1.1, 1.3]} color={roof} />
      <Model name="chimney" position={[0.8, 2.65, -0.4]} color="#cfab89" outline={0.02} />
      <Toon position={[0.3, 0.6, 1.11]} color="#1f4d45" outline={0.02}>
        <boxGeometry args={[0.6, 1.2, 0.06]} />
      </Toon>
      <Model name="doorFrame" position={[0.3, 0, 1.14]} color="#f8ebd3" outline={0.018} />
      <Window position={[-0.6, 1.2, 1.11]} />
      <Toon position={[-0.6, 0.73, 1.22]} color="#b86d4b" outline={0.018}>
        <boxGeometry args={[0.75, 0.16, 0.25]} />
      </Toon>
      {[-0.86, -0.61, -0.37].map((x, i) => (
        <Toon key={x} position={[x, 0.9, 1.22]} color={i === 1 ? "#d695ac" : "#9883b7"} outline={0.01}>
          <icosahedronGeometry args={[0.13, 0]} />
        </Toon>
      ))}
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

export const DEPOT: [number, number, number] = [-0.7, 0, 11.3];

function Depot() {
  return (
    <group name="courier-depot" position={DEPOT} rotation={[0, Math.PI / 2, 0]}>
      <Model name="softBox" position={[0, 0.7, 0]} scale={[2.2, 1.4, 1.6]} color="#f2e6c8" />
      <Model name="roof" position={[0, 1.4, 0]} scale={[1.25, 0.65, 0.95]} color="#bc714a" />
      <Toon position={[0, 0.5, 0.81]} color="#3a4a5c" outline={0.02}>
        <boxGeometry args={[1.3, 0.95, 0.06]} />
      </Toon>
      <Html position={[0, 2.45, 0.2]} center zIndexRange={[5, 0]} className="shop-sign">
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
        <sphereGeometry args={[0.23, 10, 8]} />
      </Toon>
      <Toon position={[0, 0.95, -0.02]} scale={[1, 0.4, 1]} color="#575362" outline={0.02}>
        <sphereGeometry args={[0.26, 10, 6]} />
      </Toon>
      <Toon position={[0.07, 1.06, -0.02]} color="#575362" outline={0.01}>
        <boxGeometry args={[0.035, 0.065, 0.035]} />
      </Toon>
      {[-0.075, 0.075].map((x) => (
        <mesh key={x} position={[x, 0.83, 0.205]}>
          <sphereGeometry args={[0.028, 6, 4]} />
          <meshBasicMaterial color="#493e37" />
        </mesh>
      ))}
      <Toon position={[0, 0.77, 0.23]} color="#e8b994" outline={0.01}>
        <sphereGeometry args={[0.045, 6, 4]} />
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

function Tree({ position, scale, cypress }: { position: [number, number, number]; scale: number; cypress: boolean }) {
  return (
    <group position={position} scale={scale}>
      <Toon position={[0, 0.4, 0]} color="#7a5232" outline={0.025}>
        <cylinderGeometry args={[0.1, 0.14, 0.8, 6]} />
      </Toon>
      {cypress ? (
        <Model name="cypress" position={[0, 0.35, 0]} color="#628667" outline={0.025} />
      ) : (
        <>
          <Toon position={[0, 1.05, 0]} color="#86a66a" outline={0.03}>
            <icosahedronGeometry args={[0.6, 0]} />
          </Toon>
          <Toon position={[0.25, 1.45, 0.1]} color="#a5bd7e" outline={0.03}>
            <icosahedronGeometry args={[0.42, 0]} />
          </Toon>
        </>
      )}
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
    const roadPoints = [...Object.values(streets), townRoad, ...footpaths].flatMap((c) => c.getSpacedPoints(60));
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

export const ROUTE_COLOR = { ok: "#3766c4", odd: "#e0a21c", bad: "#d9413e" };
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
      dashSize={0.6}
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
      <Model name="bridge" position={[0, 0.02, 0]} scale={[wide ? 1.15 : 1.1, 0.55, 1]} color="#c6b89f" outline={0.025} />
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
      <Model name="lanternCap" position={[0, 1.68, 0]} color="#454d51" outline={0.018} />
      <Toon position={[0, 1.32, 0]} color="#454d51" outline={0.018}>
        <cylinderGeometry args={[0.18, 0.11, 0.1, 4]} />
      </Toon>
    </group>
  );
}

// Patchwork farmland behind the village: vineyards, lavender, crops and haystacks.
const CROPS = ["#c9d49c", "#e5cb88", "#adc18d", "#b09bc4", "#d6b788", "#c1cf9c"];
type FieldRow = { z: number; y: number; tilt: number };

function Fields() {
  const backdrop = useMemo(farmlandGeometry, []);
  const fields = useMemo(() => {
    const rand = seeded(3);
    const out: { x: number; z: number; w: number; d: number; color: string; turn: number; dry: boolean; rows: FieldRow[]; hedge: FieldRow }[] = [];
    for (let row = 0; row < 9; row++)
      for (let x = -100; x < 100; ) {
        const w = 10 + rand() * 10;
        const center = x + w / 2;
        const z = -15 - row * 9.5;
        const color = CROPS[Math.floor(rand() * CROPS.length)];
        const turn = (rand() - 0.5) * 0.04;
        const heightAt = (u: number, v: number) => rollingHeight(center + u * Math.cos(turn) + v * Math.sin(turn), z + v * Math.cos(turn) - u * Math.sin(turn));
        const rowAt = (v: number): FieldRow => {
          const left = heightAt(-w / 2, v);
          const right = heightAt(w / 2, v);
          return { z: v, y: (left + right) / 2, tilt: Math.atan2(right - left, w) };
        };
        out.push({
          x: center, z, w, d: 8.6, color, turn, dry: fieldIsDry(center, z, w, 8.6),
          rows: [-1.6, 0, 1.6].map(rowAt), hedge: rowAt(4.55),
        });
        x += w + 0.5;
      }
    return out;
  }, []);
  const paint = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#d8ccab";
    g.fillRect(0, 0, c.width, c.height);
    for (const [i, field] of fields.entries()) {
      g.setTransform(c.width / 240, 0, 0, c.height / 110, (field.x + 120) * c.width / 240, (field.z + 115) * c.height / 110);
      g.rotate(-field.turn);
      g.fillStyle = i % 4 === 1 ? "#c8c59a" : field.color;
      g.fillRect(-field.w / 2, -field.d / 2, field.w, field.d);
    }
    const texture = new CanvasTexture(c);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }, [fields]);
  useEffect(() => () => {
    backdrop.dispose();
    paint.dispose();
  }, [backdrop, paint]);
  const stacks = useMemo(() => {
    const rand = seeded(5);
    return Array.from({ length: 9 }, () => [-26 + rand() * 52, -14 - rand() * 18] as [number, number]).filter(([x, z]) => fieldIsDry(x, z, 1, 1));
  }, []);
  return (
    <group>
      <mesh geometry={backdrop} position={[0, 0.02, -60]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshToonMaterial map={paint} />
      </mesh>
      {fields.map((f, i) => (
        <group key={i} position={[f.x, 0.02, f.z]} rotation={[0, f.turn, 0]}>
          {f.dry && i % 4 === 1 && f.rows.map((row) => (
            <group key={row.z} position={[0, row.y, row.z]} rotation={[0, 0, row.tilt]}>
              <Toon position={[0, 0.55, 0]} rotation={[0, 0, Math.PI / 2]} color="#799568" outline={0.018}>
                <cylinderGeometry args={[0.2, 0.24, f.w - 0.7, 6]} />
              </Toon>
              {[-1, 1].map((side) => (
                <Toon key={side} position={[side * (f.w / 2 - 0.35), 0.4, 0]} color="#a78561" outline={0.012}>
                  <cylinderGeometry args={[0.045, 0.055, 0.8, 5]} />
                </Toon>
              ))}
            </group>
          ))}
          {/* the hedgerow along the field's near edge */}
          {f.dry && <group position={[0, f.hedge.y, f.hedge.z]} rotation={[0, 0, f.hedge.tilt]}>
            <Toon position={[0, 0.25, 0]} color="#739264" outline={0.02}>
              <boxGeometry args={[f.w, 0.5, 0.4]} />
            </Toon>
          </group>}
        </group>
      ))}
      {stacks.map(([x, z], i) => (
        <Toon key={i} position={[x, 0.45 + rollingHeight(x, z), z]} rotation={[0, 0, Math.PI / 2]} color="#e2c06a" outline={0.025}>
          <cylinderGeometry args={[0.45, 0.45, 0.9, 14]} />
        </Toon>
      ))}
    </group>
  );
}

export function Village() {
  const trees = useTrees();
  const paving = useMemo(cobbles, []);
  const grain = useMemo(groundGrain, []);
  useEffect(() => () => { paving.dispose(); grain.dispose(); }, [paving, grain]);
  const ripples = useMemo(() => river.getSpacedPoints(100).filter((p, i) => i % 2 === 0 && Math.abs(p.z) < 15), []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[240, 240]} />
        <meshToonMaterial map={grain} />
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
      <mesh position={[0, 0.01, 0]} scale={[1, 0.025, 1]} receiveShadow>
        <tubeGeometry args={[river, 160, 1.4, 8, false]} />
        <meshToonMaterial color="#d8c8a9" />
      </mesh>
      <mesh position={[0, 0.01, 0]} scale={[1, 0.025, 1]} receiveShadow>
        <tubeGeometry args={[branch, 120, 1, 8, false]} />
        <meshToonMaterial color="#d8c8a9" />
      </mesh>
      <mesh position={[0, 0.03, 0]} scale={[1, 0.04, 1]} receiveShadow>
        <tubeGeometry args={[river, 120, 1.15, 8, false]} />
        <meshToonMaterial color="#70c4c0" emissive="#459f9c" emissiveIntensity={0.12} />
      </mesh>
      <mesh position={[0, 0.03, 0]} scale={[1, 0.04, 1]} receiveShadow>
        <tubeGeometry args={[branch, 100, 0.8, 8, false]} />
        <meshToonMaterial color="#70c4c0" emissive="#459f9c" emissiveIntensity={0.12} />
      </mesh>
      {ripples.map((p, i) => (
        <Line
          key={i}
          points={[[p.x - 0.35, 0.085, p.z], [p.x - 0.1, 0.085, p.z + 0.08], [p.x + 0.28, 0.085, p.z]]}
          color="#d9f0df"
          lineWidth={1.5}
          transparent
          opacity={0.65}
        />
      ))}
      {(Object.keys(streets) as Street[]).map((st) => (
        <mesh key={st} position={[0, 0.06, 0]} scale={[1, 0.05, 1]} receiveShadow>
          <tubeGeometry args={[streets[st], 120, st === "high" ? 0.75 : 0.5, 8, false]} />
          <meshToonMaterial map={paving} color="#fffaf0" emissiveMap={paving} emissive="#b7aa91" emissiveIntensity={0.06} />
        </mesh>
      ))}
      <mesh name="road-to-other-towns" position={[0, 0.06, 0]} scale={[1, 0.05, 1]} receiveShadow>
        <tubeGeometry args={[townRoad, 180, 0.75, 8, false]} />
        <meshToonMaterial map={paving} color="#fffaf0" emissiveMap={paving} emissive="#b7aa91" emissiveIntensity={0.06} />
      </mesh>
      <mesh position={[0.8, 0.055, DEPOT[2]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1.7, 0.7]} />
        <meshToonMaterial map={paving} color="#fffaf0" />
      </mesh>
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
      <group position={[SQUARE.x - 1.5, 0, SQUARE.z - 1.7]} scale={0.8}>
        <Model name="fountain" color="#cbbfa8" outline={0.02} />
        <Toon position={[0, 0.3, 0]} color="#79b9c7" outline={0}>
          <cylinderGeometry args={[0.55, 0.55, 0.025, 12]} />
        </Toon>
      </group>
      <Villager position={[-8.2, 0, -1.3]} color="#e86f3e" phase={0} />
      <Villager position={[-7.4, 0, -0.2]} color="#3d6fc4" phase={1.7} />
      <Villager position={[-9.2, 0, 0.4]} color="#3f9e4f" phase={3.1} />
      <Cottage position={END_COTTAGE} />
      {houses.map((h, i) => (
        <Resident key={h} house={h} color={["#d9487a", "#3d7fd9", "#f2c14e"][i]} />
      ))}
      <Cottage position={[nodes.customer2.position[0], 0, nodes.customer2.position[2]]} rotation={TURN.customer2} roof="#c18361" scale={0.7} />
      <Cottage position={[nodes.customer3.position[0], 0, nodes.customer3.position[2]]} rotation={TURN.customer3} roof="#8f7b91" scale={0.7} />
      <Cottage position={NEIGHBOUR} rotation={TURN.neighbour} roof="#ac6657" scale={0.7} />
      <GardenPath />
      <Depot />
      {[0.12, 0.42, 0.62, 0.86].map((at) => (
        <Lamp key={at} at={at} />
      ))}
      {trees.map((t, i) => (
        <Tree key={i} {...t} cypress={i % 3 === 0} />
      ))}
      {trees.filter((t) => t.position[2] > 5 && fieldIsDry(t.position[0] + 0.45, t.position[2] + 0.3, 0.6, 0.6)).slice(0, 9).map((t, i) => (
        <group key={i} position={[t.position[0] + 0.45, 0, t.position[2] + 0.3]}>
          {[-1, 0, 1].map((side) => (
            <group key={side} position={[side * 0.15, 0, Math.abs(side) * 0.08]}>
              <Toon position={[0, 0.13, 0]} color="#799568" outline={0.006}>
                <cylinderGeometry args={[0.015, 0.025, 0.26, 4]} />
              </Toon>
              <Toon position={[0, 0.3, 0]} color={i % 2 ? "#c395a8" : "#a18cbe"} outline={0.009}>
                <icosahedronGeometry args={[0.09, 0]} />
              </Toon>
            </group>
          ))}
        </group>
      ))}
      <Fields />
    </group>
  );
}
