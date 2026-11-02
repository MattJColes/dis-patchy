import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import type { BloomEffect } from "postprocessing";
import { useMemo, useRef } from "react";
import { Color, Object3D, type DirectionalLight, type HemisphereLight, type InstancedMesh, type MeshBasicMaterial } from "three";
import { clock, sceneWorldAt, useLive } from "../live/store";
import { useReducedMotion } from "../useReducedMotion";
import { seeded } from "./toon";

const DAY = new Color("#f6efdf"); // the README banner's paper
const DUSK = new Color("#f0b98a");
const NIGHT = new Color("#232a48");
const STORM = new Color("#4f5f7a");
const RAIN_BLUE = new Color("#8fb0dc"); // the cool cast that wet weather gives everything
const SUN = new Color("#fff7e8");
const LOW_SUN = new Color("#ffc48a");
const SKY_DAY = new Color("#fff7e8");
const SKY_NIGHT = new Color("#7d8fd6"); // moonlight, so night reads blue rather than brown

const DROPS = 1400;
const AREA = { x: 34, y: 16, z: 26 };

/** Falling rain; a storm uses every drop, rain half, a clear sky none. */
function Rain({ live }: { live: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  const splashes = useRef<InstancedMesh>(null);
  const reduced = useReducedMotion();
  const drops = useMemo(() => {
    const rand = seeded(11);
    return Array.from({ length: DROPS }, () => [(rand() - 0.5) * AREA.x, rand() * AREA.y, (rand() - 0.5) * AREA.z - 1]);
  }, []);
  const dummy = useMemo(() => new Object3D(), []);
  useFrame((_, dt) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock();
    const { weather } = sceneWorldAt(t, live);
    const heavy = weather === "storm";
    mesh.count = weather === "clear" ? 0 : heavy ? DROPS : DROPS / 2;
    if (splashes.current) splashes.current.count = weather === "clear" || reduced ? 0 : heavy ? 40 : 20;
    if (mesh.count === 0) return;
    (mesh.material as MeshBasicMaterial).opacity = heavy ? 0.58 : 0.38;
    const fall = reduced ? 0 : Math.min(dt, 0.1) * (heavy ? 22 : 15);
    drops.forEach((d, i) => {
      d[1] -= fall;
      d[0] -= fall * 0.15; // a little wind
      if (d[1] < 0) [d[0], d[1]] = [d[0] + AREA.y * 0.15, d[1] + AREA.y];
      dummy.position.set(d[0], d[1], d[2]);
      dummy.rotation.set(0, 0, 0.15);
      dummy.scale.set(1, 0.7 + (i % 4) * 0.15, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    const rings = splashes.current;
    if (!rings) return;
    for (let i = 0; i < rings.count; i++) {
      const f = (t * 1.5 + i * 0.37) % 1;
      dummy.position.set(drops[i][0], 0.13, drops[i][2]);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(0.04 + f * 0.18);
      dummy.updateMatrix();
      rings.setMatrixAt(i, dummy.matrix);
    }
    rings.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, DROPS]} frustumCulled={false}>
        <boxGeometry args={[0.018, 0.4, 0.018]} />
        <meshBasicMaterial color="#b9dbe3" transparent opacity={0.45} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={splashes} args={[undefined, undefined, 40]} frustumCulled={false}>
        <ringGeometry args={[0.65, 1, 8]} />
        <meshBasicMaterial color="#d5ece8" transparent opacity={0.3} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

/** Sky colour, sunlight and weather, driven by the village clock. */
export function Sky() {
  const { scene } = useThree();
  const reduced = useReducedMotion();
  const mode = useLive((s) => s.mode);
  const hemi = useRef<HemisphereLight>(null);
  const sun = useRef<DirectionalLight>(null);
  const bg = useMemo(() => new Color(), []);
  const bloom = useRef<BloomEffect>(null);

  useFrame(() => {
    const t = clock();
    const w = sceneWorldAt(t, mode === "live");
    const dim = w.weather === "storm" ? 0.45 : w.weather === "rain" ? 0.7 : 1;
    // Night → dusk → day, then greyed by the weather.
    const light = w.daylight;
    const wet = w.weather === "clear" ? 0 : w.weather === "rain" ? 0.55 : 0.8;
    bg.copy(NIGHT).lerp(DUSK, Math.min(1, light * 2)).lerp(DAY, Math.max(0, light * 2 - 1));
    bg.lerp(w.weather === "storm" ? STORM : RAIN_BLUE, wet * Math.max(0.3, light));
    // Lightning: a short flash every few seconds in a storm.
    const flash = !reduced && w.weather === "storm" && t % 5.3 < 0.09;
    if (flash) bg.set("#f4f6ff");
    scene.background = bg;
    if (hemi.current) {
      hemi.current.intensity = flash ? 3 : 0.55 + 0.85 * light * dim;
      hemi.current.color.copy(SKY_NIGHT).lerp(SKY_DAY, light).lerp(RAIN_BLUE, wet * 0.6);
    }
    // Clear days get a stronger sun and a soft glow; rain and night lose both.
    const sunny = w.weather === "clear" ? light : 0;
    if (sun.current) {
      sun.current.intensity = 0.1 + 1.35 * light * dim + 0.2 * sunny;
      sun.current.color.copy(LOW_SUN).lerp(SUN, light);
    }
    // Bloom: a sunny haze by day, glowing windows and headlamps by night.
    if (bloom.current) bloom.current.intensity = 0.12 + 0.22 * sunny + 0.35 * (1 - light);
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={["#fff7e8", "#c9b98f", 1.4]} />
      <directionalLight
        ref={sun}
        position={[8, 22, 12]}
        intensity={1.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-bias={-0.0005}
      />
      <Rain live={mode === "live"} />
      <EffectComposer>
        <Bloom ref={bloom as never} mipmapBlur luminanceThreshold={0.82} luminanceSmoothing={0.2} intensity={0.4} />
      </EffectComposer>
    </>
  );
}
