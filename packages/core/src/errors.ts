/**
 * Domain error hierarchy. Services catch these and map to transport
 * errors (HTTP status, worker retry, etc.) at the adapter layer.
 */

export class DomainError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.cause = cause;
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id?: string) {
    super("NOT_FOUND", id ? `${resource} '${id}' not found` : `${resource} not found`);
  }
}

export class ValidationError extends DomainError {
  readonly details?: unknown;
  constructor(message: string, details?: unknown) {
    super("VALIDATION", message);
    this.details = details;
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super("CONFLICT", message);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message);
  }
}
