import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef } from "react";
import type { OrthographicCamera } from "three";
import { clock, useLive } from "../live/store";
import { houses, nodes } from "../topology";
import { Bubbles } from "./Bubbles";
import { Cloud } from "./Cloud";
import { Couriers } from "./Couriers";
import { Packets, Routes } from "./Packets";
import { NEIGHBOUR } from "./paths";
import { Sky } from "./Sky";
import { Traffic } from "./Traffic";
import { Village } from "./Village";

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
    cam.zoom = Math.min(size.width / (size.width <= 1100 ? 22 : 34), size.height / 25);
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

function GroundLabels() {
  return (
    <>
      {(["shop", "driver", ...houses] as const).map((id) => {
        const [x, , z] = nodes[id].position;
        return (
          <Html key={id} position={[x, -0.1, z + 1.2]} center zIndexRange={[4, 0]} className="chip ground">
            <span style={{ ["--c" as string]: nodes[id].color }}>{nodes[id].label}</span>
          </Html>
        );
      })}
      <Html position={[NEIGHBOUR[0], -0.1, NEIGHBOUR[2] + 1.2]} center zIndexRange={[4, 0]} className="chip ground">
        <span>Neighbour</span>
      </Html>
    </>
  );
}

export function Scene() {
  return (
    <Canvas orthographic shadows camera={{ position: [14, 17, 24], zoom: 40, near: -100, far: 200 }} dpr={[1, 2]} className="scene">
      <Sky />
      <Pruner />
      <FitCamera />
      <Suspense fallback={
        <Html fullscreen>
          <div className="village-loading" role="status">Getting the village ready…</div>
        </Html>
      }>
        <Village />
        <Cloud />
        <Routes />
        <Packets />
        <Couriers />
        <Traffic />
        <Bubbles />
        <GroundLabels />
      </Suspense>
      <OrbitControls
        target={[2.6, 4.4, 0.6]}
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
