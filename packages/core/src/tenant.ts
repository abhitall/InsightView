/**
 * Tenant context. Every service reads tenantId through this helper so that
 * swapping in JWT-based tenant resolution later is a one-file change.
 * MVP: always returns "default".
 */

export interface TenantContext {
  tenantId: string;
  actor?: string;
}

export const DEFAULT_TENANT = "default";

export function defaultTenant(actor = "system"): TenantContext {
  return { tenantId: DEFAULT_TENANT, actor };
}
