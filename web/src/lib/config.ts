import "server-only";

// Server-to-server URLs, read at request time (not import time) so a missing one fails the
// request that needs it with a clear message instead of breaking the whole build. Aspire
// injects these locally; the k8s manifest sets them in-cluster. None of them are ever sent
// to the browser — the browser only ever talks to this app's own /api routes.
export type BackendService = "gateway" | "staff" | "dashboard";

const ENV_NAMES: Record<BackendService, string> = {
  gateway: "SCAN_GATEWAY_URL",
  staff: "STAFF_API_URL",
  dashboard: "DASHBOARD_API_URL",
};

export function backendUrl(service: BackendService): string {
  const value = process.env[ENV_NAMES[service]];
  if (!value) throw new Error(`Missing environment variable ${ENV_NAMES[service]}.`);
  return value.replace(/\/+$/, "");
}

export function isBackendService(value: string): value is BackendService {
  return value in ENV_NAMES;
}
