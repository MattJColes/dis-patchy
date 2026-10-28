import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { clock } from "../live/store";
import { nodes, type NodeId, type SystemNode } from "../topology";
import { hopFor, Toon } from "./toon";

const stacks: NodeId[] = ["orders", "dispatch", "tracking", "proof", "notifications", "billing", "bus"];

const icon: Record<string, string> = {
  orders: "λ",
  dispatch: "⇄",
  tracking: "◉",
  proof: "▣",
  notifications: "✉",
  billing: "$",
  bus: "⋔",
};

/** One stack as a cube in the cloud; it hops when a packet lands on it. */
function StackCube({ node, phase }: { node: SystemNode; phase: number }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const t = clock();
    const hop = hopFor(node.id, t);
    const g = ref.current;
    if (!g) return;
    g.position.y = node.position[1] + Math.sin(t * 1.3 + phase) * 0.08 + hop.y * 0.55;
    g.scale.set(2 - hop.squash, hop.squash, 2 - hop.squash);
  });
  return (
    <group ref={ref} position={node.position}>
      <Toon color={node.color} rotation={[0, 0.15, 0]}>
        <boxGeometry args={[1.15, 1.15, 1.15]} />
      </Toon>
      <Html position={[0, 0, 0.6]} center zIndexRange={[6, 0]} className="cube-icon">
        <span>{icon[node.id]}</span>
      </Html>
      <Html position={[0, -0.95, 0.4]} center zIndexRange={[6, 0]} className="chip">
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
  return (
    <group>
      {puffs.map(([x, y, z, r], i) => (
        <Toon key={i} position={[x, y, z]} color={i % 2 ? "#f9cf98" : "#fbdcae"} outline={0.05}>
          <sphereGeometry args={[r, 24, 18]} />
        </Toon>
      ))}
      {/* the patchy part: duct tape holding the cloud together */}
      {[
        [-6.4, 8.6, -5.2, 0.7],
        [7.4, 8.4, -5.2, -0.6],
        [0.6, 3.6, -4.6, 0.2],
      ].map(([x, y, z, r], i) => (
        <Toon key={i} position={[x, y, z]} rotation={[0, 0, r]} color="#c7ccd3" outline={0.02}>
          <boxGeometry args={[1.9, 0.38, 0.08]} />
        </Toon>
      ))}
      {[-1.6, 0, 1.6].map((x) => (
        <Toon key={x} position={[x + 0.6, 4.2, -4.2]} color="#2f3542" outline={0.025}>
          <boxGeometry args={[1.3, 0.55, 0.9]} />
        </Toon>
      ))}
      {stacks.map((id, i) => (
        <StackCube key={id} node={nodes[id]} phase={i * 0.9} />
      ))}
    </group>
  );
}
