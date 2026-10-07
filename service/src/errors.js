export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (message, details) => new AppError(400, 'bad_request', message, details);
export const notFound = (message, details) => new AppError(404, 'not_found', message, details);
export const conflict = (message, details) => new AppError(409, 'conflict', message, details);
export const lifecycleError = (message, details) => new AppError(422, 'lifecycle_error', message, details);
export const forbidden = (message, details) => new AppError(403, 'forbidden', message, details);
export const unsupportedMediaType = (message, details) => new AppError(415, 'unsupported_media_type', message, details);
export const timeout = (message, details) => new AppError(504, 'timeout', message, details);
export function toErrorResponse(error) {
  const isAppError = error instanceof AppError;
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error?.code || 'internal_error';
  const message = status >= 500 && !isAppError ? 'Internal server error' : error.message;
  const payload = { error: { code, message } };
  if (isAppError && error?.details) payload.error.details = error.details;
  else if (error?.details && status < 500) payload.error.details = error.details;
  return { status, payload };
}
