// Browser-side API client. Everything goes through this app's own /api/backend proxy, which
// attaches the session token — so nothing here ever handles credentials.
export type BackendService = "gateway" | "staff" | "dashboard" | "notification";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// The backend returns plain strings for 4xx it produces itself (e.g. "Insufficient stock…")
// and ProblemDetails JSON for the rest; surface whichever it sent as a readable message.
async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    if (typeof json === "string") return json;
    return json.detail ?? json.title ?? json.error ?? text;
  } catch {
    return text || `Request failed (${response.status}).`;
  }
}

export async function apiFetch<T>(service: BackendService, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/backend/${service}/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && typeof window !== "undefined") {
    // Session expired mid-use (tokens last ~8h and there's no refresh flow): back to sign-in.
    // A hard navigation on purpose — it discards all in-memory client state and cache, and this
    // helper runs outside React where the router hook isn't available.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  if (!response.ok) throw new ApiError(response.status, await readError(response));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
