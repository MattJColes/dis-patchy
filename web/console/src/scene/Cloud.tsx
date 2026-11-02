import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { clock, dispatchTrouble, useLive, useNow, type Trouble } from "../live/store";
import { nodes, type NodeId, type SystemNode } from "../topology";
import { emblems } from "./Emblems";
import { Fire } from "./Fire";
import { Model } from "./Models";
import { useReducedMotion } from "../useReducedMotion";
import { hopFor } from "./toon";

const stacks: NodeId[] = ["orders", "dispatch", "tracking", "proof", "notifications", "billing", "bus"];

interface LabelBox { x: number; y: number; width: number; height: number }

/** Keep compact labels beside their icons, with enough room to read each name. */
export function serviceLabelPositions(labels: LabelBox[], width: number, height: number, obstacles: LabelBox[] = []) {
  const placed = [...obstacles];
  return labels.map((label) => {
    let chosen = label;
    search: for (const row of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
      for (const side of [0, -1, 1]) {
        const box = {
          width: label.width,
          height: label.height,
          x: Math.max(8, Math.min(width - label.width - 8, label.x + side * (label.width + 6))),
          y: Math.max(8, Math.min(height - label.height - 8, label.y + row * (label.height + 6))),
        };
        if (placed.every((other) => box.x + box.width + 3 <= other.x || box.x >= other.x + other.width + 3 || box.y + box.height + 3 <= other.y || box.y >= other.y + other.height + 3)) {
          chosen = box;
          break search;
        }
      }
    }
    placed.push(chosen);
    return { x: chosen.x - label.x, y: chosen.y - label.y };
  });
}

/** The service emblem, turning slowly above the cloud. */
function Emblem({ id, phase }: { id: NodeId; phase: number }) {
  const ref = useRef<Group>(null);
  const reduced = useReducedMotion();
  useFrame(() => {
    if (ref.current) ref.current.rotation.y = reduced ? 0 : Math.sin(clock() * 0.6 + phase) * 0.5;
  });
  const Model = emblems[id];
  return (
    <group ref={ref} position={[0, 0.75, 0]} scale={1.25}>
      <Model />
    </group>
  );
}

/** The icon and label carry landing and incident feedback without a coloured stand. */
function ServiceIcon({ node, phase, state }: { node: SystemNode; phase: number; state?: Trouble }) {
  const ref = useRef<Group>(null);
  const reduced = useReducedMotion();
  useFrame(() => {
    const t = clock();
    const hop = reduced ? { y: 0, squash: 1 } : hopFor(node.id, t);
    const g = ref.current;
    if (!g) return;
    g.position.y = node.position[1] + hop.y * 0.55;
    g.scale.set(2 - hop.squash, hop.squash, 2 - hop.squash);
    // A stack in trouble rattles in place.
    g.position.x = node.position[0] + (state === "burning" && !reduced ? Math.sin(t * 40) * 0.06 : 0);
  });
  return (
    <group ref={ref} position={node.position} name={`service-${node.id}`}>
      {state && (
        <group position={[0.2, 0.3, 0.4]}>
          <Fire size={1.5} smoulder={state === "stalled"} />
        </group>
      )}
      <Emblem id={node.id} phase={phase} />
      <Html position={[0, -0.3, 0.4]} center zIndexRange={[6, 0]} className={`chip service-label service-${node.id}${state ? " troubled" : ""}`}>
        <i className="label-tether" aria-hidden="true" />
        <span style={{ ["--c" as string]: node.color }}>{node.label}{state && (state === "burning" ? " · 🔥" : " · Stalled")}</span>
      </Html>
    </group>
  );
}

// Puffs sit behind the icons so they frame them rather than hide them.
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
  const size = useThree((s) => s.size);
  const last = useRef(0);
  useFrame(() => {
    if (clock() - last.current < 0.1) return;
    last.current = clock();
    const labels = [...document.querySelectorAll<HTMLSpanElement>(".service-label > span")];
    labels.forEach((label) => { label.style.translate = "0 0"; });
    const sorted = labels.map((label) => ({ label, box: label.getBoundingClientRect() })).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    const obstacles = [...document.querySelectorAll(".topbar, .smoke, .timeline, .controls, .shop-sign span")].map((element) => element.getBoundingClientRect());
    const offsets = size.width <= 1100 ? serviceLabelPositions(sorted.map(({ box }) => box), size.width, size.height, obstacles) : sorted.map(() => ({ x: 0, y: 0 }));
    sorted.forEach(({ label }, index) => {
      const { x, y } = offsets[index];
      label.style.translate = `${x}px ${y}px`;
      const tether = label.previousElementSibling as HTMLElement;
      tether.style.width = `${Math.hypot(x, y)}px`;
      tether.style.rotate = `${Math.atan2(y, x)}rad`;
    });
  });
  return (
    <group>
      {puffs.map(([x, y, z, r], i) => (
        <Model key={i} name="cloudPuff" position={[x, y + 2.5, z]} scale={r * 0.8} color={i % 2 ? "#edf3ef" : "#f7faf6"} emissive="#e8f0e9" glow={0.07} outline={0.018} />
      ))}
      {stacks.map((id, i) => (
        <ServiceIcon key={id} node={nodes[id]} phase={i * 0.9} state={id === "dispatch" ? dispatch : undefined} />
      ))}
    </group>
  );
}
