import type { RumEventInput } from "../types.js";

type Push = (ev: RumEventInput) => void;

export function installNavigation(push: Push): void {
  const emit = () => {
    const nav = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return;
    const dcl = Math.max(0, nav.domContentLoadedEventEnd - nav.startTime);
    const load = Math.max(0, nav.loadEventEnd - nav.startTime);
    push({
      id: (crypto as Crypto).randomUUID(),
      type: "NAVIGATION",
      name: "navigation",
      value: load,
      url: location.href,
      occurredAt: new Date().toISOString(),
      attributes: {
        domContentLoaded: dcl,
        load,
        type: nav.type,
      },
    });
  };
  if (document.readyState === "complete") {
    setTimeout(emit, 0);
  } else {
    window.addEventListener("load", () => setTimeout(emit, 0));
  }
}
