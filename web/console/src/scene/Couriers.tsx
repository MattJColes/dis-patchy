import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { clock, useLive, type Order } from "../live/store";
import { road } from "./paths";
import { Toon } from "./toon";

// ponytail: a courier's progress is guessed from its ping count (the smoke
// run and the demo both send ten), not from its coordinates; map real
// lat/lng onto the road if routes ever vary.
const PINGS_PER_TRIP = 10;

function targetProgress(order: Order, pings: number) {
  if (order.stage === "Delivered" || order.stage === "Billed") return 1;
  return Math.min(0.92, 0.03 + pings / PINGS_PER_TRIP);
}

function Gopher({ withBug }: { withBug: boolean }) {
  return (
    <group>
      {/* scooter */}
      <Toon position={[0, 0.42, 0]} color="#f2e6c8">
        <boxGeometry args={[0.5, 0.3, 1.15]} />
      </Toon>
      <Toon position={[0, 0.8, 0.5]} rotation={[-0.3, 0, 0]} color="#f2e6c8" outline={0.025}>
        <boxGeometry args={[0.14, 0.7, 0.14]} />
      </Toon>
      <Toon position={[0, 1.15, 0.6]} color="#2f3542" outline={0.02}>
        <boxGeometry args={[0.6, 0.07, 0.07]} />
      </Toon>
      {[-0.42, 0.42].map((z) => (
        <Toon key={z} position={[0, 0.22, z]} rotation={[0, 0, Math.PI / 2]} color="#2f3542" outline={0.02}>
          <cylinderGeometry args={[0.22, 0.22, 0.16, 16]} />
        </Toon>
      ))}
      {/* parcels on the back */}
      <Toon position={[0, 0.82, -0.42]} color="#c99a5b" outline={0.03}>
        <boxGeometry args={[0.46, 0.4, 0.42]} />
      </Toon>
      <Toon position={[0, 1.2, -0.42]} color="#d9ad6e" outline={0.03}>
        <boxGeometry args={[0.38, 0.32, 0.36]} />
      </Toon>
      {withBug && (
        <Toon position={[0.05, 1.42, -0.42]} color="#e0393e" outline={0.02}>
          <sphereGeometry args={[0.1, 10, 10]} />
        </Toon>
      )}
      {/* the gopher */}
      <Toon position={[0, 1.05, 0.02]} color="#79c7e3">
        <capsuleGeometry args={[0.32, 0.4, 6, 14]} />
      </Toon>
      <Toon position={[0, 1.45, 0.02]} scale={[1, 0.6, 1]} color="#e07b39">
        <sphereGeometry args={[0.36, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </Toon>
      {[-0.14, 0.14].map((x) => (
        <group key={x} position={[x, 1.25, 0.28]}>
          <Toon color="#ffffff" outline={0.02}>
            <sphereGeometry args={[0.12, 12, 12]} />
          </Toon>
          <mesh position={[0, 0, 0.1]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshBasicMaterial color="#1b1e27" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Courier({ order, index }: { order: Order; index: number }) {
  const ref = useRef<Group>(null);
  const progress = useRef(0);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const pings = useLive.getState().drivers[order.driverId ?? ""]?.length ?? 0;
    const target = targetProgress(useLive.getState().orders[order.id] ?? order, pings);
    progress.current += (target - progress.current) * Math.min(1, dt * 1.8);
    const p = road.getPointAt(progress.current);
    const tangent = road.getTangentAt(progress.current);
    const moving = Math.abs(target - progress.current) > 0.004;
    const bounce = Math.abs(Math.sin(clock() * (moving ? 11 : 3) + index)) * (moving ? 0.22 : 0.06);
    // Couriers on the same stretch of road ride side by side.
    const side = ((index % 3) - 1) * 0.35;
    g.position.set(p.x + tangent.z * side, bounce, p.z - tangent.x * side);
    g.rotation.y = Math.atan2(tangent.x, tangent.z);
  });
  return (
    <group ref={ref}>
      <Gopher withBug={index === 0} />
    </group>
  );
}

export function Couriers() {
  const orders = useLive((s) => s.orders);
  const riding = Object.values(orders).filter((o) => o.driverId && o.stage !== "Failed");
  return riding.map((o, i) => <Courier key={o.id} order={o} index={i} />);
}
