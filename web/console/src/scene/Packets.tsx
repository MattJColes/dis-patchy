import { QuadraticBezierLine } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { clock, useLive, type Packet } from "../live/store";
import { edges, HOP_SECONDS, type NodeId } from "../topology";
import { useReducedMotion } from "../useReducedMotion";
import { arc } from "./paths";
import { Toon } from "./toon";

export const TEAL = "#1aa39a";

function Route({ a, b }: { a: NodeId; b: NodeId }) {
  const ref = useRef<{ material: { dashOffset: number } }>(null);
  const c = arc(a, b);
  const reduced = useReducedMotion();
  useFrame((_, dt) => {
    if (ref.current && !reduced) ref.current.material.dashOffset -= dt * 0.8;
  });
  return <QuadraticBezierLine ref={ref as never} start={c.v0} mid={c.v1} end={c.v2} color={TEAL} lineWidth={2.4} dashed dashSize={0.35} gapSize={0.3} />;
}

export function Routes() {
  return edges.map(([a, b]) => <Route key={`${a}>${b}`} a={a} b={b} />);
}

/** What a packet looks like: parcels, letters, coins and location pings. */
function Shape({ packet }: { packet: Packet }) {
  const end = packet.path.at(-1);
  if (packet.kind === "Ping")
    return (
      <Toon color={TEAL} outline={0.02}>
        <sphereGeometry args={[0.13, 12, 12]} />
      </Toon>
    );
  if (end === "billing")
    return (
      <Toon color="#f2c14e" rotation={[Math.PI / 2, 0, 0]} outline={0.025}>
        <cylinderGeometry args={[0.24, 0.24, 0.07, 18]} />
      </Toon>
    );
  if (end === "customer" || packet.kind === "WorkflowStatus")
    return (
      <Toon color={packet.kind === "WorkflowStatus" ? "#efe3ff" : "#ffffff"} outline={0.025}>
        <boxGeometry args={[0.5, 0.34, 0.06]} />
      </Toon>
    );
  return (
    <group>
      <Toon color="#c99a5b" outline={0.03}>
        <boxGeometry args={[0.42, 0.36, 0.42]} />
      </Toon>
      <mesh position={[0, 0.185, 0]}>
        <boxGeometry args={[0.12, 0.01, 0.43]} />
        <meshBasicMaterial color="#e8d3ad" />
      </mesh>
    </group>
  );
}

const ease = (x: number) => x * x * (3 - 2 * x);

function Flying({ packet }: { packet: Packet }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const u = (clock() - packet.startedAt) / HOP_SECONDS;
    const hops = packet.path.length - 1;
    if (u >= hops || hops < 1) {
      g.visible = false;
      return;
    }
    const i = Math.floor(u);
    g.visible = true;
    g.position.copy(arc(packet.path[i], packet.path[i + 1]).getPoint(ease(u - i)));
    g.rotation.y = u * 2.5;
  });
  return (
    <group ref={ref} visible={false}>
      <Shape packet={packet} />
    </group>
  );
}

export function Packets() {
  const packets = useLive((s) => s.packets);
  return packets.map((p) => <Flying key={p.id} packet={p} />);
}
