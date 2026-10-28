import { useSyncExternalStore } from "react";

const query = typeof window === "undefined" ? undefined : window.matchMedia("(prefers-reduced-motion: reduce)");

export function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => (query?.addEventListener("change", cb), () => query?.removeEventListener("change", cb)),
    () => query?.matches ?? false,
  );
}
