import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { CatmullRomCurve3, Group } from "three";
import { liveCars } from "../hud/Controls";
import { useLive, useNow } from "../live/store";
import { blockers, Car, carColors } from "./Couriers";
import { streets } from "./paths";

const SPEED = 2.4; // world units a second
const GAP = 2.2; // how close a car gets behind a jam before it stops

// Most cars use the high street; some take Orchard Row or the depot lane.
const lanes: CatmullRomCurve3[] = [streets.high, streets.high, streets.orchard, streets.high, streets.depot];

/** One car driving up and down its street, stopping behind any stuck courier. */
function Driver({ index }: { index: number }) {
  const ref = useRef<Group>(null);
  const curve = lanes[index % lanes.length];
  const length = useMemo(() => curve.getLength(), [curve]);
  const samples = useMemo(() => curve.getSpacedPoints(120), [curve]);
  const state = useRef({ u: (index * 0.37) % 1, dir: index % 2 ? 1 : -1 });
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const s = state.current;
    // A jam ahead on this street stops the car short of it.
    let blocked = false;
    for (const at of blockers.values()) {
      const i = samples.findIndex((p) => p.distanceTo(at) < 0.8);
      if (i < 0) continue;
      const ahead = (i / 120 - s.u) * s.dir * length;
      if (ahead > 0 && ahead < GAP + 1.5) blocked = true;
    }
    if (!blocked) s.u += (s.dir * SPEED * dt) / length;
    if (s.u > 1 || s.u < 0) [s.u, s.dir] = [Math.min(1, Math.max(0, s.u)), -s.dir]; // turn round at the street's end
    const p = curve.getPointAt(s.u);
    const t = curve.getTangentAt(s.u).multiplyScalar(s.dir);
    // Keep to the right, as in France.
    g.position.set(p.x - t.z * 0.38, 0, p.z + t.x * 0.38);
    g.rotation.y = Math.atan2(t.x, t.z);
  });
  return (
    <group ref={ref} scale={0.8}>
      <Car color={carColors[index % carColors.length]} />
    </group>
  );
}

/** The other traffic on the roads: set by the slider in the demo, by event volume when live. */
export function Traffic() {
  const mode = useLive((s) => s.mode);
  const traffic = useLive((s) => s.traffic);
  useNow(2000);
  const count = mode === "live" ? liveCars() : traffic;
  return Array.from({ length: count }, (_, i) => <Driver key={i} index={i} />);
}
