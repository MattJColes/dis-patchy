import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef, type ComponentRef } from "react";
import { Vector3, type OrthographicCamera } from "three";
import { clock, useLive } from "../live/store";
import { CLOUD_OFFSET, houses, nodes } from "../topology";
import { Bubbles } from "./Bubbles";
import { Cloud, cloudPuffs } from "./Cloud";
import { Couriers } from "./Couriers";
import { Packets, Routes } from "./Packets";
import { courtyardCorners, END_COTTAGE, NEIGHBOUR, SHOPS } from "./paths";
import { Sky } from "./Sky";
import { countVisibleCars, Traffic } from "./Traffic";
import { DEPOT, Village } from "./Village";

function Pruner() {
  const last = useRef(0);
  useFrame(({ scene, camera }) => {
    const t = clock();
    if (t - last.current > 0.5) {
      last.current = t;
      useLive.getState().prune(t);
      const visibleTraffic = countVisibleCars(scene, camera);
      if (visibleTraffic !== useLive.getState().visibleTraffic) useLive.setState({ visibleTraffic });
    }
  });
  return null;
}

/** Fits the important landmarks between the compact header and bottom cards. */
function FitCamera() {
  const { camera, size } = useThree();
  const orbit = useRef<ComponentRef<typeof OrbitControls>>(null);
  useEffect(() => {
    const cam = camera as OrthographicCamera;
    const compact = size.width <= 1100;
    const portrait = compact && size.height > size.width;
    const target = new Vector3(-0.8, 4.4, 1.3);
    cam.position.copy(target).add(new Vector3(...(portrait ? [28, 25, 18] : compact ? [16, 21, 28] : [10, 16, 26]) as [number, number, number]));
    cam.lookAt(target);
    orbit.current?.target.copy(target);
    orbit.current?.update();
    const landmarks = [
      ...SHOPS.flatMap(({ position: [x, , z] }) => [[x - 1.8, 0, z - 1.5], [x + 1.8, 4.4, z + 1.5]]),
      [END_COTTAGE[0] + 1.8, 3.8, END_COTTAGE[2]], [-0.3, 0, 12.6], [2.8, 2.8, 12.6],
      ...courtyardCorners.map((point) => point.toArray()), [-2.0, 1.6, 10.0],
      ...cloudPuffs.flatMap(([x, y, z, radius]) => [-1, 1].flatMap((side) => [
        [x + CLOUD_OFFSET[0] + side * radius * 0.76, y + CLOUD_OFFSET[1] + radius * 0.67, z + CLOUD_OFFSET[2]],
        [x + CLOUD_OFFSET[0] + side * radius * 0.76, y + CLOUD_OFFSET[1] - radius * 0.67, z + CLOUD_OFFSET[2]],
      ])),
      ...Object.values(nodes).map(({ position: [x, y, z], actor }) => [x, y + (actor ? 1.5 : 1.6), z]),
    ].map((p) => new Vector3(...p as [number, number, number]));
    function fit() {
      cam.updateMatrixWorld();
      const points = landmarks.map((point) => point.clone().applyMatrix4(cam.matrixWorldInverse));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const [left, right, bottom, top] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const header = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 80;
      const dock = document.querySelector(".desk-toggle")?.getBoundingClientRect().top ?? size.height - 80;
      const safeTop = compact ? header + 12 : header;
      const safeBottom = compact ? dock - 12 : size.height - 170;
      const safeLeft = compact ? 12 : 275;
      const safeRight = size.width - (compact ? 12 : 275);
      cam.zoom = Math.min((safeRight - safeLeft) / (right - left), Math.max(80, safeBottom - safeTop - (compact ? 20 : 40)) / (top - bottom));
      cam.setViewOffset(size.width, size.height, (left + right) / 2 * cam.zoom + size.width / 2 - (safeLeft + safeRight) / 2, -(top + bottom) / 2 * cam.zoom + size.height / 2 - (safeTop + safeBottom) / 2, size.width, size.height);
      cam.updateProjectionMatrix();
    }
    fit();
    const observer = new ResizeObserver(fit);
    document.querySelectorAll(compact ? ".topbar, .desk-toggle" : ".topbar, .smoke, .timeline, .controls").forEach((panel) => observer.observe(panel));
    return () => observer.disconnect();
  }, [camera, size]);
  return <OrbitControls ref={orbit} makeDefault enablePan={false} enableDamping minPolarAngle={0.55} maxPolarAngle={1.15}
    minAzimuthAngle={-0.3} maxAzimuthAngle={1.5} minZoom={5} maxZoom={120} />;
}

function GroundLabels() {
  return (
    <>
      {houses.map((id) => {
        const [x, , z] = nodes[id].position;
        return (
          <Html key={id} position={[x, -0.1, z + 1.2]} center zIndexRange={[4, 0]} className="chip ground village-label">
            <span style={{ ["--c" as string]: nodes[id].color }}>{nodes[id].label}</span>
          </Html>
        );
      })}
      <Html position={[DEPOT[0], -0.1, DEPOT[2]]} center zIndexRange={[4, 0]} className="chip ground depot-label">
        <span>{nodes.driver.label}</span>
      </Html>
      <Html position={[NEIGHBOUR[0], -0.1, NEIGHBOUR[2] + 1.2]} center zIndexRange={[4, 0]} className="chip ground neighbour-label">
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
    </Canvas>
  );
}
