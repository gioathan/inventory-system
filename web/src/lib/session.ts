import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { SESSION_COOKIE } from "./constants";
import { decodeSessionToken, type SessionClaims } from "./jwt";

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, // unreadable from JS, so an XSS bug can't lift the token
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

// Memoized per render pass (see the Next.js data-access-layer pattern), so layouts and pages
// can each ask "who is this?" without re-decoding the cookie every time.
export const getSession = cache(async (): Promise<SessionClaims | null> => {
  const token = await getSessionToken();
  return token ? decodeSessionToken(token) : null;
});
