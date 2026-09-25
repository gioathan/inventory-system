// Decoding only, never verification: the backend services verify the signature on every
// request, so the frontend has no signing key and shouldn't. These claims drive routing and
// UI (which shell to show), never access decisions — those always happen server-side.
const ROLE_CLAIM = "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

export type Role = "Admin" | "Seller";

export interface SessionClaims {
  username: string;
  role: Role;
  expiresAt: number; // epoch ms
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeSessionToken(token: string): SessionClaims | null {
  try {
    const payload = JSON.parse(base64UrlDecode(token.split(".")[1] ?? ""));
    const role = payload[ROLE_CLAIM];
    if ((role !== "Admin" && role !== "Seller") || typeof payload.exp !== "number") return null;

    const claims: SessionClaims = {
      username: String(payload.unique_name ?? payload.sub ?? ""),
      role,
      expiresAt: payload.exp * 1000,
    };
    return claims.expiresAt > Date.now() ? claims : null;
  } catch {
    return null;
  }
}
