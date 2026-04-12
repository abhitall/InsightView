import type { RumEventInput } from "./types.js";
import { installWebVitals } from "./instruments/webVitals.js";
import { installErrorHandlers } from "./instruments/errors.js";
import { installNavigation } from "./instruments/navigation.js";
import { installResources } from "./instruments/resources.js";
import { Buffer } from "./buffer.js";
import { sendBatch } from "./transport.js";

export interface InitOptions {
  endpoint: string;
  siteId: string;
  sampleRate?: number;
  release?: string;
  environment?: string;
  autoInstrument?: {
    webVitals?: boolean;
    errors?: boolean;
    resources?: boolean;
    navigation?: boolean;
  };
  user?: { id?: string; traits?: Record<string, string> };
  beforeSend?: (ev: RumEventInput) => RumEventInput | null;
}

export interface RumClient {
  trackEvent(name: string, attrs?: Record<string, unknown>): void;
  trackError(err: Error, attrs?: Record<string, unknown>): void;
  setUser(user: { id?: string; traits?: Record<string, string> }): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

const SDK_VERSION = "0.1.0";
const SESSION_KEY = "__insightview_session";

function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = (crypto as Crypto).randomUUID();
    sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    // storage blocked — generate ephemeral per page load
    return (crypto as Crypto).randomUUID();
  }
}

export function init(opts: InitOptions): RumClient {
  const sampleRate = opts.sampleRate ?? 1;
  if (Math.random() >= sampleRate) {
    return noopClient();
  }

  const sessionId = getOrCreateSessionId();
  let user = opts.user;
  const buffer = new Buffer();

  const doSend = async () => {
    const events = buffer.drain();
    if (events.length === 0) return;
    const payload = {
      siteId: opts.siteId,
      sessionId,
      sdkVersion: SDK_VERSION,
      sentAt: new Date().toISOString(),
      page: {
        url: location.href,
        referrer: document.referrer,
        title: document.title,
        viewport: { width: innerWidth, height: innerHeight },
      },
      user,
      release: opts.release,
      environment: opts.environment,
      events,
    };
    try {
      sendBatch(opts.endpoint, payload);
    } catch {
      /* swallow */
    }
  };

  buffer.onFlush(doSend);

  const push = (ev: RumEventInput) => {
    const shaped = opts.beforeSend ? opts.beforeSend(ev) : ev;
    if (!shaped) return;
    buffer.push(shaped);
  };

  // Install auto instruments.
  const auto = opts.autoInstrument ?? {};
  if (auto.webVitals !== false) installWebVitals(push);
  if (auto.errors !== false) installErrorHandlers(push);
  if (auto.navigation !== false) installNavigation(push);
  if (auto.resources === true) installResources(push);

  // Flush on visibility change and pagehide (critical for mobile).
  const flushNow = () => {
    void doSend();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });
  window.addEventListener("pagehide", flushNow);

  return {
    trackEvent(name, attrs) {
      push({
        id: (crypto as Crypto).randomUUID(),
        type: "CUSTOM",
        name,
        url: location.href,
        occurredAt: new Date().toISOString(),
        attributes: attrs,
      });
    },
    trackError(err, attrs) {
      push({
        id: (crypto as Crypto).randomUUID(),
        type: "ERROR",
        name: err.name || "Error",
        url: location.href,
        occurredAt: new Date().toISOString(),
        attributes: {
          message: err.message,
          stack: err.stack,
          ...(attrs ?? {}),
        },
      });
    },
    setUser(newUser) {
      user = newUser;
    },
    async flush() {
      await doSend();
    },
    async shutdown() {
      await doSend();
    },
  };
}

function noopClient(): RumClient {
  return {
    trackEvent() {},
    trackError() {},
    setUser() {},
    async flush() {},
    async shutdown() {},
  };
}
