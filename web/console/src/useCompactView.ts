import { useSyncExternalStore } from "react";

const query = typeof window === "undefined" ? undefined : window.matchMedia("(max-width: 1100px)");

export function useCompactView() {
  return useSyncExternalStore(
    (cb) => (query?.addEventListener("change", cb), () => query?.removeEventListener("change", cb)),
    () => query?.matches ?? false,
    () => false,
  );
}
