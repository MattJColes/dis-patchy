import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { CanvasTexture, Group, RepeatWrapping, Vector3 } from "three";
import { clock } from "../live/store";
import { bridgeAt, river, road } from "./paths";
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

function Cottage() {
  return (
    <group position={[10.4, 0, -1.4]} rotation={[0, -0.7, 0]}>
      <Toon position={[0, 1.05, 0]} color="#eadcc0">
        <boxGeometry args={[2.6, 2.1, 2.2]} />
      </Toon>
      <Toon position={[0, 2.55, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1.55, 1]} color="#3b4a63">
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

function Depot() {
  return (
    <group position={[1.6, 0, 7.6]} rotation={[0, 0.2, 0]}>
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
        <Toon position={[0, 0.35, 0]} color={color} outline={0.025}>
          <capsuleGeometry args={[0.18, 0.3, 4, 10]} />
        </Toon>
        <Toon position={[0, 0.78, 0]} color="#f3cfa6" outline={0.025}>
          <sphereGeometry args={[0.2, 14, 14]} />
        </Toon>
      </group>
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
  [-9.6, 0, -2.4],
  [-6.8, 0, -4.4],
  [-10.6, 0, 1.6],
  [10.4, 0, -1.4],
  [1.6, 0, 7.6],
];

function useTrees() {
  return useMemo(() => {
    const rand = seeded(7);
    const roadPoints = road.getSpacedPoints(60);
    const riverPoints = river.getSpacedPoints(80);
    const trees: { position: [number, number, number]; scale: number }[] = [];
    while (trees.length < 46) {
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

function Bridge() {
  const p = road.getPointAt(bridgeAt);
  const tangent = road.getTangentAt(bridgeAt);
  const angle = Math.atan2(tangent.x, tangent.z);
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, angle, 0]}>
      <Toon position={[0, 0.22, 0]} color="#b8b2a7">
        <boxGeometry args={[1.8, 0.24, 3.2]} />
      </Toon>
      {[-0.9, 0.9].map((x) => (
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

function Skyline() {
  const towers = useMemo(() => {
    const rand = seeded(3);
    return Array.from({ length: 22 }, (_, i) => ({ x: -26 + i * 2.5 + rand(), h: 2 + rand() * 7, w: 1 + rand() * 1.4 }));
  }, []);
  return (
    <group position={[0, 0, -20]}>
      {towers.map((t, i) => (
        <mesh key={i} position={[t.x, t.h / 2, (i % 3) * -1.5]}>
          <boxGeometry args={[t.w, t.h, t.w]} />
          <meshBasicMaterial color={i % 2 ? "#cfdbe4" : "#dbe4ea"} />
        </mesh>
      ))}
    </group>
  );
}

export function Village() {
  const trees = useTrees();
  const routeLine = useMemo(() => road.getSpacedPoints(80).map((p) => [p.x, 0.12, p.z] as [number, number, number]), []);
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
      <mesh position={[0, 0.06, 0]} scale={[1, 0.05, 1]} receiveShadow>
        <tubeGeometry args={[road, 120, 0.75, 8, false]} />
        <meshToonMaterial color="#e6d3a9" />
      </mesh>
      <Line points={routeLine} color="#1aa39a" lineWidth={2.5} dashed dashSize={0.35} gapSize={0.3} />
      <Bridge />
      <Shop position={[-9.6, 0, -2.4]} rotation={0.5} wall="#f3d9a8" awning="#e86f3e" sign="🥐" />
      <Shop position={[-6.8, 0, -4.4]} rotation={0.35} wall="#e6ddcc" awning="#3d6fc4" sign="📚" />
      <Shop position={[-10.6, 0, 1.6]} rotation={0.9} wall="#efe3c4" awning="#3f9e4f" sign="🥬" />
      <Villager position={[-8.2, 0, -1.3]} color="#e86f3e" phase={0} />
      <Villager position={[-7.4, 0, -0.2]} color="#3d6fc4" phase={1.7} />
      <Villager position={[-9.2, 0, 0.4]} color="#3f9e4f" phase={3.1} />
      <Cottage />
      <Depot />
      {[0.12, 0.42, 0.62, 0.86].map((at) => (
        <Lamp key={at} at={at} />
      ))}
      {trees.map((t, i) => (
        <Tree key={i} {...t} />
      ))}
      <Skyline />
    </group>
  );
}
