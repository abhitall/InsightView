import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import type { RumEventInput } from "../types.js";

type Push = (ev: RumEventInput) => void;

export function installWebVitals(push: Push): void {
  const emit = (name: string, value: number, rating?: string) => {
    push({
      id: (crypto as Crypto).randomUUID(),
      type: "WEB_VITAL",
      name,
      value,
      rating: rating as "good" | "needs-improvement" | "poor" | undefined,
      url: location.href,
      occurredAt: new Date().toISOString(),
    });
  };
  onCLS((m) => emit("CLS", m.value, m.rating));
  onFCP((m) => emit("FCP", m.value, m.rating));
  onINP((m) => emit("INP", m.value, m.rating));
  onLCP((m) => emit("LCP", m.value, m.rating));
  onTTFB((m) => emit("TTFB", m.value, m.rating));
}
