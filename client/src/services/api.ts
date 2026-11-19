export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown> | null = null,
  methodOverride?: string,
): Promise<T> {
  const opts: RequestInit = {
    method: methodOverride || (body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body && opts.method !== 'GET') {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) {
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  }
  return data;
}

export async function sendGameAction<T = Record<string, unknown>>(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  return apiFetch<T>('/api/action', { type, payload });
}

export function escHtml(str: unknown): string {
  return String(str ?? '').replace(/[<>&"']/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c] || c
  ));
}
