import { NextResponse } from "next/server";
import { z } from "zod";
import { backendUrl } from "@/lib/config";
import { decodeSessionToken } from "@/lib/jwt";
import { homeFor } from "@/lib/roles";
import { setSessionCookie } from "@/lib/session";

const LoginBody = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

export async function POST(request: Request) {
  const parsed = LoginBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a username and password." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl("staff")}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return NextResponse.json({ error: "Can't reach the server. Try again in a moment." }, { status: 502 });
  }

  if (upstream.status === 401) {
    return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: "Sign-in failed. Try again." }, { status: 502 });
  }

  const { accessToken, expiresAt } = (await upstream.json()) as { accessToken: string; expiresAt: string };
  const claims = decodeSessionToken(accessToken);
  if (!claims) {
    return NextResponse.json({ error: "Sign-in failed. Try again." }, { status: 502 });
  }

  await setSessionCookie(accessToken, new Date(expiresAt));
  return NextResponse.json({ role: claims.role, username: claims.username, home: homeFor(claims.role) });
}
