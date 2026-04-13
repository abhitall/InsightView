import { useEffect, useRef, type ReactNode } from "react";
import {
  init,
  type InitOptions,
  type RumClient,
} from "@insightview/rum-sdk";

/**
 * React integration for @insightview/rum-sdk. Provides:
 *
 *   - <RumProvider options={...}>...</RumProvider>
 *     mounts the SDK once and flushes on unmount.
 *
 *   - useRumClient()
 *     returns the active RumClient from context, or a no-op client
 *     if no provider is mounted (so pre-release storybooks never
 *     crash).
 *
 *   - useTrackRoute()
 *     captures SPA route changes as custom events. Call inside
 *     your router's listener (react-router's useLocation, etc.)
 *     and it will emit a NAVIGATION event per transition.
 */

let globalClient: RumClient | null = null;

export function getRumClient(): RumClient {
  if (globalClient) return globalClient;
  // Return a no-op client so code that renders outside the
  // provider (Storybook, tests) doesn't crash.
  return {
    trackEvent: () => {},
    trackError: () => {},
    setUser: () => {},
    async flush() {},
    async shutdown() {},
  };
}

export interface RumProviderProps {
  options: InitOptions;
  children?: ReactNode;
}

export function RumProvider({ options, children }: RumProviderProps) {
  const initRef = useRef<RumClient | null>(null);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = init(options);
    globalClient = initRef.current;
    return () => {
      void initRef.current?.shutdown();
      globalClient = null;
      initRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return children as unknown as JSX.Element;
}

export function useRumClient(): RumClient {
  return getRumClient();
}

export function useTrackRoute(location: { pathname: string; search?: string }) {
  useEffect(() => {
    getRumClient().trackEvent("route-change", {
      pathname: location.pathname,
      search: location.search ?? "",
    });
  }, [location.pathname, location.search]);
}

export { init } from "@insightview/rum-sdk";
export type { InitOptions, RumClient } from "@insightview/rum-sdk";
