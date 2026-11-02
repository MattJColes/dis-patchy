import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
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
  const embers = useRef<Group>(null);
  const burst = useRef<Group>(null);
  const ignited = useRef(0);
  const reduced = useReducedMotion();
  useEffect(() => { ignited.current = clock(); }, [smoulder]);
  useFrame(() => {
    if (reduced) {
      if (burst.current) burst.current.visible = false;
      return;
    }
    const t = clock();
    if (burst.current) {
      const f = Math.min(1, (t - ignited.current) / 0.6);
      burst.current.visible = !smoulder && f < 1;
      burst.current.children.forEach((p, i) => {
        const angle = (i / 4) * Math.PI * 2;
        p.position.set(Math.cos(angle) * f * 0.8, 0.35 + f * 0.5, Math.sin(angle) * f * 0.8);
        p.scale.setScalar(Math.sin(f * Math.PI) * 0.35);
      });
    }
    fire.current?.children.forEach((f, i) => {
      const s = 0.9 + 0.15 * Math.abs(Math.sin(t * (5 + i) + i));
      f.scale.set(s, s * (1 + 0.2 * Math.sin(t * 6 + i * 1.7)), s);
    });
    smoke.current?.children.forEach((p, i) => {
      const f = (t * 0.5 + i / PUFFS) % 1;
      p.position.set(Math.sin(f * 4 + i) * 0.3 + f * 0.3, 0.6 + f * 3, 0);
      p.scale.setScalar((0.25 + f * 0.7) * (1 - f * 0.4));
    });
    embers.current?.children.forEach((p, i) => {
      const f = (t * 0.6 + i / 4) % 1;
      p.position.set(Math.sin(f * 7 + i) * 0.2, 0.5 + f * 1.8, Math.cos(i) * 0.15);
      p.scale.setScalar(1 - f);
    });
  });
  return (
    <group scale={size}>
      <group ref={burst} visible={false}>
        {[0, 1, 2, 3].map((i) => (
          <Toon key={i} color={i % 2 ? "#edbf86" : "#f5d3a2"} outline={0.01}>
            <icosahedronGeometry args={[0.5, 1]} />
          </Toon>
        ))}
      </group>
      {!smoulder && (
        <group ref={fire}>
          {flames.map(([color, x, z, s], i) => (
            <group key={i} position={[x, 0, z]}>
              <Toon position={[0, 0.45 * s, 0]} scale={s} color={color} emissive={color} outline={0.015}>
                <coneGeometry args={[0.3, 0.9, 6]} />
              </Toon>
              <Toon position={[0, 0.18 * s, 0]} scale={[s, s * 0.7, s]} color={color} emissive={color} outline={0.012}>
                <sphereGeometry args={[0.26, 8, 6]} />
              </Toon>
            </group>
          ))}
        </group>
      )}
      {!smoulder && (
        <group ref={embers}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[0.12 * Math.sin(i), 0.6 + i * 0.4, 0]}>
              <sphereGeometry args={[0.025, 5, 3]} />
              <meshBasicMaterial color="#ffe6a0" />
            </mesh>
          ))}
        </group>
      )}
      <group ref={smoke}>
        {Array.from({ length: PUFFS }, (_, i) => (
          <Toon key={i} position={[0, 0.6 + (i / PUFFS) * 3, 0]} scale={0.4} color={smoulder ? "#b8b2a8" : "#908b83"} outline={0.01}>
            <sphereGeometry args={[0.5, 8, 6]} />
          </Toon>
        ))}
      </group>
    </group>
  );
}
