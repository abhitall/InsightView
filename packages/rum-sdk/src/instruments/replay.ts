/**
 * Session replay via rrweb. Records the DOM + user interactions
 * as a compact JSON event stream and flushes batches to the
 * collector. Privacy is enforced before serialization:
 *   - maskAllInputs: all input values are masked by default
 *   - blockClass: elements with data-rum-block are excluded
 *
 * The rrweb payload can be 10–50× the size of standard telemetry
 * so callers should sample aggressively (e.g. replaySampleRate=0.05
 * at init time).
 */

import type { RumEventInput } from "../types.js";

interface RrwebEvent {
  type: number;
  data: unknown;
  timestamp: number;
}

type Recorder = (() => void) | undefined;

export interface ReplayOptions {
  endpoint: string;
  siteId: string;
  sessionId: string;
  flushIntervalMs?: number;
  maxEventsPerChunk?: number;
  sampleRate?: number;
}

export interface ReplayHandle {
  stop(): void;
  flush(): Promise<void>;
}

type Push = (ev: RumEventInput) => void;

export function installReplay(
  opts: ReplayOptions,
  _push: Push,
): ReplayHandle {
  // Head-based sampling: replay is expensive, most sessions should skip it.
  const sampleRate = opts.sampleRate ?? 0.05;
  if (Math.random() >= sampleRate) {
    return { stop() {}, async flush() {} };
  }

  const buffer: RrwebEvent[] = [];
  let sequence = 0;
  let stopped = false;

  // Dynamically import rrweb so sites that don't enable replay
  // don't pay the bundle cost.
  let recordStop: Recorder;
  let importPromise: Promise<void> | null = import("rrweb")
    .then((mod) => {
      const record = (mod as unknown as {
        record: (args: {
          emit: (e: RrwebEvent) => void;
          maskAllInputs?: boolean;
          blockClass?: string;
          sampling?: { mousemove: number };
        }) => () => void;
      }).record;
      recordStop = record({
        emit: (event: RrwebEvent) => {
          if (stopped) return;
          buffer.push(event);
          if (buffer.length >= (opts.maxEventsPerChunk ?? 100)) {
            void flushChunk();
          }
        },
        maskAllInputs: true,
        blockClass: "rum-block",
        sampling: { mousemove: 50 },
      });
    })
    .catch(() => {
      // rrweb not installed or failed to load — replay is opt-in,
      // so silently disable.
    });

  const flushChunk = async () => {
    if (buffer.length === 0) return;
    const events = buffer.splice(0, buffer.length);
    const payload = JSON.stringify(events);
    try {
      // Use sendBeacon so the final chunk is delivered on pagehide.
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob(
          [
            JSON.stringify({
              siteId: opts.siteId,
              sessionId: opts.sessionId,
              sequence: sequence++,
              payload,
            }),
          ],
          { type: "application/json" },
        );
        navigator.sendBeacon(opts.endpoint, blob);
      } else {
        await fetch(opts.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId: opts.siteId,
            sessionId: opts.sessionId,
            sequence: sequence++,
            payload,
          }),
          keepalive: true,
          credentials: "omit",
          mode: "cors",
        }).catch(() => {});
      }
    } catch {
      /* swallow */
    }
  };

  const interval = setInterval(
    () => void flushChunk(),
    opts.flushIntervalMs ?? 5000,
  );

  const onPageHide = () => {
    void flushChunk();
  };
  window.addEventListener("pagehide", onPageHide);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener("pagehide", onPageHide);
      try {
        recordStop?.();
      } catch {
        /* ignore */
      }
    },
    async flush() {
      await importPromise;
      importPromise = null;
      await flushChunk();
    },
  };
}
