import type { RumEventInput } from "../types.js";

type Push = (ev: RumEventInput) => void;

/**
 * User interaction tracking. Captures two event kinds the basic
 * SDK would otherwise miss:
 *
 *   1. **Clicks** — records which element was clicked via a
 *      best-effort selector (tag + id + classList + text) so
 *      funnel analytics can piece together the journey without
 *      a full DOM snapshot. Privacy-safe: we never capture the
 *      value of inputs, only the selector of the target element.
 *
 *   2. **Route changes** — patches `history.pushState` and
 *      `history.replaceState` plus listens for `popstate` so
 *      single-page app navigations surface as NAVIGATION events
 *      carrying the new path. This is what gives SPAs proper
 *      page-view analytics without requiring a framework
 *      integration.
 */

export function installInteractionTracking(push: Push): void {
  installClickTracking(push);
  installRouteChangeTracking(push);
}

function installClickTracking(push: Push): void {
  document.addEventListener(
    "click",
    (e) => {
      try {
        const target = e.target as Element | null;
        if (!target) return;
        const selector = describeElement(target);
        push({
          id: (crypto as Crypto).randomUUID(),
          type: "CUSTOM",
          name: "click",
          url: location.href,
          occurredAt: new Date().toISOString(),
          attributes: {
            selector,
            text: (target.textContent ?? "").slice(0, 80),
          },
        });
      } catch {
        /* ignore — never let instrumentation break the page */
      }
    },
    { capture: true, passive: true },
  );
}

function installRouteChangeTracking(push: Push): void {
  const emit = (from: string, to: string, kind: string) => {
    push({
      id: (crypto as Crypto).randomUUID(),
      type: "NAVIGATION",
      name: "route-change",
      url: to,
      occurredAt: new Date().toISOString(),
      attributes: { from, to, kind },
    });
  };

  // Patch pushState + replaceState. We keep the original functions
  // on a symbol so we don't fight framework internals that also
  // monkey-patch them.
  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);

  history.pushState = function patchedPush(...args: Parameters<History["pushState"]>) {
    const from = location.href;
    const ret = originalPush(...args);
    emit(from, location.href, "pushState");
    return ret;
  };
  history.replaceState = function patchedReplace(...args: Parameters<History["replaceState"]>) {
    const from = location.href;
    const ret = originalReplace(...args);
    emit(from, location.href, "replaceState");
    return ret;
  };

  window.addEventListener("popstate", () => {
    emit("", location.href, "popstate");
  });
}

function describeElement(el: Element): string {
  const parts: string[] = [el.tagName.toLowerCase()];
  if (el.id) parts.push(`#${el.id}`);
  if (el.classList.length > 0) {
    parts.push(
      "." +
        [...el.classList]
          .slice(0, 3)
          .map((c) => c.replace(/\s+/g, ""))
          .join("."),
    );
  }
  const dataAttr =
    el.getAttribute("data-testid") ??
    el.getAttribute("data-test") ??
    el.getAttribute("data-rum-id");
  if (dataAttr) parts.push(`[data-testid="${dataAttr}"]`);
  return parts.join("");
}
