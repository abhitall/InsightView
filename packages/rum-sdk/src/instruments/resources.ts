import type { RumEventInput } from "../types.js";

type Push = (ev: RumEventInput) => void;

export function installResources(push: Push): void {
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming;
        push({
          id: (crypto as Crypto).randomUUID(),
          type: "RESOURCE",
          name: resource.initiatorType ?? "resource",
          value: resource.duration,
          url: resource.name,
          occurredAt: new Date().toISOString(),
          attributes: {
            transferSize: resource.transferSize,
            decodedBodySize: resource.decodedBodySize,
            encodedBodySize: resource.encodedBodySize,
          },
        });
      }
    });
    obs.observe({ type: "resource", buffered: true });
  } catch {
    /* observer unsupported */
  }
}
