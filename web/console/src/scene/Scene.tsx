import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { OrthographicCamera } from "three";
import { clock, useLive } from "../live/store";
import { nodes } from "../topology";
import { Bubbles } from "./Bubbles";
import { Cloud } from "./Cloud";
import { Couriers } from "./Couriers";
import { Packets, Routes } from "./Packets";
import { Village } from "./Village";

const PAPER = "#f6efdf";

function Pruner() {
  const last = useRef(0);
  useFrame(() => {
    const t = clock();
    if (t - last.current > 0.5) {
      last.current = t;
      useLive.getState().prune(t);
    }
  });
  return null;
}

/** Zooms the orthographic camera so the whole village fits any screen. */
function FitCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as OrthographicCamera;
    // Phones crop the village's edges rather than shrink it to a postage stamp.
    cam.zoom = Math.min(size.width / (size.width < 760 ? 22 : 34), size.height / 21);
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

function GroundLabels() {
  return (["shop", "driver", "customer"] as const).map((id) => {
    const [x, , z] = nodes[id].position;
    return (
      <Html key={id} position={[x, -0.1, z + 1.2]} center zIndexRange={[4, 0]} className="chip ground">
        <span style={{ ["--c" as string]: nodes[id].color }}>{nodes[id].label}</span>
      </Html>
    );
  });
}

export function Scene() {
  return (
    <Canvas orthographic shadows camera={{ position: [14, 17, 24], zoom: 40, near: -100, far: 200 }} dpr={[1, 2]} className="scene">
      <color attach="background" args={[PAPER]} />
      <hemisphereLight args={["#fff7e8", "#c9b98f", 1.4]} />
      <directionalLight
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
      <Village />
      <Cloud />
      <Routes />
      <Packets />
      <Couriers />
      <Bubbles />
      <GroundLabels />
      <Pruner />
      <FitCamera />
      <OrbitControls
        target={[2.6, 3.9, 0.6]}
        enablePan={false}
        enableDamping
        minPolarAngle={0.55}
        maxPolarAngle={1.15}
        minAzimuthAngle={-0.3}
        maxAzimuthAngle={1.2}
        minZoom={15}
        maxZoom={120}
      />
    </Canvas>
  );
}
