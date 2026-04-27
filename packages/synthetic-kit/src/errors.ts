import { ErrorCategory } from "./types.js";

/**
 * Error classifier. Maps a raw Error (usually from Playwright) to one
 * of the four categories so the pipeline can tell "the target is down"
 * apart from "our CI blew up".
 *
 * This is the functional seam the alerting engine uses to decide
 * whether to fire — we never want to wake up an on-call for an
 * INFRA_FAILURE during CI flake.
 */

const TRANSIENT_PATTERNS = [
  /net::err_/i,
  /econnrefused/i,
  /econnreset/i,
  /etimedout/i,
  /enotfound/i,
  /socket hang up/i,
  /dns_probe/i,
  /request timed out/i,
  /tls handshake/i,
];

const INFRA_PATTERNS = [
  /browserType\.launch/i,
  /executable doesn't exist/i,
  /target closed/i,
  /protocol error/i,
  /browser closed/i,
  /page\.evaluate/i,
  /spawn .* enoent/i,
];

export function isTransientError(err: unknown): boolean {
  const msg = (err as Error)?.message?.toLowerCase() ?? "";
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

export function isInfraError(err: unknown): boolean {
  const msg = (err as Error)?.message?.toLowerCase() ?? "";
  return INFRA_PATTERNS.some((p) => p.test(msg));
}

export interface ClassifiedError {
  category: ErrorCategory;
  transient: boolean;
  reason: string;
}

export function classifyError(err: unknown): ClassifiedError {
  const msg = (err as Error)?.message ?? String(err);
  if (isInfraError(err)) {
    return {
      category: ErrorCategory.INFRA_FAILURE,
      transient: true,
      reason: `infra: ${msg}`,
    };
  }
  if (isTransientError(err)) {
    return {
      category: ErrorCategory.TARGET_DOWN,
      transient: true,
      reason: `target_down: ${msg}`,
    };
  }
  return {
    category: ErrorCategory.TARGET_ERROR,
    transient: false,
    reason: `target_error: ${msg}`,
  };
}
