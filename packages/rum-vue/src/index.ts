import type { App } from "vue";
import {
  init,
  type InitOptions,
  type RumClient,
} from "@insightview/rum-sdk";

/**
 * Vue 3 plugin for @insightview/rum-sdk. Usage:
 *
 *   import { createApp } from "vue";
 *   import { InsightViewRum } from "@insightview/rum-vue";
 *
 *   createApp(App).use(InsightViewRum, {
 *     endpoint: "https://rum.example.com/v1/events",
 *     siteId: "my-site",
 *     autoInstrument: { webVitals: true, errors: true },
 *   });
 *
 * Then in components: `this.$rum.trackEvent(...)` or
 * `inject<RumClient>("rum").trackEvent(...)`.
 *
 * Also auto-captures Vue-level errors via `app.config.errorHandler`
 * so uncaught exceptions during component render land as RUM errors.
 */

let globalClient: RumClient | null = null;

export function getRumClient(): RumClient {
  if (globalClient) return globalClient;
  return {
    trackEvent: () => {},
    trackError: () => {},
    setUser: () => {},
    async flush() {},
    async shutdown() {},
  };
}

export const InsightViewRum = {
  install(app: App, options: InitOptions) {
    const client = init(options);
    globalClient = client;

    app.provide("rum", client);
    (app.config.globalProperties as { $rum?: RumClient }).$rum = client;

    const previous = app.config.errorHandler;
    app.config.errorHandler = (err, instance, info) => {
      if (err instanceof Error) {
        client.trackError(err, { vueInfo: info });
      }
      if (typeof previous === "function") {
        previous(err, instance, info);
      }
    };
  },
};

export { init } from "@insightview/rum-sdk";
export type { InitOptions, RumClient } from "@insightview/rum-sdk";
