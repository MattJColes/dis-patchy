// Fine warm ink and sparse, surface-anchored print shading.
import { Outlines } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import { DataTexture, NearestFilter, RedFormat, type MeshToonMaterial } from "three";
import { useLive } from "../live/store";
import type { NodeId } from "../topology";

export const INK = "#493e37";

const gradient = new DataTexture(new Uint8Array([125, 195, 255]), 3, 1, RedFormat);
gradient.minFilter = gradient.magFilter = NearestFilter;
gradient.needsUpdate = true;

type ToonProps = ThreeElements["mesh"] & { color: string; outline?: number; emissive?: string; glow?: number };

export function illustrate(shader: Parameters<MeshToonMaterial["onBeforeCompile"]>[0]) {
  shader.vertexShader = "varying vec3 vInkPosition;\n" + shader.vertexShader.replace(
    "#include <project_vertex>",
    "#include <project_vertex>\nvInkPosition = transformed;",
  );
  shader.fragmentShader = "varying vec3 vInkPosition;\n" + shader.fragmentShader.replace("#include <opaque_fragment>", `
    float inkPhase = dot(vInkPosition, vec3(1.0, 0.7, 0.35)) * 14.0;
    float inkWidth = fwidth(inkPhase);
    float inkLine = 1.0 - smoothstep(0.035, 0.035 + inkWidth, abs(fract(inkPhase) - 0.5));
    float inkResolved = 1.0 - smoothstep(0.3, 0.8, inkWidth);
    float inkLight = dot(outgoingLight / max(diffuseColor.rgb, vec3(0.05)), vec3(0.2126, 0.7152, 0.0722));
    float inkShadow = 1.0 - smoothstep(0.5, 1.4, inkLight);
    vec3 inkCell = floor(vInkPosition * 32.0);
    float inkGrain = fract(sin(dot(inkCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float inkPaper = 1.0 - smoothstep(0.4, 1.0, length(fwidth(vInkPosition * 32.0)));
    outgoingLight *= 1.0 - 0.025 * inkGrain * inkPaper - 0.13 * inkLine * inkShadow * inkResolved;
    #include <opaque_fragment>
  `);
}

/** A cel-shaded, ink-outlined mesh; pass the geometry as the child. */
export function Toon({ color, outline = 0.035, emissive, glow = 0.6, children, ...mesh }: ToonProps) {
  return (
    <mesh castShadow receiveShadow {...mesh}>
      {children}
      <meshToonMaterial color={color} gradientMap={gradient} emissive={emissive ?? "#000"} emissiveIntensity={emissive ? glow : 0} onBeforeCompile={illustrate} />
      {outline > 0 && <Outlines thickness={outline * 0.65} color={INK} />}
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
