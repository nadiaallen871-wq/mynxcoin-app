/**
 * Application error hierarchy. Services throw these. The error middleware
 * converts them into the standard envelope:
 *   { error: { code, message, details?, requestId } }
 */
export class AppError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details, cause, expose } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
    // 4xx messages are safe to show to clients. 5xx messages are not, unless explicitly marked.
    this.expose = expose ?? status < 500;
  }
}

export class ValidationError extends AppError {
  constructor(details, message = 'Request validation failed') {
    super(message, { status: 422, code: 'VALIDATION_ERROR', details });
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') {
    super(message, { status: 400, code });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, { status: 401, code: 'UNAUTHENTICATED' });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, { status: 403, code: 'FORBIDDEN' });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, { status: 404, code: 'NOT_FOUND' });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT') {
    super(message, { status: 409, code });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details) {
    super(message, { status: 503, code: 'SERVICE_UNAVAILABLE', details, expose: true });
  }
}
