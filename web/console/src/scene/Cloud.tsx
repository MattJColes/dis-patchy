import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { clock, dispatchTrouble, useLive, useNow, type Trouble } from "../live/store";
import { nodes, type NodeId, type SystemNode } from "../topology";
import { emblems } from "./Emblems";
import { Fire } from "./Fire";
import { Model } from "./Models";
import { hopFor, Toon } from "./toon";

const stacks: NodeId[] = ["orders", "dispatch", "tracking", "proof", "notifications", "billing", "bus"];

/** The stack's emblem, turning slowly on its plinth. */
function Emblem({ id, phase }: { id: NodeId; phase: number }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.rotation.y = Math.sin(clock() * 0.6 + phase) * 0.5;
  });
  const Model = emblems[id];
  return (
    <group ref={ref} position={[0, 0.75, 0]} scale={1.25}>
      <Model />
    </group>
  );
}

/** One stack as an icon on a coloured plinth in the cloud; it hops when a packet lands on it. */
function StackCube({ node, phase, state }: { node: SystemNode; phase: number; state?: Trouble }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const t = clock();
    const hop = hopFor(node.id, t);
    const g = ref.current;
    if (!g) return;
    g.position.y = node.position[1] + Math.sin(t * 1.3 + phase) * 0.08 + hop.y * 0.55;
    g.scale.set(2 - hop.squash, hop.squash, 2 - hop.squash);
    // A stack in trouble rattles in place.
    g.position.x = node.position[0] + (state === "burning" ? Math.sin(t * 40) * 0.06 : 0);
  });
  return (
    <group ref={ref} position={node.position}>
      <Toon castShadow={false} color={state === "burning" ? "#3a3d45" : node.color} emissive={state === "burning" ? undefined : node.color} glow={0.25}>
        <cylinderGeometry args={[0.72, 0.8, 0.28, 24]} />
      </Toon>
      {state && (
        // Dispatch sits at the top of the frame, so the flames lick the front of its plinth.
        <group position={[0.2, -0.1, 0.6]}>
          <Fire size={1.5} smoulder={state === "stalled"} />
        </group>
      )}
      <Emblem id={node.id} phase={phase} />
      <Html position={[0, -0.6, 0.4]} center zIndexRange={[6, 0]} className="chip">
        <span style={{ ["--c" as string]: node.color }}>{node.label}</span>
      </Html>
    </group>
  );
}

// Puffs sit behind the cubes so they frame them rather than hide them.
const puffs: [number, number, number, number][] = [
  [0.6, 7.6, -9, 3.6],
  [-4.2, 6.9, -8.2, 2.8],
  [5.4, 7.0, -8.2, 2.9],
  [-2, 10.2, -8.8, 2.6],
  [3.2, 10.3, -8.8, 2.5],
  [-7, 6.4, -6.8, 1.7],
  [8, 6.6, -7, 1.7],
  [0.6, 4.9, -6.6, 2.2],
];

export function Cloud() {
  const orders = useLive((s) => s.orders);
  const dispatch = dispatchTrouble(orders, useNow());
  return (
    <group>
      {puffs.map(([x, y, z, r], i) => (
        <Model key={i} name="cloudPuff" position={[x, y, z]} scale={r * 0.8} color={i % 2 ? "#edf3ef" : "#f7faf6"} emissive="#e8f0e9" glow={0.07} outline={0.018} />
      ))}
      {stacks.map((id, i) => (
        <StackCube key={id} node={nodes[id]} phase={i * 0.9} state={id === "dispatch" ? dispatch : undefined} />
      ))}
    </group>
  );
}
