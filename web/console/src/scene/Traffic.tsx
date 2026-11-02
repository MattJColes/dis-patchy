import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3, type Camera, type CatmullRomCurve3, type Group, type Object3D } from "three";
import { liveCars } from "../hud/Controls";
import { useLive, useNow } from "../live/store";
import { blockers, Car, carColors } from "./Couriers";
import { LANE_OFFSET, roadPose, streets, townRoad } from "./paths";

const SPEED = 2.4; // world units a second
const GAP = 2.2; // how close a car gets behind a jam before it stops

const lanes: CatmullRomCurve3[] = [streets.high, townRoad, streets.orchard, streets.high, townRoad, streets.depot];

/** Count cars actually in the camera view, including queues and transformed parents. */
export function countVisibleCars(scene: Object3D, camera: Camera) {
  camera.updateWorldMatrix(true, false);
  const point = new Vector3();
  let count = 0;
  scene.traverseVisible((object) => {
    if (object.userData.trafficCar !== true) return;
    object.getWorldPosition(point).project(camera);
    if (Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1) count++;
  });
  return count;
}

/** One car driving up and down its street, stopping behind any stuck courier. */
function Driver({ index }: { index: number }) {
  const ref = useRef<Group>(null);
  const curve = lanes[index % lanes.length];
  const end = curve === townRoad ? 0.3 : 1;
  const length = useMemo(() => curve.getLength(), [curve]);
  const samples = useMemo(() => curve.getSpacedPoints(120), [curve]);
  const state = useRef({ u: ((index * 0.37) % 1) * (curve === townRoad ? 0.12 : 1), dir: index % 2 ? 1 : -1 });
  const initial = useRef(roadPose(curve, state.current.u, -state.current.dir * LANE_OFFSET)).current;
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
    if (s.u > end || s.u < 0) [s.u, s.dir] = [Math.min(end, Math.max(0, s.u)), -s.dir]; // turn round at the street's end
    // Keep to the right, as in France.
    const pose = roadPose(curve, s.u, -s.dir * LANE_OFFSET);
    g.position.copy(pose.position);
    g.rotation.y = pose.angle + (s.dir < 0 ? Math.PI : 0);
  });
  return (
    <group ref={ref} name={`traffic-driver-${index}`} scale={0.8} position={initial.position} rotation={[0, initial.angle + (index % 2 ? 0 : Math.PI), 0]}>
      <Car color={carColors[index % carColors.length]} />
    </group>
  );
}

/** The other traffic on the roads: set by the slider in the demo, by event volume when live. */
export function Traffic() {
  const mode = useLive((s) => s.mode);
  const traffic = useLive((s) => s.traffic);
  useNow(1000);
  const count = mode === "live" ? liveCars() : traffic;
  return Array.from({ length: count }, (_, i) => <Driver key={i} index={i} />);
}
