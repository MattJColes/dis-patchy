import { useGLTF } from "@react-three/drei";
import type { ComponentProps } from "react";
import type { Mesh } from "three";
import kit from "./models/french-village.glb?url";
import { Toon } from "./toon";

export type ModelName =
  | "roof" | "shutters" | "windowFrame" | "doorFrame" | "chimney" | "lanternCap"
  | "cypress" | "fountain" | "carBody" | "carCabin" | "scooter" | "parcel" | "cloudPuff" | "softBox"
  | "bridge" | "bread" | "gopher";

/** Shared Blender geometry, rendered with the village's existing ink and cel shading. */
export function Model({ name, ...props }: Omit<ComponentProps<typeof Toon>, "children" | "geometry"> & { name: ModelName }) {
  const { nodes } = useGLTF(kit, false, false);
  return <Toon {...props} geometry={(nodes[name] as Mesh).geometry} />;
}

useGLTF.preload(kit, false, false);
