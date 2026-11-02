import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { clock } from "../live/store";
import { useReducedMotion } from "../useReducedMotion";
import { Toon } from "./toon";

const flames: [string, number, number, number][] = [
  // colour, x, z, size
  ["#e8402a", 0, 0, 1],
  ["#ff8a1c", 0.18, 0.1, 0.75],
  ["#ff8a1c", -0.2, -0.08, 0.7],
  ["#ffd84a", 0.02, 0.04, 0.5],
];
const PUFFS = 5;

/** Cartoon flames and a rising smoke column; smoke alone for a smoulder. */
export function Fire({ size = 1, smoulder = false }: { size?: number; smoulder?: boolean }) {
  const fire = useRef<Group>(null);
  const smoke = useRef<Group>(null);
  const reduced = useReducedMotion();
  useFrame(() => {
    if (reduced) return;
    const t = clock();
    fire.current?.children.forEach((f, i) => {
      const s = 0.8 + 0.3 * Math.abs(Math.sin(t * (9 + i * 2.3) + i));
      f.scale.set(s, s * (1.1 + 0.35 * Math.sin(t * 13 + i * 1.7)), s);
    });
    smoke.current?.children.forEach((p, i) => {
      const f = (t * 0.5 + i / PUFFS) % 1;
      p.position.set(Math.sin(f * 5 + i) * 0.35, 0.6 + f * 3, 0);
      p.scale.setScalar((0.25 + f * 0.7) * (1 - f * 0.4));
    });
  });
  return (
    <group scale={size}>
      {!smoulder && (
        <group ref={fire}>
          {flames.map(([color, x, z, s], i) => (
            <Toon key={i} position={[x, 0.35 * s, z]} scale={s} color={color} emissive={color} outline={0.02}>
              <coneGeometry args={[0.32, 0.9, 7]} />
            </Toon>
          ))}
        </group>
      )}
      <group ref={smoke}>
        {Array.from({ length: PUFFS }, (_, i) => (
          <Toon key={i} position={[0, 0.6 + (i / PUFFS) * 3, 0]} scale={0.4} color={smoulder ? "#9aa0a8" : "#5c6068"} outline={0.02}>
            <sphereGeometry args={[0.5, 10, 8]} />
          </Toon>
        ))}
      </group>
    </group>
  );
}
