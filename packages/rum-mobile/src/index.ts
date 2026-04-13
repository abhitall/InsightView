/**
 * @insightview/rum-mobile — mobile RUM SDK (Phase 4 roadmap item).
 *
 * This package is **runtime-agnostic TypeScript** so it compiles
 * cleanly against:
 *
 *   - React Native (the primary target — most of the surface area
 *     just works because RN exposes fetch + AsyncStorage).
 *   - A wrapping Swift / Kotlin host that embeds this module via
 *     JavaScriptCore / QuickJS. The native host is responsible for
 *     exposing `globalThis.__insightviewNative` with the platform
 *     hooks the SDK calls into (see `NativeHost` interface below).
 *
 * Wire format is **identical** to the browser SDK's
 * `rumEventBatchSchema` so the same rum-collector endpoint accepts
 * mobile beacons without any new route. That alignment is what
 * lets the unified Grafana dashboard show web + mobile RUM on
 * the same chart keyed by `platform` attribute.
 *
 * Mobile-specific concerns:
 *   - Cold-start: wrap the first time-to-interactive with a
 *     dedicated MOBILE_COLD_START event.
 *   - Network transitions: report RN `NetInfo` changes as
 *     MOBILE_NETWORK events (host provides the listener).
 *   - Screen changes: wrap the navigation library to emit
 *     NAVIGATION events — analogous to `installInteractionTracking`
 *     on web. We ship helpers for the two dominant RN navigation
 *     libraries in `./integrations/`.
 *   - Backgrounding: flush on `AppState` change to "background".
 */

export interface MobileEvent {
  id: string;
  type:
    | "WEB_VITAL"
    | "ERROR"
    | "NAVIGATION"
    | "CUSTOM"
    | "MOBILE_COLD_START"
    | "MOBILE_NETWORK";
  name: string;
  value?: number;
  url: string;
  occurredAt: string;
  attributes?: Record<string, unknown>;
}

export interface MobileInitOptions {
  endpoint: string;
  siteId: string;
  platform: "ios" | "android" | "react-native";
  appVersion?: string;
  deviceModel?: string;
  osVersion?: string;
  sampleRate?: number;
  /** Native host hooks. Provided by the RN bridge or the wrapping
   *  platform host. When unset the SDK operates in JS-only mode. */
  nativeHost?: NativeHost;
}

/**
 * Hooks the native host provides. All methods are optional — if
 * `nativeHost` is undefined the SDK still works but won't capture
 * MOBILE_COLD_START or MOBILE_NETWORK events.
 */
export interface NativeHost {
  onAppStateChange?(handler: (state: "active" | "background") => void): () => void;
  onNetworkChange?(handler: (type: string) => void): () => void;
  getColdStartDuration?(): number | null;
  getDeviceInfo?(): { model: string; os: string; osVersion: string };
}

export interface MobileRumClient {
  trackEvent(name: string, attrs?: Record<string, unknown>): void;
  trackError(err: Error, attrs?: Record<string, unknown>): void;
  trackNavigation(screen: string, attrs?: Record<string, unknown>): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

const SDK_VERSION = "0.1.0";

/**
 * Buffer + transport. The buffer is smaller than the web SDK's
 * (10 events or 10 seconds) because mobile sessions are usually
 * shorter and background flushes are less forgiving.
 */
class MobileBuffer {
  private events: MobileEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private onFlush?: () => void;

  push(ev: MobileEvent): void {
    this.events.push(ev);
    if (this.events.length >= 10) {
      this.fire();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.fire(), 10_000);
    }
  }

  drain(): MobileEvent[] {
    const out = this.events;
    this.events = [];
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return out;
  }

  attachFlush(cb: () => void): void {
    this.onFlush = cb;
  }

  private fire(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.onFlush?.();
  }
}

export function init(opts: MobileInitOptions): MobileRumClient {
  const sampleRate = opts.sampleRate ?? 1;
  if (Math.random() >= sampleRate) return noopClient();

  const sessionId = `mob_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const buffer = new MobileBuffer();

  const doFlush = async () => {
    const events = buffer.drain();
    if (events.length === 0) return;
    const payload = {
      siteId: opts.siteId,
      sessionId,
      sdkVersion: SDK_VERSION,
      sentAt: new Date().toISOString(),
      platform: opts.platform,
      appVersion: opts.appVersion,
      deviceModel: opts.deviceModel,
      osVersion: opts.osVersion,
      page: {
        url: "app://" + opts.siteId,
        referrer: "",
        title: opts.siteId,
        viewport: { width: 0, height: 0 },
      },
      events: events.map((e) => ({
        id: e.id,
        type: e.type === "MOBILE_COLD_START" || e.type === "MOBILE_NETWORK"
          ? "CUSTOM"
          : e.type,
        name: e.name,
        value: e.value,
        url: e.url,
        occurredAt: e.occurredAt,
        attributes: {
          ...(e.attributes ?? {}),
          platform: opts.platform,
          appVersion: opts.appVersion,
        },
      })),
    };
    try {
      // Mobile transport uses fetch — available in RN, web views,
      // and most JS engines. No sendBeacon in mobile.
      await fetch(opts.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      /* swallow */
    }
  };

  buffer.attachFlush(() => void doFlush());

  const push = (ev: MobileEvent) => buffer.push(ev);

  // Cold start event (best-effort — the host supplies the duration).
  const coldStart = opts.nativeHost?.getColdStartDuration?.();
  if (typeof coldStart === "number") {
    push({
      id: `evt_${Math.random().toString(36).slice(2)}`,
      type: "MOBILE_COLD_START",
      name: "cold-start",
      value: coldStart,
      url: "app://" + opts.siteId,
      occurredAt: new Date().toISOString(),
    });
  }

  // Network change listener.
  const netUnsub = opts.nativeHost?.onNetworkChange?.((type) => {
    push({
      id: `evt_${Math.random().toString(36).slice(2)}`,
      type: "MOBILE_NETWORK",
      name: "network-change",
      url: "app://" + opts.siteId,
      occurredAt: new Date().toISOString(),
      attributes: { type },
    });
  });

  // Flush on background.
  const appStateUnsub = opts.nativeHost?.onAppStateChange?.((state) => {
    if (state === "background") void doFlush();
  });

  return {
    trackEvent(name, attrs) {
      push({
        id: `evt_${Math.random().toString(36).slice(2)}`,
        type: "CUSTOM",
        name,
        url: "app://" + opts.siteId,
        occurredAt: new Date().toISOString(),
        attributes: attrs,
      });
    },
    trackError(err, attrs) {
      push({
        id: `evt_${Math.random().toString(36).slice(2)}`,
        type: "ERROR",
        name: err.name || "Error",
        url: "app://" + opts.siteId,
        occurredAt: new Date().toISOString(),
        attributes: {
          message: err.message,
          stack: err.stack,
          ...(attrs ?? {}),
        },
      });
    },
    trackNavigation(screen, attrs) {
      push({
        id: `evt_${Math.random().toString(36).slice(2)}`,
        type: "NAVIGATION",
        name: "screen",
        url: "app://" + opts.siteId + "/" + screen,
        occurredAt: new Date().toISOString(),
        attributes: { screen, ...(attrs ?? {}) },
      });
    },
    async flush() {
      await doFlush();
    },
    async shutdown() {
      await doFlush();
      netUnsub?.();
      appStateUnsub?.();
    },
  };
}

function noopClient(): MobileRumClient {
  return {
    trackEvent() {},
    trackError() {},
    trackNavigation() {},
    async flush() {},
    async shutdown() {},
  };
}
