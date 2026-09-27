import { request } from "@playwright/test";
import { admin, baseUrl } from "./env";

export interface Credentials {
  username: string;
  password: string;
}

let cached: Credentials | undefined;

// A fresh Seller account per run, created through the same admin API the Staff screen uses, so the
// suite works on an empty database and never depends on a hand-made account existing.
export async function ensureSeller(): Promise<Credentials> {
  if (cached) return cached;

  const api = await request.newContext({ baseURL: baseUrl });
  try {
    const login = await api.post("/api/auth/login", { data: admin });
    if (!login.ok()) throw new Error(`Admin sign-in failed (${login.status()}). Is the AppHost running at ${baseUrl}?`);

    const credentials = { username: `e2e${Date.now().toString(36)}`, password: "E2e-Passw0rd!" };
    const created = await api.post("/api/backend/staff/staff", { data: { ...credentials, role: "Seller" } });
    if (!created.ok()) throw new Error(`Couldn't create the test seller (${created.status()}): ${await created.text()}`);

    cached = credentials;
    return credentials;
  } finally {
    await api.dispose();
  }
}
