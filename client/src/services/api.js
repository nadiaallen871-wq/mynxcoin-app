/**
 * Fetch wrapper for the Mynx API.
 * - Sends the httpOnly session cookie (credentials: 'include').
 * - Fetches a CSRF token once and attaches it to every state-changing request.
 *   If the server rejects it (e.g. the cookie expired), it refreshes the token and retries once.
 * - Normalises the server's error envelope into ApiError.
 */
export const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

let csrfToken = null;
let csrfPromise = null;

async function ensureCsrf(force = false) {
  if (csrfToken && !force) return csrfToken;
  csrfPromise ??= rawRequest('/auth/csrf', { method: 'GET' })
    .then((res) => (csrfToken = res.data.csrfToken))
    .finally(() => (csrfPromise = null));
  return csrfPromise;
}

async function rawRequest(path, { method, body, headers, signal }) {
  let response;
  // FormData (file uploads) is sent as-is so the browser sets the multipart boundary.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  try {
    response = await fetch(`${BASE}/api/v1${path}`, {
      method,
      credentials: 'include',
      signal,
      headers: { Accept: 'application/json', ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'Unable to reach the server. Check your connection and try again.' });
  }

  if (response.status === 204) return null;
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const e = payload?.error ?? {};
    throw new ApiError({
      status: response.status,
      code: e.code ?? 'HTTP_ERROR',
      message: e.message ?? `Request failed (${response.status})`,
      details: e.details,
      requestId: e.requestId ?? response.headers.get('x-request-id'),
    });
  }
  return payload;
}

export async function apiRequest(path, { method = 'GET', body, headers = {}, signal } = {}) {
  if (!UNSAFE.has(method)) return rawRequest(path, { method, body, headers, signal });
  const send = async (force) =>
    rawRequest(path, { method, body, signal, headers: { ...headers, 'X-CSRF-Token': await ensureCsrf(force) } });
  try {
    return await send(false);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'CSRF_INVALID') return send(true);
    throw err;
  }
}

export const api = {
  get: (path, opts) => apiRequest(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => apiRequest(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => apiRequest(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => apiRequest(path, { ...opts, method: 'PATCH', body }),
  delete: (path, opts) => apiRequest(path, { ...opts, method: 'DELETE' }),
};

/**
 * Copies server-side validation details onto React Hook Form fields.
 * Returns true when at least one field error was applied.
 */
export function applyServerErrors(error, setError, fields) {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return false;
  let applied = false;
  for (const d of error.details) {
    if (d.path && (!fields || fields.includes(d.path))) {
      setError(d.path, { type: 'server', message: d.message });
      applied = true;
    }
  }
  return applied;
}
