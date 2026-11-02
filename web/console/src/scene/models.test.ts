import { Matrix4, Raycaster, Vector3, type Mesh } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";
import type { ModelName } from "./Models";
import kit from "./models/french-village.glb?url&inline";

const file = Uint8Array.from(atob(kit.split(",")[1]), (byte) => byte.charCodeAt(0));
const gltf = await new GLTFLoader().parseAsync(file.buffer, "");
const meshes = Object.fromEntries(gltf.scene.children.map((child) => [child.name, child as Mesh]));
const required: Record<ModelName, true> = {
  roof: true, shutters: true, windowFrame: true, doorFrame: true, chimney: true, lanternCap: true,
  cypress: true, fountain: true, carBody: true, carCabin: true, scooter: true, parcel: true, cloudPuff: true, softBox: true,
  bridge: true, bread: true, gopher: true,
};

describe("Blender village kit", () => {
  it("loads precisely the shared models used by the scene", () => {
    expect(Object.keys(meshes).sort()).toEqual(Object.keys(required).sort());
    for (const mesh of Object.values(meshes)) {
      expect(mesh.isMesh).toBe(true);
      expect(mesh.matrixWorld.equals(new Matrix4())).toBe(true);
    }
  });

  it("keeps roofs in Y-up coordinates with outward faces visible from above", () => {
    const roof = meshes.roof;
    roof.geometry.computeBoundingBox();
    const bounds = roof.geometry.boundingBox!;
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(0.915);
    expect(bounds.min.x).toBeCloseTo(-1);
    expect(bounds.max.z).toBeCloseTo(1);
    const ray = new Raycaster(new Vector3(0, 3, 0.5), new Vector3(0, -1, 0));
    expect(ray.intersectObject(roof).length).toBeGreaterThan(0);
  });

  it("keeps the kit small and each model low poly", () => {
    expect(file.byteLength).toBeLessThan(250_000);
    for (const mesh of Object.values(meshes)) {
      expect(mesh.geometry.index!.count / 3).toBeLessThan(800);
    }
  });
});
