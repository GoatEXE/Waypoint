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
export const dockerUnavailable = () => new AppError(503, 'docker_unavailable', "Docker isn't running. Start Docker Desktop, then retry.");
export const modelNotConnected = (message, details) => new AppError(409, 'model_not_connected', message, details);
export const ceoStopped = () => new AppError(409, 'ceo_stopped', 'The CEO is stopped. Start the CEO, then retry.');

const DOCKER_DOWN_RE = /cannot connect to the docker daemon|is the docker daemon running|error during connect|docker daemon is not running|dockerDesktopLinuxEngine|docker_engine|ENOENT|not recognized as an internal or external command|docker: (command )?not found/i;
const CEO_STOPPED_RE = /container [^ ]+ is not running|is restarting, wait until the container is running|no such container/i;

export function runtimeFailure(result) {
  const text = `${result?.stderr || ''}\n${result?.stdout || ''}`;
  if (DOCKER_DOWN_RE.test(text)) return dockerUnavailable();
  if (CEO_STOPPED_RE.test(text)) return ceoStopped();
  return null;
}
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
