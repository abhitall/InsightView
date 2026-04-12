import type { RumEventInput } from "../types.js";

type Push = (ev: RumEventInput) => void;

export function installErrorHandlers(push: Push): void {
  window.addEventListener("error", (e) => {
    push({
      id: (crypto as Crypto).randomUUID(),
      type: "ERROR",
      name: e.error?.name ?? "Error",
      url: location.href,
      occurredAt: new Date().toISOString(),
      attributes: {
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.error?.stack,
      },
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    push({
      id: (crypto as Crypto).randomUUID(),
      type: "ERROR",
      name: "UnhandledRejection",
      url: location.href,
      occurredAt: new Date().toISOString(),
      attributes: {
        message: typeof reason === "string" ? reason : reason?.message,
        stack: reason?.stack,
      },
    });
  });
}
