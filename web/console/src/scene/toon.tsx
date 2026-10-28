// The banner's look: flat cel shading with an ink outline on everything.
import { Outlines } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import { DataTexture, NearestFilter, RedFormat } from "three";
import { useLive } from "../live/store";
import type { NodeId } from "../topology";

export const INK = "#2b2f3a";

const gradient = new DataTexture(new Uint8Array([90, 170, 255]), 3, 1, RedFormat);
gradient.minFilter = gradient.magFilter = NearestFilter;
gradient.needsUpdate = true;

type ToonProps = ThreeElements["mesh"] & { color: string; outline?: number; emissive?: string };

/** A cel-shaded, ink-outlined mesh; pass the geometry as the child. */
export function Toon({ color, outline = 0.035, emissive, children, ...mesh }: ToonProps) {
  return (
    <mesh castShadow receiveShadow {...mesh}>
      {children}
      <meshToonMaterial color={color} gradientMap={gradient} emissive={emissive ?? "#000"} emissiveIntensity={emissive ? 0.6 : 0} />
      {outline > 0 && <Outlines thickness={outline} color={INK} />}
    </mesh>
  );
}

const HOP = 0.55; // seconds per hop

/** Height and squash for a node that hops when a packet lands on it. */
export function hopFor(node: NodeId, t: number) {
  let last = -Infinity;
  for (const a of useLive.getState().arrivals) if (a.node === node && a.at <= t && a.at > last) last = a.at;
  const d = t - last;
  if (d > HOP) return { y: 0, squash: 1 };
  return { y: Math.sin((Math.PI * d) / HOP), squash: 1 - 0.18 * Math.exp(-d * 10) };
}

/** Stable pseudo-random numbers, so the village is the same every load. */
export function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}
